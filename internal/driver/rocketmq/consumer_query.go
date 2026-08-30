package rocketmq

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/amigoer/mq-studio/internal/driver/rocketmq/resource"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/timestamp"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// GetConsumerGroups returns all consumer groups.
func (c *Conn) GetConsumerGroups(ctx context.Context) ([]*model.ConsumerGroupItem, error) {

	var clusterInfo *admin.ClusterInfo
	err := c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
		var callErr error
		clusterInfo, callErr = retryClient.ExamineBrokerClusterInfo(ctx)
		return callErr
	})
	if err != nil {
		return nil, fmt.Errorf("获取消费者组失败: %w", err)
	}

	groupMap := make(map[string]*model.ConsumerGroupItem)
	var firstBrokerErr error
	successfulBrokerReads := 0
	for _, brokerData := range clusterInfo.BrokerAddrTable {
		if brokerData == nil {
			continue
		}
		masterAddress := brokerData.BrokerAddrs["0"]
		if masterAddress == "" {
			continue
		}

		var subscriptionGroups map[string]*admin.SubscriptionGroupConfig
		groupErr := c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
			var callErr error
			subscriptionGroups, callErr = retryClient.GetAllSubscriptionGroup(ctx, masterAddress)
			return callErr
		})
		if groupErr != nil {
			if firstBrokerErr == nil {
				firstBrokerErr = groupErr
			}
			continue
		}
		successfulBrokerReads++
		for groupName, config := range subscriptionGroups {
			if config == nil || resource.IsSystemGroup(groupName) {
				continue
			}
			if _, exists := groupMap[groupName]; exists {
				continue
			}
			item := &model.ConsumerGroupItem{
				Group:         groupName,
				Cluster:       brokerData.Cluster,
				ConsumeMode:   model.ModeClustering,
				Status:        model.GroupOffline,
				Lag:           -1,
				DLQ:           -1,
				MaxRetry:      config.RetryMaxTimes,
				LastUpdate:    timestamp.Now(),
				Subscriptions: make([]model.GroupSubscription, 0),
				Clients:       make([]model.GroupClient, 0),
			}
			if config.ConsumeBroadcastEnable {
				item.ConsumeMode = model.ModeBroadcasting
			}
			groupMap[groupName] = item
		}
	}
	if successfulBrokerReads == 0 && firstBrokerErr != nil {
		return nil, fmt.Errorf("获取消费者组配置失败: %w", firstBrokerErr)
	}

	result := make([]*model.ConsumerGroupItem, 0, len(groupMap))
	for _, item := range groupMap {
		result = append(result, item)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Group < result[j].Group })

	var dlqTopics map[string]struct{}
	_ = c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
		topics, callErr := retryClient.FetchAllTopicList(ctx)
		if callErr != nil {
			return callErr
		}
		dlqTopics = make(map[string]struct{})
		for _, topicName := range topics.TopicList {
			if strings.HasPrefix(topicName, "%DLQ%") {
				dlqTopics[topicName] = struct{}{}
			}
		}
		return nil
	})
	c.enrichConsumerGroups(ctx, result, dlqTopics)
	return result, nil
}

// GetConsumerGroupDetail returns details for a consumer group.
func (c *Conn) GetConsumerGroupDetail(ctx context.Context, groupName string) (*model.ConsumerGroupItem, error) {
	groupName = strings.TrimSpace(groupName)
	if groupName == "" {
		return nil, fmt.Errorf("消费者组名称不能为空")
	}

	item := &model.ConsumerGroupItem{
		Group:         groupName,
		ConsumeMode:   model.ModeClustering,
		Status:        model.GroupOffline,
		Lag:           -1,
		DLQ:           -1,
		Subscriptions: make([]model.GroupSubscription, 0),
		Clients:       make([]model.GroupClient, 0),
		LastUpdate:    timestamp.Now(),
	}
	groupConfig, err := c.getSubscriptionGroupConfig(ctx, groupName)
	if err == nil && groupConfig != nil {
		item.Cluster = groupConfig.Cluster
		item.MaxRetry = groupConfig.Config.RetryMaxTimes
		if groupConfig.Config.ConsumeBroadcastEnable {
			item.ConsumeMode = model.ModeBroadcasting
		}
	}

	c.enrichConsumerGroup(ctx, item, nil)
	return item, nil
}

// GetConsumeStats returns consumption statistics, per queue and in total.
//
// The per-queue rows are the point of it: a group-level backlog says a group
// is behind, and only this says whether one queue is carrying all of it -
// which is the difference between a slow consumer and a stuck one.
func (c *Conn) GetConsumeStats(ctx context.Context, groupName string) (map[string]interface{}, error) {

	result := map[string]interface{}{}
	err := c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
		stats, callErr := retryClient.ExamineConsumeStats(ctx, groupName)
		if callErr != nil {
			return callErr
		}
		if stats == nil {
			return fmt.Errorf("Broker 返回空消费统计")
		}

		var totalDifference int64
		queues := make([]map[string]interface{}, 0, len(stats.OffsetTable))
		for key, offset := range stats.OffsetTable {
			if offset == nil {
				continue
			}
			difference := offset.BrokerOffset - offset.ConsumerOffset
			if difference > 0 {
				totalDifference += difference
			}
			queue := parseMessageQueueKey(key)
			queues = append(queues, map[string]interface{}{
				"topic":          queue.Topic,
				"brokerName":     queue.BrokerName,
				"queueId":        queue.QueueID,
				"brokerOffset":   offset.BrokerOffset,
				"consumerOffset": offset.ConsumerOffset,
				"backlog":        difference,
				"lastConsumed":   offset.LastTimestamp,
			})
		}
		sortQueueRows(queues)

		result = map[string]interface{}{
			"group":      groupName,
			"consumeTps": stats.ConsumeTps,
			"diffTotal":  totalDifference,
			"queues":     queues,
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("获取消费统计失败: %w", err)
	}
	return result, nil
}

// messageQueue is the shape RocketMQ uses as a map key. The library hands it
// back as the JSON text of that object, once its Fastjson fixer has quoted it.
type messageQueue struct {
	Topic      string `json:"topic"`
	BrokerName string `json:"brokerName"`
	QueueID    int    `json:"queueId"`
}

// parseMessageQueueKey reads one offset-table key.
//
// A key it cannot read is not dropped: the offsets behind it are still true,
// and a row with a blank topic reads better than a backlog that silently does
// not add up to the total beside it.
func parseMessageQueueKey(key string) messageQueue {
	var queue messageQueue
	if err := json.Unmarshal([]byte(key), &queue); err != nil {
		return messageQueue{QueueID: -1}
	}
	return queue
}

func sortQueueRows(queues []map[string]interface{}) {
	sort.Slice(queues, func(left, right int) bool {
		leftTopic, _ := queues[left]["topic"].(string)
		rightTopic, _ := queues[right]["topic"].(string)
		if leftTopic != rightTopic {
			return leftTopic < rightTopic
		}
		leftBroker, _ := queues[left]["brokerName"].(string)
		rightBroker, _ := queues[right]["brokerName"].(string)
		if leftBroker != rightBroker {
			return leftBroker < rightBroker
		}
		leftQueue, _ := queues[left]["queueId"].(int)
		rightQueue, _ := queues[right]["queueId"].(int)
		return leftQueue < rightQueue
	})
}

// GetConsumerClients returns the clients for a consumer group.
func (c *Conn) GetConsumerClients(ctx context.Context, groupName string) ([]model.GroupClient, error) {
	detail, err := c.GetConsumerGroupDetail(ctx, groupName)
	if err != nil {
		return nil, err
	}
	return detail.Clients, nil
}
