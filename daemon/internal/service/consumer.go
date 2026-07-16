package service

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
	"github.com/amigoer/rocket-leaf/daemon/internal/rocketmq"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// ConsumerService manages consumer groups.
type ConsumerService struct {
	nextID          int64
	settingsService *SettingsService
}

// NewConsumerService creates a consumer group service.
func NewConsumerService(settingsService *SettingsService) *ConsumerService {
	return &ConsumerService{
		nextID:          1,
		settingsService: settingsService,
	}
}

func (s *ConsumerService) getNextID() int {
	return int(atomic.AddInt64(&s.nextID, 1))
}

// GetConsumerGroups returns all consumer groups.
func (s *ConsumerService) GetConsumerGroups() ([]*model.ConsumerGroupItem, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		// Return an empty list when no connection is available.
		return []*model.ConsumerGroupItem{}, nil
	}

	var clusterInfo *admin.ClusterInfo
	err = executeWithClientRetryTimeout(client, s.settingsService.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
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
		masterAddr := brokerData.BrokerAddrs["0"]
		if masterAddr == "" {
			continue
		}
		var subGroups map[string]*admin.SubscriptionGroupConfig
		groupErr := executeWithClientRetryTimeout(client, s.settingsService.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
			var callErr error
			subGroups, callErr = retryClient.GetAllSubscriptionGroup(ctx, masterAddr)
			return callErr
		})
		if groupErr != nil {
			if firstBrokerErr == nil {
				firstBrokerErr = groupErr
			}
			continue
		}
		successfulBrokerReads++
		for groupName, config := range subGroups {
			if config == nil || isSystemGroup(groupName) {
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
				LastUpdate:    formatNow(),
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
	_ = executeWithClientRetryTimeout(client, s.settingsService.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
		topics, callErr := retryClient.FetchAllTopicList(ctx)
		if callErr != nil {
			return callErr
		}
		dlqTopics = make(map[string]struct{})
		for _, topic := range topics.TopicList {
			if strings.HasPrefix(topic, "%DLQ%") {
				dlqTopics[topic] = struct{}{}
			}
		}
		return nil
	})
	s.enrichConsumerGroups(client, result, dlqTopics)

	return result, nil
}

func (s *ConsumerService) enrichConsumerGroups(client *admin.Client, groups []*model.ConsumerGroupItem, dlqTopics map[string]struct{}) {
	const maxConcurrent = 6
	semaphore := make(chan struct{}, maxConcurrent)
	var wg sync.WaitGroup
	for _, item := range groups {
		if item == nil {
			continue
		}
		wg.Add(1)
		go func(group *model.ConsumerGroupItem) {
			defer wg.Done()
			semaphore <- struct{}{}
			defer func() { <-semaphore }()
			s.enrichConsumerGroup(client, group, dlqTopics)
		}(item)
	}
	wg.Wait()
}

func (s *ConsumerService) enrichConsumerGroup(client *admin.Client, item *model.ConsumerGroupItem, dlqTopics map[string]struct{}) {
	if item == nil {
		return
	}
	item.Subscriptions = item.Subscriptions[:0]
	item.Clients = item.Clients[:0]
	connErr := executeWithClientRetryTimeout(client, s.settingsService.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
		connInfo, callErr := retryClient.ExamineConsumerConnectionInfo(ctx, item.Group)
		if callErr != nil {
			return callErr
		}
		if connInfo == nil {
			return nil
		}
		item.OnlineClients = len(connInfo.ConnectionSet)
		if item.OnlineClients > 0 {
			item.Status = model.GroupOnline
		} else {
			item.Status = model.GroupOffline
		}
		for _, conn := range connInfo.ConnectionSet {
			if conn == nil {
				continue
			}
			item.Clients = append(item.Clients, model.GroupClient{
				ClientID:      conn.ClientId,
				IP:            conn.ClientAddr,
				Version:       fmt.Sprintf("%d", conn.Version),
				LastHeartbeat: formatNow(),
			})
		}
		for topic, expr := range connInfo.SubscriptionTable {
			if expr == nil {
				continue
			}
			item.Subscriptions = append(item.Subscriptions, model.GroupSubscription{
				Topic:      topic,
				Expression: expr.SubString,
			})
		}
		sort.Slice(item.Subscriptions, func(i, j int) bool {
			return item.Subscriptions[i].Topic < item.Subscriptions[j].Topic
		})
		item.TopicCount = len(item.Subscriptions)
		return nil
	})
	if connErr != nil {
		item.Status = model.GroupWarning
	}

	_ = executeWithClientRetryTimeout(client, s.settingsService.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
		stats, callErr := retryClient.ExamineConsumeStats(ctx, item.Group)
		if callErr != nil {
			return callErr
		}
		if stats == nil {
			return fmt.Errorf("Broker 返回空消费统计")
		}
		var lag int64
		for _, offset := range stats.OffsetTable {
			if offset == nil {
				continue
			}
			if diff := offset.BrokerOffset - offset.ConsumerOffset; diff > 0 {
				lag += diff
			}
		}
		item.Lag = lag
		return nil
	})

	dlqTopic := "%DLQ%" + item.Group
	if dlqTopics != nil {
		if _, exists := dlqTopics[dlqTopic]; !exists {
			item.DLQ = 0
			item.LastUpdate = formatNow()
			return
		}
	}
	_ = executeWithClientRetryTimeout(client, s.settingsService.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
		offsets, callErr := collectTopicQueueOffsets(ctx, retryClient, dlqTopic)
		if callErr != nil {
			if errors.Is(callErr, admin.ErrTopicNotFound) {
				item.DLQ = 0
				return nil
			}
			return callErr
		}
		var total int64
		for _, offset := range offsets {
			if offset.MaxOffset > offset.MinOffset {
				total += offset.MaxOffset - offset.MinOffset
			}
		}
		item.DLQ = int(total)
		return nil
	})
	item.LastUpdate = formatNow()
}

// GetConsumerGroupDetail returns details for a consumer group.
func (s *ConsumerService) GetConsumerGroupDetail(groupName string) (*model.ConsumerGroupItem, error) {
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
		LastUpdate:    formatNow(),
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
func (s *ConsumerService) GetConsumeStats(groupName string) (map[string]interface{}, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return nil, fmt.Errorf("获取客户端失败: %w", err)
	}

	// ExamineConsumeStats accepts only one argument.
	result := map[string]interface{}{}
	err = executeWithClientRetryTimeout(client, s.settingsService.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
		// ExamineConsumeStats accepts only one argument.
		stats, callErr := retryClient.ExamineConsumeStats(ctx, groupName)
		if callErr != nil {
			return callErr
		}
		if stats == nil {
			return fmt.Errorf("Broker 返回空消费统计")
		}

		// Calculate the total lag.
		var totalDiff int64
		for _, offset := range stats.OffsetTable {
			if offset == nil {
				continue
			}
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

// CreateConsumerGroup creates a consumer group.
func (s *ConsumerService) CreateConsumerGroup(group string, brokerAddr string, consumeMode string, maxRetry int) error {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return fmt.Errorf("获取客户端失败: %w", err)
	}

	group, brokerAddr, consumeMode, maxRetry, err = validateConsumerGroupInput(group, brokerAddr, consumeMode, maxRetry)
	if err != nil {
		return err
	}
	candidates, err := s.resolveMasterBrokerAddrs(client, brokerAddr)
	if err != nil {
		return fmt.Errorf("创建消费者组失败: %w", err)
	}

	// Create the group through CreateSubscriptionGroup.
	config := admin.SubscriptionGroupConfig{
		GroupName:              group,
		ConsumeEnable:          true,
		ConsumeFromMinEnable:   true,
		ConsumeBroadcastEnable: consumeMode == string(model.ModeBroadcasting),
		RetryMaxTimes:          maxRetry,
	}

	return s.applySubscriptionGroupConfig(client, candidates, config, "创建")
}

// UpdateConsumerGroup updates a consumer group configuration.
func (s *ConsumerService) UpdateConsumerGroup(group string, brokerAddr string, consumeMode string, maxRetry int) error {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return fmt.Errorf("获取客户端失败: %w", err)
	}

	group, brokerAddr, consumeMode, maxRetry, err = validateConsumerGroupInput(group, brokerAddr, consumeMode, maxRetry)
	if err != nil {
		return err
	}

	// Resolve all master broker addresses first.
	candidates, resolveErr := s.resolveMasterBrokerAddrs(client, brokerAddr)
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

	return s.applySubscriptionGroupConfig(client, candidates, config, "更新")
}

// DeleteConsumerGroup deletes a consumer group.
func (s *ConsumerService) DeleteConsumerGroup(group string, brokerAddr string) error {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return fmt.Errorf("获取客户端失败: %w", err)
	}

	group = strings.TrimSpace(group)
	brokerAddr = strings.TrimSpace(brokerAddr)
	if group == "" {
		return fmt.Errorf("删除消费者组失败: 消费者组名称不能为空")
	}
	candidates, err := s.resolveMasterBrokerAddrs(client, brokerAddr)
	if err != nil {
		return fmt.Errorf("删除消费者组失败: %w", err)
	}

	failures := make([]string, 0)
	for _, addr := range candidates {
		callErr := executeWithClientRetryTimeout(client, s.settingsService.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
			return retryClient.DeleteSubscriptionGroup(ctx, addr, group)
		})
		if callErr != nil {
			failures = append(failures, fmt.Sprintf("%s: %v", addr, callErr))
		}
	}
	if len(failures) > 0 {
		return fmt.Errorf("删除消费者组时部分 Broker 失败: %s", strings.Join(failures, "; "))
	}
	return nil
}

// ResetOffset resets consumer offsets.
func (s *ConsumerService) ResetOffset(group string, topic string, timestamp int64, force bool) error {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return fmt.Errorf("获取客户端失败: %w", err)
	}

	group = strings.TrimSpace(group)
	topic = strings.TrimSpace(topic)
	if group == "" || topic == "" {
		return fmt.Errorf("重置消费位点失败: 消费者组和 Topic 不能为空")
	}
	if timestamp < 0 {
		return fmt.Errorf("重置消费位点失败: 时间戳不能为负数")
	}

	err = executeWithClientRetryTimeout(client, s.settingsService.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
		_, callErr := retryClient.ResetOffsetByTimestamp(ctx, topic, group, timestamp, force)
		return callErr
	})
	if err != nil {
		return fmt.Errorf("重置消费位点失败: %w", err)
	}

	return nil
}

// GetConsumerClients returns the clients for a consumer group.
func (s *ConsumerService) GetConsumerClients(groupName string) ([]model.GroupClient, error) {
	detail, err := s.GetConsumerGroupDetail(groupName)
	if err != nil {
		return nil, err
	}
	return detail.Clients, nil
}

// isSystemGroup reports whether a consumer group is reserved for system use.
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

func validateConsumerGroupInput(group, brokerAddr, consumeMode string, maxRetry int) (string, string, string, int, error) {
	group = strings.TrimSpace(group)
	brokerAddr = strings.TrimSpace(brokerAddr)
	if group == "" || brokerAddr == "" {
		return "", "", "", 0, fmt.Errorf("消费者组名称和 Broker 地址不能为空")
	}
	if consumeMode != string(model.ModeClustering) && consumeMode != string(model.ModeBroadcasting) {
		return "", "", "", 0, fmt.Errorf("不支持的消费模式: %s", consumeMode)
	}
	if maxRetry < 0 || maxRetry > 64 {
		return "", "", "", 0, fmt.Errorf("最大重试次数必须在 0-64 之间")
	}
	return group, brokerAddr, consumeMode, maxRetry, nil
}

func (s *ConsumerService) applySubscriptionGroupConfig(client *admin.Client, candidates []string, config admin.SubscriptionGroupConfig, operation string) error {
	if len(candidates) == 0 {
		return fmt.Errorf("%s消费者组失败: 未找到可用 Broker", operation)
	}
	failures := make([]string, 0)
	for _, addr := range candidates {
		callErr := executeWithClientRetryTimeout(client, s.settingsService.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
			return retryClient.CreateSubscriptionGroup(ctx, addr, config)
		})
		if callErr != nil {
			failures = append(failures, fmt.Sprintf("%s: %v", addr, callErr))
		}
	}
	if len(failures) > 0 {
		return fmt.Errorf("%s消费者组时部分 Broker 失败: %s", operation, strings.Join(failures, "; "))
	}
	return nil
}

func (s *ConsumerService) getSubscriptionGroupConfig(client *admin.Client, groupName string) (*subscriptionGroupLookup, error) {
	var clusterInfo *admin.ClusterInfo
	err := executeWithClientRetryTimeout(client, s.settingsService.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
		var callErr error
		clusterInfo, callErr = retryClient.ExamineBrokerClusterInfo(ctx)
		return callErr
	})
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

		var subGroups map[string]*admin.SubscriptionGroupConfig
		groupErr := executeWithClientRetryTimeout(client, s.settingsService.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
			var callErr error
			subGroups, callErr = retryClient.GetAllSubscriptionGroup(ctx, masterAddr)
			return callErr
		})
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

func (s *ConsumerService) resolveMasterBrokerAddrs(client *admin.Client, preferredAddr string) ([]string, error) {
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

	var clusterInfo *admin.ClusterInfo
	err := executeWithClientRetryTimeout(client, s.settingsService.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
		var callErr error
		clusterInfo, callErr = retryClient.ExamineBrokerClusterInfo(ctx)
		return callErr
	})
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
