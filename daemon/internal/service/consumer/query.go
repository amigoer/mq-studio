package consumer

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
	"github.com/amigoer/rocket-leaf/daemon/internal/rocketmq"
	"github.com/amigoer/rocket-leaf/daemon/internal/service/internal/mqexec"
	"github.com/amigoer/rocket-leaf/daemon/internal/service/internal/resource"
	"github.com/amigoer/rocket-leaf/daemon/internal/service/internal/timestamp"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// GetConsumerGroups returns all consumer groups.
func (s *Service) GetConsumerGroups() ([]*model.ConsumerGroupItem, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return []*model.ConsumerGroupItem{}, nil
	}

	var clusterInfo *admin.ClusterInfo
	err = mqexec.WithTimeout(client, s.settings.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
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
		groupErr := mqexec.WithTimeout(client, s.settings.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
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
				ID:            s.getNextID(),
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
	_ = mqexec.WithTimeout(client, s.settings.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
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
	s.enrichConsumerGroups(client, result, dlqTopics)
	return result, nil
}

// GetConsumerGroupDetail returns details for a consumer group.
func (s *Service) GetConsumerGroupDetail(groupName string) (*model.ConsumerGroupItem, error) {
	groupName = strings.TrimSpace(groupName)
	if groupName == "" {
		return nil, fmt.Errorf("消费者组名称不能为空")
	}
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return nil, fmt.Errorf("获取客户端失败: %w", err)
	}

	item := &model.ConsumerGroupItem{
		ID:            s.getNextID(),
		Group:         groupName,
		ConsumeMode:   model.ModeClustering,
		Status:        model.GroupOffline,
		Lag:           -1,
		DLQ:           -1,
		Subscriptions: make([]model.GroupSubscription, 0),
		Clients:       make([]model.GroupClient, 0),
		LastUpdate:    timestamp.Now(),
	}
	groupConfig, err := s.getSubscriptionGroupConfig(client, groupName)
	if err == nil && groupConfig != nil {
		item.Cluster = groupConfig.Cluster
		item.MaxRetry = groupConfig.Config.RetryMaxTimes
		if groupConfig.Config.ConsumeBroadcastEnable {
			item.ConsumeMode = model.ModeBroadcasting
		}
	}

	s.enrichConsumerGroup(client, item, nil)
	return item, nil
}

// GetConsumeStats returns consumption statistics.
func (s *Service) GetConsumeStats(groupName string) (map[string]interface{}, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return nil, fmt.Errorf("获取客户端失败: %w", err)
	}

	result := map[string]interface{}{}
	err = mqexec.WithTimeout(client, s.settings.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
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
func (s *Service) GetConsumerClients(groupName string) ([]model.GroupClient, error) {
	detail, err := s.GetConsumerGroupDetail(groupName)
	if err != nil {
		return nil, err
	}
	return detail.Clients, nil
}
