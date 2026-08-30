package rocketmq

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/amigoer/mq-studio/internal/model"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// defaultTailLimit caps a batch when the caller asks for nothing in particular.
const defaultTailLimit = 64

// tailQueue is one readable queue of a topic, with the address to pull it from.
type tailQueue struct {
	node    string
	address string
	queueID int
}

// TailMessages returns what arrived since the cursor, and the cursor to pass
// next time.
//
// Each poll asks every queue where it currently ends, and pulls only from the
// ones that have moved. The order matters, and it is not an optimisation:
// rocketmq-admin-go's PullMessage sets the suspend flag, and a broker with
// nothing to hand back holds the request until it times out. Polling an idle
// topic with PullMessage therefore costs the full request timeout and ends in
// a deadline rather than an answer. Asking for the end offset first does not
// suspend, so an idle tail is one cheap round trip per queue and a pull only
// ever runs when there is something to find.
//
// An empty cursor opens at those same ends and returns nothing: a tail shows
// what arrives next, and what is already stored is what the message query is
// for.
func (c *Conn) TailMessages(
	ctx context.Context,
	ref model.DestinationRef,
	cursor model.TailCursor,
	limit int,
) (*model.TailBatch, error) {
	topic := strings.TrimSpace(ref.Name)
	if topic == "" {
		return nil, fmt.Errorf("Topic 名称不能为空")
	}
	if limit <= 0 {
		limit = defaultTailLimit
	}

	queues, err := c.tailQueues(ctx, topic)
	if err != nil {
		return nil, err
	}
	ends, err := c.tailQueueEnds(ctx, topic, queues)
	if err != nil {
		return nil, err
	}

	opening := len(cursor.Positions) == 0
	known := make(map[string]int64, len(cursor.Positions))
	for _, position := range cursor.Positions {
		known[queueKey(position.Node, position.QueueID)] = position.Offset
	}

	batch := &model.TailBatch{Messages: make([]*model.MessageItem, 0, limit)}
	positions := make([]model.QueuePosition, 0, len(queues))

	// Opening, or a queue this cursor has never seen - the topic can grow one
	// mid-tail - starts at the end. Replaying a backlog is not what a tail was
	// asked for either way.
	behind := make([]tailQueue, 0, len(queues))
	for _, queue := range queues {
		key := queueKey(queue.node, queue.queueID)
		from, seen := known[key]
		if opening || !seen {
			end, known := ends[key]
			if !known {
				// Its end could not be read. Leaving it out of the cursor makes
				// the next poll ask again; writing a zero would open this queue
				// at the start of its log and replay everything in it.
				continue
			}
			positions = append(positions, model.QueuePosition{
				Node: queue.node, QueueID: queue.queueID, Offset: end,
			})
			continue
		}
		if from >= ends[key] {
			// Nothing new here; pulling would only suspend.
			positions = append(positions, model.QueuePosition{
				Node: queue.node, QueueID: queue.queueID, Offset: from,
			})
			continue
		}
		behind = append(behind, queue)
	}
	if len(behind) == 0 {
		batch.Cursor = model.TailCursor{Positions: sortPositions(positions)}
		return batch, nil
	}

	// Split the budget across the queues that moved, so one busy queue cannot
	// crowd the others out of the batch.
	perQueue := limit / len(behind)
	if perQueue < 1 {
		perQueue = 1
	}

	type pull struct {
		queue    tailQueue
		messages []*admin.MessageExt
		next     int64
		dropped  int64
		failed   bool
	}

	results := make([]pull, len(behind))
	var waiting sync.WaitGroup
	for index, queue := range behind {
		waiting.Add(1)
		go func(index int, queue tailQueue) {
			defer waiting.Done()
			from := known[queueKey(queue.node, queue.queueID)]
			var returned *admin.PullMessageResult
			err := c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
				var callErr error
				returned, callErr = retryClient.PullMessage(ctx, queue.address, topic, queue.queueID, from, perQueue)
				return callErr
			})
			if err != nil {
				// Keep the place rather than skipping ahead: this queue catches
				// up on the next poll, and nothing is lost by waiting.
				results[index] = pull{queue: queue, next: from, failed: true}
				return
			}
			next := returned.NextBeginOffset
			if next < from {
				next = from
			}
			var dropped int64
			if returned.MinOffset > from {
				// The log rolled past where we were: those messages are gone,
				// and saying so beats a gap nobody notices.
				dropped = returned.MinOffset - from
			}
			results[index] = pull{queue: queue, messages: returned.Messages, next: next, dropped: dropped}
		}(index, queue)
	}
	waiting.Wait()

	failed := 0
	for _, result := range results {
		if result.failed {
			failed++
		}
		for _, message := range result.messages {
			if item := c.convertMessageExt(message); item != nil {
				batch.Messages = append(batch.Messages, item)
			}
		}
		batch.Dropped += result.dropped
		positions = append(positions, model.QueuePosition{
			Node: result.queue.node, QueueID: result.queue.queueID, Offset: result.next,
		})
	}

	// One unreachable broker is a partial tail, not a broken one. Every queue
	// that had something to fetch failing is a different thing, and has to
	// reach the page as an error rather than as a quiet gap.
	if failed == len(behind) {
		return nil, fmt.Errorf("拉取消息失败: Broker 未响应")
	}

	sort.SliceStable(batch.Messages, func(left, right int) bool {
		return batch.Messages[left].StoreTimestamp < batch.Messages[right].StoreTimestamp
	})
	batch.Cursor = model.TailCursor{Positions: sortPositions(positions)}
	return batch, nil
}

// tailQueues lists a topic's readable queues with the address to pull each from.
func (c *Conn) tailQueues(ctx context.Context, topic string) ([]tailQueue, error) {
	var route *admin.TopicRouteData
	err := c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
		var callErr error
		route, callErr = retryClient.ExamineTopicRouteInfo(ctx, topic)
		return callErr
	})
	if err != nil {
		return nil, fmt.Errorf("获取 Topic 路由失败: %w", err)
	}
	if route == nil {
		return nil, fmt.Errorf("Topic 路由为空")
	}

	addresses := make(map[string]string, len(route.BrokerDatas))
	for _, broker := range route.BrokerDatas {
		if broker == nil {
			continue
		}
		address := broker.BrokerAddrs["0"]
		if address == "" {
			for _, candidate := range broker.BrokerAddrs {
				if candidate != "" {
					address = candidate
					break
				}
			}
		}
		if address != "" {
			addresses[broker.BrokerName] = address
		}
	}

	queues := make([]tailQueue, 0)
	for _, queueData := range route.QueueDatas {
		if queueData == nil || queueData.ReadQueueNums <= 0 {
			continue
		}
		address := addresses[queueData.BrokerName]
		if address == "" {
			continue
		}
		for queueID := 0; queueID < queueData.ReadQueueNums; queueID++ {
			queues = append(queues, tailQueue{
				node:    queueData.BrokerName,
				address: address,
				queueID: queueID,
			})
		}
	}
	if len(queues) == 0 {
		return nil, fmt.Errorf("未找到可读消息队列")
	}
	return queues, nil
}

// tailQueueEnds reads where each queue currently ends.
//
// By timestamp rather than by pulling: a search past the newest message
// answers with the queue's end and does not suspend, which is the whole reason
// this runs before any pull.
func (c *Conn) tailQueueEnds(ctx context.Context, topic string, queues []tailQueue) (map[string]int64, error) {
	ends := make(map[string]int64, len(queues))
	var guard sync.Mutex
	var waiting sync.WaitGroup
	failed := 0

	beyondNewest := time.Now().Add(time.Minute).UnixMilli()
	for _, queue := range queues {
		waiting.Add(1)
		go func(queue tailQueue) {
			defer waiting.Done()
			var end int64
			err := c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
				var callErr error
				end, callErr = retryClient.SearchOffset(ctx, queue.address, topic, queue.queueID, beyondNewest)
				return callErr
			})
			guard.Lock()
			defer guard.Unlock()
			if err != nil {
				failed++
				return
			}
			ends[queueKey(queue.node, queue.queueID)] = end
		}(queue)
	}
	waiting.Wait()

	if failed == len(queues) {
		return nil, fmt.Errorf("读取队列位点失败: Broker 未响应")
	}
	// A queue whose end could not be read this time keeps whatever the cursor
	// said, which the caller reads as "nothing new"; it catches up next poll.
	return ends, nil
}

func sortPositions(positions []model.QueuePosition) []model.QueuePosition {
	sort.Slice(positions, func(left, right int) bool {
		if positions[left].Node != positions[right].Node {
			return positions[left].Node < positions[right].Node
		}
		return positions[left].QueueID < positions[right].QueueID
	})
	return positions
}

func queueKey(node string, queueID int) string {
	return fmt.Sprintf("%s:%d", node, queueID)
}
