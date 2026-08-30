// Package mqoffset queries queue offsets across every broker in a topic route.
package mqoffset

import (
	"context"
	"fmt"
	"sync"
	"time"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// Offset contains the readable range of one topic queue.
type Offset struct {
	BrokerName string
	QueueID    int
	MinOffset  int64
	MaxOffset  int64
}

// Collect queries every readable queue in the topic route instead of relying
// on ExamineTopicStats for only the first broker. It returns an error if any
// queue fails so partial data is never presented as complete.
func Collect(ctx context.Context, client *admin.Client, topic string) ([]Offset, error) {
	route, err := client.ExamineTopicRouteInfo(ctx, topic)
	if err != nil {
		return nil, err
	}
	if route == nil {
		return nil, fmt.Errorf("Topic 路由为空")
	}

	brokerAddrs := make(map[string]string, len(route.BrokerDatas))
	for _, broker := range route.BrokerDatas {
		if broker == nil {
			continue
		}
		addr := broker.BrokerAddrs["0"]
		if addr == "" {
			for _, candidate := range broker.BrokerAddrs {
				if candidate != "" {
					addr = candidate
					break
				}
			}
		}
		if addr != "" {
			brokerAddrs[broker.BrokerName] = addr
		}
	}

	type queueTarget struct {
		brokerName string
		brokerAddr string
		queueID    int
	}
	targets := make([]queueTarget, 0)
	for _, queueData := range route.QueueDatas {
		if queueData == nil || queueData.ReadQueueNums <= 0 {
			continue
		}
		addr := brokerAddrs[queueData.BrokerName]
		if addr == "" {
			return nil, fmt.Errorf("Broker %s 缺少可用地址", queueData.BrokerName)
		}
		for queueID := 0; queueID < queueData.ReadQueueNums; queueID++ {
			targets = append(targets, queueTarget{
				brokerName: queueData.BrokerName,
				brokerAddr: addr,
				queueID:    queueID,
			})
		}
	}
	if len(targets) == 0 {
		return []Offset{}, nil
	}

	type queueResult struct {
		offset Offset
		err    error
	}
	results := make([]queueResult, len(targets))
	semaphore := make(chan struct{}, 6)
	var wg sync.WaitGroup
	for index, target := range targets {
		wg.Add(1)
		go func(i int, current queueTarget) {
			defer wg.Done()
			select {
			case semaphore <- struct{}{}:
				defer func() { <-semaphore }()
			case <-ctx.Done():
				results[i].err = ctx.Err()
				return
			}
			minOffset, minErr := client.SearchOffset(ctx, current.brokerAddr, topic, current.queueID, 0)
			if minErr != nil {
				results[i].err = minErr
				return
			}
			maxOffset, maxErr := client.SearchOffset(
				ctx,
				current.brokerAddr,
				topic,
				current.queueID,
				time.Now().Add(time.Minute).UnixMilli(),
			)
			if maxErr != nil {
				results[i].err = maxErr
				return
			}
			if maxOffset < minOffset {
				maxOffset = minOffset
			}
			results[i].offset = Offset{
				BrokerName: current.brokerName,
				QueueID:    current.queueID,
				MinOffset:  minOffset,
				MaxOffset:  maxOffset,
			}
		}(index, target)
	}
	wg.Wait()

	offsets := make([]Offset, 0, len(results))
	for _, result := range results {
		if result.err != nil {
			return nil, result.err
		}
		offsets = append(offsets, result.offset)
	}
	return offsets, nil
}
