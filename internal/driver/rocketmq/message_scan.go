package rocketmq

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"

	admin "github.com/amigoer/rocketmq-admin-go"
)

type messageQueueScan struct {
	brokerAddress string
	queueID       int
}

// queryMessagesNewest scans readable queues backward and returns the newest matches.
func queryMessagesNewest(
	ctx context.Context,
	client *admin.Client,
	topic, wantedKey, wantedTag string,
	maxResults int,
	startTime, endTime int64,
) ([]*admin.MessageExt, error) {
	route, err := client.ExamineTopicRouteInfo(ctx, topic)
	if err != nil {
		return nil, err
	}
	if route == nil {
		return nil, fmt.Errorf("Topic 路由为空")
	}

	brokerAddresses := make(map[string]string, len(route.BrokerDatas))
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
			brokerAddresses[broker.BrokerName] = address
		}
	}

	queues := make([]messageQueueScan, 0)
	for _, queueData := range route.QueueDatas {
		if queueData == nil || queueData.ReadQueueNums <= 0 {
			continue
		}
		address := brokerAddresses[queueData.BrokerName]
		if address == "" {
			continue
		}
		for queueID := 0; queueID < queueData.ReadQueueNums; queueID++ {
			queues = append(queues, messageQueueScan{brokerAddress: address, queueID: queueID})
		}
	}
	if len(queues) == 0 {
		return nil, fmt.Errorf("未找到可读消息队列")
	}

	type scanResult struct {
		messages []*admin.MessageExt
		err      error
	}
	results := make([]scanResult, len(queues))
	semaphore := make(chan struct{}, 6)
	var waitGroup sync.WaitGroup
	for index, queue := range queues {
		waitGroup.Add(1)
		go func(resultIndex int, current messageQueueScan) {
			defer waitGroup.Done()
			select {
			case semaphore <- struct{}{}:
				defer func() { <-semaphore }()
			case <-ctx.Done():
				results[resultIndex].err = ctx.Err()
				return
			}
			results[resultIndex].messages, results[resultIndex].err = scanMessageQueueNewest(
				ctx, client, current, topic, wantedKey, wantedTag, maxResults, startTime, endTime,
			)
		}(index, queue)
	}
	waitGroup.Wait()

	all := make([]*admin.MessageExt, 0, maxResults*len(queues))
	for _, result := range results {
		if result.err != nil {
			return nil, result.err
		}
		all = append(all, result.messages...)
	}
	sort.Slice(all, func(i, j int) bool {
		return all[i].StoreTimestamp > all[j].StoreTimestamp
	})
	if len(all) > maxResults {
		all = all[:maxResults]
	}
	return all, nil
}

func scanMessageQueueNewest(
	ctx context.Context,
	client *admin.Client,
	queue messageQueueScan,
	topic, wantedKey, wantedTag string,
	maxResults int,
	startTime, endTime int64,
) ([]*admin.MessageExt, error) {
	startOffset, err := client.SearchOffset(ctx, queue.brokerAddress, topic, queue.queueID, startTime)
	if err != nil {
		return nil, err
	}
	endOffset, err := client.SearchOffset(ctx, queue.brokerAddress, topic, queue.queueID, endTime)
	if err != nil {
		return nil, err
	}
	if endOffset < startOffset {
		return []*admin.MessageExt{}, nil
	}

	// SearchOffset returns an offset near the target time. The additional offset
	// includes messages at the upper boundary while timestamp filtering remains exact.
	upper := endOffset + 1
	matches := make([]*admin.MessageExt, 0, maxResults)
	for upper > startOffset && len(matches) < maxResults {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		lower := upper - 32
		if lower < startOffset {
			lower = startOffset
		}
		batchSize := int(upper - lower)
		if batchSize <= 0 {
			break
		}
		pulled, pullErr := client.PullMessage(ctx, queue.brokerAddress, topic, queue.queueID, lower, batchSize)
		if pullErr != nil {
			return nil, pullErr
		}
		if pulled == nil {
			return nil, fmt.Errorf("Broker 返回空拉取结果")
		}
		for _, message := range pulled.Messages {
			if message == nil || message.QueueOffset < lower || message.QueueOffset >= upper ||
				message.StoreTimestamp < startTime || message.StoreTimestamp > endTime {
				continue
			}
			if wantedKey != "" && !containsExactMessageKey(message.Properties["KEYS"], wantedKey) {
				continue
			}
			if wantedTag != "" && strings.TrimSpace(message.Properties["TAGS"]) != wantedTag {
				continue
			}
			matches = append(matches, message)
		}
		upper = lower
	}
	sort.Slice(matches, func(i, j int) bool {
		return matches[i].StoreTimestamp > matches[j].StoreTimestamp
	})
	if len(matches) > maxResults {
		matches = matches[:maxResults]
	}
	return matches, nil
}
