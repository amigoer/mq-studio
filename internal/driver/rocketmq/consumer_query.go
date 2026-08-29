package rocketmq

import (
	"context"
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

// GetConsumeStats returns consumption statistics.
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
		for _, offset := range stats.OffsetTable {
			if offset == nil {
				continue
			}
			if difference := offset.BrokerOffset - offset.ConsumerOffset; difference > 0 {
				totalDifference += difference
			}
		}
		result = map[string]interface{}{
			"group":      groupName,
			"consumeTps": stats.ConsumeTps,
			"diffTotal":  totalDifference,
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("获取消费统计失败: %w", err)
	}
	return result, nil
}

// GetConsumerClients returns the clients for a consumer group.
func (c *Conn) GetConsumerClients(ctx context.Context, groupName string) ([]model.GroupClient, error) {
	detail, err := c.GetConsumerGroupDetail(ctx, groupName)
	if err != nil {
		return nil, err
	}
	return detail.Clients, nil
}
