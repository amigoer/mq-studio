package service

import (
	"context"
	"fmt"
	"strings"
	"sync/atomic"

	"rocket-leaf/internal/model"
	"rocket-leaf/internal/rocketmq"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// TopicService Topic 管理服务
type TopicService struct {
	nextID          int64
	settingsService *SettingsService
}

// NewTopicService 创建 Topic 管理服务
func NewTopicService(settingsService *SettingsService) *TopicService {
	return &TopicService{
		nextID:          1,
		settingsService: settingsService,
	}
}

func (s *TopicService) getNextID() int {
	return int(atomic.AddInt64(&s.nextID, 1))
}

// GetTopics 获取所有 Topic 列表
func (s *TopicService) GetTopics() ([]*model.TopicItem, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		// 无连接时返回空列表
		return []*model.TopicItem{}, nil
	}

	result := make([]*model.TopicItem, 0)
	err = executeWithClientRetry(client, func(retryClient *admin.Client) error {
		ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
		defer cancel()

		topicList, callErr := retryClient.FetchAllTopicList(ctx)
		if callErr != nil {
			return callErr
		}

		tmpResult := make([]*model.TopicItem, 0, len(topicList.TopicList))
		for _, topic := range topicList.TopicList {
			if isSystemTopic(topic) {
				continue
			}

			item := &model.TopicItem{
				ID:          s.getNextID(),
				Topic:       topic,
				ReadQueue:   -1,
				WriteQueue:  -1,
				LastUpdated: formatNow(),
			}

			tmpResult = append(tmpResult, item)
		}

		result = tmpResult
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("获取 Topic 列表失败: %w", err)
	}

	return result, nil
}

// GetTopicTotal 获取 Topic 总数（排除系统 Topic）
func (s *TopicService) GetTopicTotal() (int, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		// 无连接时返回 0
		return 0, nil
	}

	total := 0
	err = executeWithClientRetry(client, func(retryClient *admin.Client) error {
		ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
		defer cancel()

		topicList, callErr := retryClient.FetchAllTopicList(ctx)
		if callErr != nil {
			return callErr
		}

		tmpTotal := 0
		for _, topic := range topicList.TopicList {
			if isSystemTopic(topic) {
				continue
			}
			tmpTotal++
		}

		total = tmpTotal
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("获取 Topic 总数失败: %w", err)
	}

	return total, nil
}

// GetTopicsByCluster 按集群获取 Topic 列表
func (s *TopicService) GetTopicsByCluster(clusterName string) ([]*model.TopicItem, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return nil, fmt.Errorf("获取客户端失败: %w", err)
	}

	result := make([]*model.TopicItem, 0)
	err = executeWithClientRetry(client, func(retryClient *admin.Client) error {
		ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
		defer cancel()

		topicList, callErr := retryClient.FetchTopicsByCluster(ctx, clusterName)
		if callErr != nil {
			return callErr
		}

		tmpResult := make([]*model.TopicItem, 0, len(topicList.TopicList))
		for _, topic := range topicList.TopicList {
			if isSystemTopic(topic) {
				continue
			}

			item := &model.TopicItem{
				ID:          s.getNextID(),
				Topic:       topic,
				Cluster:     clusterName,
				ReadQueue:   -1,
				WriteQueue:  -1,
				LastUpdated: formatNow(),
			}

			tmpResult = append(tmpResult, item)
		}

		result = tmpResult
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("获取集群 Topic 列表失败: %w", err)
	}

	return result, nil
}

// GetTopicDetail 获取 Topic 详情
func (s *TopicService) GetTopicDetail(topicName string) (*model.TopicItem, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return nil, fmt.Errorf("获取客户端失败: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
	defer cancel()

	var item *model.TopicItem
	err = executeWithClientRetry(client, func(retryClient *admin.Client) error {
		routeInfo, callErr := retryClient.ExamineTopicRouteInfo(ctx, topicName)
		if callErr != nil {
			return callErr
		}

		tmpItem := &model.TopicItem{
			ID:          s.getNextID(),
			Topic:       topicName,
			Routes:      make([]model.TopicRouteItem, 0),
			LastUpdated: formatNow(),
		}

		totalReadQueue := 0
		totalWriteQueue := 0

		for _, queueData := range routeInfo.QueueDatas {
			route := model.TopicRouteItem{
				Broker:     queueData.BrokerName,
				ReadQueue:  queueData.ReadQueueNums,
				WriteQueue: queueData.WriteQueueNums,
				Perm:       model.IntToPerm(queueData.Perm),
			}

			// BrokerAddrs 是 map[string]string，key 是 "0" 表示 master
			for _, brokerData := range routeInfo.BrokerDatas {
				if brokerData.BrokerName == queueData.BrokerName {
					if addr, ok := brokerData.BrokerAddrs["0"]; ok {
						route.BrokerAddr = addr
					}
					if tmpItem.Cluster == "" {
						tmpItem.Cluster = brokerData.Cluster
					}
					break
				}
			}

			tmpItem.Routes = append(tmpItem.Routes, route)
			totalReadQueue += queueData.ReadQueueNums
			totalWriteQueue += queueData.WriteQueueNums
		}

		tmpItem.ReadQueue = totalReadQueue
		tmpItem.WriteQueue = totalWriteQueue
		if len(tmpItem.Routes) > 0 {
			tmpItem.Perm = tmpItem.Routes[0].Perm
		}

		item = tmpItem
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("获取 Topic 路由信息失败: %w", err)
	}

	return item, nil
}

// GetTopicRoute 获取 Topic 路由信息
func (s *TopicService) GetTopicRoute(topicName string) ([]model.TopicRouteItem, error) {
	detail, err := s.GetTopicDetail(topicName)
	if err != nil {
		return nil, err
	}
	return detail.Routes, nil
}

// CreateTopic 创建 Topic
func (s *TopicService) CreateTopic(topic string, brokerAddr string, readQueue int, writeQueue int, perm string) error {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return fmt.Errorf("获取客户端失败: %w", err)
	}

	topic = strings.TrimSpace(topic)
	brokerAddr = strings.TrimSpace(brokerAddr)
	if topic == "" {
		return fmt.Errorf("创建 Topic 失败: Topic 名称不能为空")
	}
	if brokerAddr == "" {
		return fmt.Errorf("创建 Topic 失败: Broker 地址不能为空，请先连接集群并选择可用 Broker")
	}
	if readQueue <= 0 {
		readQueue = 4
	}
	if writeQueue <= 0 {
		writeQueue = 4
	}

	ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
	defer cancel()

	// 使用 CreateTopic 方法
	config := admin.TopicConfig{
		TopicName:       topic,
		ReadQueueNums:   readQueue,
		WriteQueueNums:  writeQueue,
		Perm:            model.PermToInt(model.TopicPerm(perm)),
		TopicFilterType: "SINGLE_TAG",
	}

	err = executeWithClientRetry(client, func(retryClient *admin.Client) error {
		return retryClient.CreateTopic(ctx, brokerAddr, config)
	})
	if err != nil {
		return fmt.Errorf("创建 Topic 失败: %w", err)
	}

	return nil
}

// UpdateTopic 更新 Topic 配置
func (s *TopicService) UpdateTopic(topic string, brokerAddr string, readQueue int, writeQueue int, perm string) error {
	return s.CreateTopic(topic, brokerAddr, readQueue, writeQueue, perm)
}

// DeleteTopic 删除 Topic
func (s *TopicService) DeleteTopic(topic string, clusterName string) error {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return fmt.Errorf("获取客户端失败: %w", err)
	}

	topic = strings.TrimSpace(topic)
	clusterName = strings.TrimSpace(clusterName)
	if topic == "" {
		return fmt.Errorf("删除 Topic 失败: Topic 名称不能为空")
	}

	clusterCandidates := make([]string, 0, 4)
	seenClusters := make(map[string]struct{})
	appendCluster := func(name string) {
		name = strings.TrimSpace(name)
		if name == "" {
			return
		}
		if _, exists := seenClusters[name]; exists {
			return
		}
		seenClusters[name] = struct{}{}
		clusterCandidates = append(clusterCandidates, name)
	}

	if clusterName != "" && clusterName != "默认集群" {
		appendCluster(clusterName)
	}

	_ = executeWithClientRetry(client, func(retryClient *admin.Client) error {
		ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
		defer cancel()

		routeInfo, routeErr := retryClient.ExamineTopicRouteInfo(ctx, topic)
		if routeErr != nil || routeInfo == nil {
			return routeErr
		}

		for _, brokerData := range routeInfo.BrokerDatas {
			if brokerData == nil {
				continue
			}
			appendCluster(brokerData.Cluster)
		}

		return nil
	})

	if len(clusterCandidates) == 0 {
		_ = executeWithClientRetry(client, func(retryClient *admin.Client) error {
			ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
			defer cancel()

			clusterInfo, clusterErr := retryClient.ExamineBrokerClusterInfo(ctx)
			if clusterErr != nil || clusterInfo == nil {
				return clusterErr
			}

			for name := range clusterInfo.ClusterAddrTable {
				appendCluster(name)
			}

			return nil
		})
	}

	if len(clusterCandidates) == 0 {
		return fmt.Errorf("删除 Topic 失败: 未找到可用集群，请先检查连接状态")
	}

	var lastErr error
	for _, candidate := range clusterCandidates {
		callErr := executeWithClientRetry(client, func(retryClient *admin.Client) error {
			ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
			defer cancel()
			return retryClient.DeleteTopic(ctx, topic, candidate)
		})
		if callErr == nil {
			return nil
		}

		lastErr = callErr
		if strings.Contains(callErr.Error(), "不存在") {
			continue
		}
	}

	if lastErr != nil {
		return fmt.Errorf("删除 Topic 失败: 已尝试集群 %s，最后错误: %w", strings.Join(clusterCandidates, ", "), lastErr)
	}

	return fmt.Errorf("删除 Topic 失败: 未能在集群 %s 中删除", strings.Join(clusterCandidates, ", "))
}

// GetTopicStats 获取 Topic 统计信息
func (s *TopicService) GetTopicStats(topic string) (map[string]interface{}, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return nil, fmt.Errorf("获取客户端失败: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
	defer cancel()

	stats, err := client.ExamineTopicStats(ctx, topic)
	if err != nil {
		return nil, fmt.Errorf("获取 Topic 统计失败: %w", err)
	}

	result := map[string]interface{}{
		"topic": topic,
		"stats": stats,
	}

	return result, nil
}

// 判断是否为系统 Topic
func isSystemTopic(topic string) bool {
	systemTopics := []string{
		"SCHEDULE_TOPIC_XXXX",
		"RMQ_SYS_TRANS_HALF_TOPIC",
		"RMQ_SYS_TRACE_TOPIC",
		"RMQ_SYS_TRANS_OP_HALF_TOPIC",
		"TRANS_CHECK_MAX_TIME_TOPIC",
		"SELF_TEST_TOPIC",
		"TBW102",
		"BenchmarkTest",
		"DefaultCluster",
		"OFFSET_MOVED_EVENT",
	}

	for _, st := range systemTopics {
		if topic == st {
			return true
		}
	}

	if len(topic) > 0 && topic[0] == '%' {
		return true
	}

	return false
}
