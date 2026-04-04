package service

import (
	"context"
	"fmt"
	"sync/atomic"

	"rocket-leaf/internal/model"
	"rocket-leaf/internal/rocketmq"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// ConsumerService 消费者组服务
type ConsumerService struct {
	nextID          int64
	settingsService *SettingsService
}

// NewConsumerService 创建消费者组服务
func NewConsumerService(settingsService *SettingsService) *ConsumerService {
	return &ConsumerService{
		nextID:          1,
		settingsService: settingsService,
	}
}

func (s *ConsumerService) getNextID() int {
	return int(atomic.AddInt64(&s.nextID, 1))
}

// GetConsumerGroups 获取所有消费者组列表
func (s *ConsumerService) GetConsumerGroups() ([]*model.ConsumerGroupItem, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		// 无连接时返回空列表
		return []*model.ConsumerGroupItem{}, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
	defer cancel()

	result := make([]*model.ConsumerGroupItem, 0)
	err = executeWithClientRetry(client, func(retryClient *admin.Client) error {
		clusterInfo, callErr := retryClient.ExamineBrokerClusterInfo(ctx)
		if callErr != nil {
			return callErr
		}

		tmpResult := make([]*model.ConsumerGroupItem, 0)
		processedGroups := make(map[string]bool)

		for _, brokerData := range clusterInfo.BrokerAddrTable {
			// BrokerAddrs 是 map[string]string
			masterAddr, ok := brokerData.BrokerAddrs["0"]
			if !ok {
				continue
			}

			// GetAllSubscriptionGroup 返回 map[string]*SubscriptionGroupConfig
			subGroups, groupErr := retryClient.GetAllSubscriptionGroup(ctx, masterAddr)
			if groupErr != nil || subGroups == nil {
				continue
			}

			for groupName, config := range subGroups {
				if isSystemGroup(groupName) {
					continue
				}

				if processedGroups[groupName] {
					continue
				}
				processedGroups[groupName] = true

				item := &model.ConsumerGroupItem{
					ID:          s.getNextID(),
					Group:       groupName,
					Cluster:     brokerData.Cluster,
					ConsumeMode: model.ModeClustering,
					Status:      model.GroupOffline,
					MaxRetry:    config.RetryMaxTimes,
					LastUpdate:  formatNow(),
				}
				if config.ConsumeBroadcastEnable {
					item.ConsumeMode = model.ModeBroadcasting
				}

				connInfo, connErr := retryClient.ExamineConsumerConnectionInfo(ctx, groupName)
				if connErr == nil && connInfo != nil {
					item.OnlineClients = len(connInfo.ConnectionSet)
					if item.OnlineClients > 0 {
						item.Status = model.GroupOnline
					}

					for _, conn := range connInfo.ConnectionSet {
						c := model.GroupClient{
							ClientID:      conn.ClientId,
							IP:            conn.ClientAddr,
							Version:       fmt.Sprintf("%d", conn.Version),
							LastHeartbeat: formatNow(),
						}
						item.Clients = append(item.Clients, c)
					}

					for topic, expr := range connInfo.SubscriptionTable {
						sub := model.GroupSubscription{
							Topic:      topic,
							Expression: expr.SubString,
						}
						item.Subscriptions = append(item.Subscriptions, sub)
					}
					item.TopicCount = len(item.Subscriptions)
				}

				tmpResult = append(tmpResult, item)
			}
		}

		result = tmpResult
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("获取消费者组失败: %w", err)
	}

	return result, nil
}

// GetConsumerGroupDetail 获取消费者组详情
func (s *ConsumerService) GetConsumerGroupDetail(groupName string) (*model.ConsumerGroupItem, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return nil, fmt.Errorf("获取客户端失败: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
	defer cancel()

	item := &model.ConsumerGroupItem{
		ID:            s.getNextID(),
		Group:         groupName,
		ConsumeMode:   model.ModeClustering,
		Status:        model.GroupOffline,
		Subscriptions: make([]model.GroupSubscription, 0),
		Clients:       make([]model.GroupClient, 0),
		LastUpdate:    formatNow(),
	}

	groupConfig, err := s.getSubscriptionGroupConfig(ctx, client, groupName)
	if err == nil && groupConfig != nil {
		item.Cluster = groupConfig.Cluster
		item.MaxRetry = groupConfig.Config.RetryMaxTimes
		if groupConfig.Config.ConsumeBroadcastEnable {
			item.ConsumeMode = model.ModeBroadcasting
		}
	}

	err = executeWithClientRetry(client, func(retryClient *admin.Client) error {
		connInfo, callErr := retryClient.ExamineConsumerConnectionInfo(ctx, groupName)
		if callErr != nil {
			return callErr
		}
		if connInfo == nil {
			return nil
		}

		item.OnlineClients = len(connInfo.ConnectionSet)
		if item.OnlineClients > 0 {
			item.Status = model.GroupOnline
		}

		for _, conn := range connInfo.ConnectionSet {
			c := model.GroupClient{
				ClientID:      conn.ClientId,
				IP:            conn.ClientAddr,
				Version:       fmt.Sprintf("%d", conn.Version),
				LastHeartbeat: formatNow(),
			}
			item.Clients = append(item.Clients, c)
		}

		for topic, expr := range connInfo.SubscriptionTable {
			sub := model.GroupSubscription{
				Topic:      topic,
				Expression: expr.SubString,
			}
			item.Subscriptions = append(item.Subscriptions, sub)
		}
		item.TopicCount = len(item.Subscriptions)
		return nil
	})
	if err != nil && !isRetryableNetworkError(err) {
		return nil, fmt.Errorf("获取消费者组详情失败: %w", err)
	}

	return item, nil
}

// GetConsumeStats 获取消费统计信息
func (s *ConsumerService) GetConsumeStats(groupName string) (map[string]interface{}, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return nil, fmt.Errorf("获取客户端失败: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
	defer cancel()

	// ExamineConsumeStats 只有一个参数
	result := map[string]interface{}{}
	err = executeWithClientRetry(client, func(retryClient *admin.Client) error {
		// ExamineConsumeStats 只有一个参数
		stats, callErr := retryClient.ExamineConsumeStats(ctx, groupName)
		if callErr != nil {
			return callErr
		}

		// 计算总延迟
		var totalDiff int64
		for _, offset := range stats.OffsetTable {
			diff := offset.BrokerOffset - offset.ConsumerOffset
			if diff > 0 {
				totalDiff += diff
			}
		}

		result = map[string]interface{}{
			"group":      groupName,
			"consumeTps": stats.ConsumeTps,
			"diffTotal":  totalDiff,
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("获取消费统计失败: %w", err)
	}
	return result, nil
}

// CreateConsumerGroup 创建消费者组
func (s *ConsumerService) CreateConsumerGroup(group string, brokerAddr string, consumeMode string, maxRetry int) error {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return fmt.Errorf("获取客户端失败: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
	defer cancel()

	// 使用 CreateSubscriptionGroup
	config := admin.SubscriptionGroupConfig{
		GroupName:              group,
		ConsumeEnable:          true,
		ConsumeFromMinEnable:   true,
		ConsumeBroadcastEnable: consumeMode == string(model.ModeBroadcasting),
		RetryMaxTimes:          maxRetry,
	}

	err = executeWithClientRetry(client, func(retryClient *admin.Client) error {
		return retryClient.CreateSubscriptionGroup(ctx, brokerAddr, config)
	})
	if err != nil {
		return fmt.Errorf("创建消费者组失败: %w", err)
	}

	return nil
}

// UpdateConsumerGroup 更新消费者组配置
func (s *ConsumerService) UpdateConsumerGroup(group string, brokerAddr string, consumeMode string, maxRetry int) error {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return fmt.Errorf("获取客户端失败: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
	defer cancel()

	// 先查询所有 master broker 地址
	candidates, resolveErr := s.resolveMasterBrokerAddrs(ctx, client, brokerAddr)
	if resolveErr != nil {
		return fmt.Errorf("更新消费者组失败: %w", resolveErr)
	}

	config := admin.SubscriptionGroupConfig{
		GroupName:              group,
		ConsumeEnable:          true,
		ConsumeFromMinEnable:   true,
		ConsumeBroadcastEnable: consumeMode == string(model.ModeBroadcasting),
		RetryMaxTimes:          maxRetry,
	}

	var lastErr error
	for _, addr := range candidates {
		callErr := executeWithClientRetry(client, func(retryClient *admin.Client) error {
			return retryClient.CreateSubscriptionGroup(ctx, addr, config)
		})
		if callErr == nil {
			return nil
		}
		lastErr = callErr
	}

	if lastErr != nil {
		return fmt.Errorf("更新消费者组失败: %w", lastErr)
	}

	return fmt.Errorf("更新消费者组失败: 未找到可用 Broker")
}

// DeleteConsumerGroup 删除消费者组
func (s *ConsumerService) DeleteConsumerGroup(group string, brokerAddr string) error {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return fmt.Errorf("获取客户端失败: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
	defer cancel()

	candidates, err := s.resolveMasterBrokerAddrs(ctx, client, brokerAddr)
	if err != nil {
		return fmt.Errorf("删除消费者组失败: %w", err)
	}

	var lastErr error
	for _, addr := range candidates {
		callErr := executeWithClientRetry(client, func(retryClient *admin.Client) error {
			return retryClient.DeleteSubscriptionGroup(ctx, addr, group)
		})
		if callErr == nil {
			return nil
		}
		lastErr = callErr
	}

	if lastErr != nil {
		return fmt.Errorf("删除消费者组失败: %w", lastErr)
	}

	return fmt.Errorf("删除消费者组失败: 未找到可用 Broker")
}

// ResetOffset 重置消费位点
func (s *ConsumerService) ResetOffset(group string, topic string, timestamp int64, force bool) error {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return fmt.Errorf("获取客户端失败: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
	defer cancel()

	err = executeWithClientRetry(client, func(retryClient *admin.Client) error {
		_, callErr := retryClient.ResetOffsetByTimestamp(ctx, topic, group, timestamp, force)
		return callErr
	})
	if err != nil {
		return fmt.Errorf("重置消费位点失败: %w", err)
	}

	return nil
}

// GetConsumerClients 获取消费者客户端列表
func (s *ConsumerService) GetConsumerClients(groupName string) ([]model.GroupClient, error) {
	detail, err := s.GetConsumerGroupDetail(groupName)
	if err != nil {
		return nil, err
	}
	return detail.Clients, nil
}

// 判断是否为系统消费者组
func isSystemGroup(group string) bool {
	systemGroups := []string{
		"CID_ONSAPI_OWNER",
		"CID_ONSAPI_PERMISSION",
		"CID_ONSAPI_PULL",
		"CID_RMQ_SYS_TRANS",
		"TOOLS_CONSUMER",
		"FILTERSRV_CONSUMER",
		"__MONITOR_CONSUMER",
		"CLIENT_INNER_PRODUCER",
		"SELF_TEST_C_GROUP",
		"SELF_TEST_P_GROUP",
		"CID_RMQ_SYS_TRACE",
	}

	for _, sg := range systemGroups {
		if group == sg {
			return true
		}
	}

	if len(group) > 10 && group[:10] == "CID_ONSAPI" {
		return true
	}

	return false
}

type subscriptionGroupLookup struct {
	Cluster string
	Config  *admin.SubscriptionGroupConfig
}

func (s *ConsumerService) getSubscriptionGroupConfig(ctx context.Context, client *admin.Client, groupName string) (*subscriptionGroupLookup, error) {
	clusterInfo, err := getClusterInfoWithRetry(ctx, client)
	if err != nil {
		return nil, err
	}

	for _, brokerData := range clusterInfo.BrokerAddrTable {
		if brokerData == nil {
			continue
		}
		masterAddr, ok := brokerData.BrokerAddrs["0"]
		if !ok || masterAddr == "" {
			continue
		}

		subGroups, groupErr := getAllSubscriptionGroupsWithRetry(ctx, client, masterAddr)
		if groupErr != nil || subGroups == nil {
			continue
		}

		if config, exists := subGroups[groupName]; exists && config != nil {
			return &subscriptionGroupLookup{
				Cluster: brokerData.Cluster,
				Config:  config,
			}, nil
		}
	}

	return nil, nil
}

func (s *ConsumerService) resolveMasterBrokerAddrs(ctx context.Context, client *admin.Client, preferredAddr string) ([]string, error) {
	addresses := make([]string, 0, 4)
	seen := make(map[string]struct{})
	appendAddr := func(addr string) {
		if addr == "" {
			return
		}
		if _, exists := seen[addr]; exists {
			return
		}
		seen[addr] = struct{}{}
		addresses = append(addresses, addr)
	}

	appendAddr(preferredAddr)

	clusterInfo, err := getClusterInfoWithRetry(ctx, client)
	if err != nil {
		if len(addresses) > 0 {
			return addresses, nil
		}
		return nil, err
	}

	for _, brokerData := range clusterInfo.BrokerAddrTable {
		if brokerData == nil {
			continue
		}
		appendAddr(brokerData.BrokerAddrs["0"])
	}

	if len(addresses) == 0 {
		return nil, fmt.Errorf("未找到可用 Broker")
	}

	return addresses, nil
}

func getClusterInfoWithRetry(ctx context.Context, client *admin.Client) (*admin.ClusterInfo, error) {
	var result *admin.ClusterInfo
	err := executeWithClientRetry(client, func(retryClient *admin.Client) error {
		clusterInfo, callErr := retryClient.ExamineBrokerClusterInfo(ctx)
		if callErr != nil {
			return callErr
		}
		result = clusterInfo
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

func getAllSubscriptionGroupsWithRetry(ctx context.Context, client *admin.Client, brokerAddr string) (map[string]*admin.SubscriptionGroupConfig, error) {
	var result map[string]*admin.SubscriptionGroupConfig
	err := executeWithClientRetry(client, func(retryClient *admin.Client) error {
		subGroups, callErr := retryClient.GetAllSubscriptionGroup(ctx, brokerAddr)
		if callErr != nil {
			return callErr
		}
		result = subGroups
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}
