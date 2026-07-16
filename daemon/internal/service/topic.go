package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
	"github.com/amigoer/rocket-leaf/daemon/internal/rocketmq"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// TopicService manages topics.
type TopicService struct {
	nextID          int64
	settingsService *SettingsService
}

// NewTopicService creates a topic management service.
func NewTopicService(settingsService *SettingsService) *TopicService {
	return &TopicService{
		nextID:          1,
		settingsService: settingsService,
	}
}

func (s *TopicService) getNextID() int {
	return int(atomic.AddInt64(&s.nextID, 1))
}

// GetTopics returns all non-system topics.
func (s *TopicService) GetTopics() ([]*model.TopicItem, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		// Return an empty list when no connection is available.
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
				MessageType: model.MessageTypeNormal,
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

// GetAllTopics returns all topics, including system topics.
func (s *TopicService) GetAllTopics() ([]*model.TopicItem, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
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
			item := &model.TopicItem{
				ID:          s.getNextID(),
				Topic:       topic,
				ReadQueue:   -1,
				WriteQueue:  -1,
				MessageType: model.MessageTypeNormal,
				LastUpdated: formatNow(),
			}
			if isSystemTopic(topic) {
				item.Description = "系统"
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

// GetTopicTotal returns the number of non-system topics.
func (s *TopicService) GetTopicTotal() (int, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		// Return zero when no connection is available.
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

// GetTopicsByCluster returns topics for a cluster.
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
				MessageType: model.MessageTypeNormal,
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

// GetTopicDetail returns details for a topic.
func (s *TopicService) GetTopicDetail(topicName string) (*model.TopicItem, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return nil, fmt.Errorf("获取客户端失败: %w", err)
	}

	var item *model.TopicItem
	err = executeWithClientRetryTimeout(client, s.settingsService.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
		routeInfo, callErr := retryClient.ExamineTopicRouteInfo(ctx, topicName)
		if callErr != nil {
			return callErr
		}

		tmpItem := &model.TopicItem{
			ID:          s.getNextID(),
			Topic:       topicName,
			MessageType: model.MessageTypeNormal,
			Routes:      make([]model.TopicRouteItem, 0),
			LastUpdated: formatNow(),
		}
		if strings.TrimSpace(routeInfo.OrderTopicConf) != "" {
			tmpItem.MessageType = model.MessageTypeFIFO
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

			// BrokerAddrs is a map[string]string whose "0" key identifies the master.
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

// GetTopicRoute returns routing information for a topic.
func (s *TopicService) GetTopicRoute(topicName string) ([]model.TopicRouteItem, error) {
	detail, err := s.GetTopicDetail(topicName)
	if err != nil {
		return nil, err
	}
	return detail.Routes, nil
}

// CreateTopic creates a topic.
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
	if readQueue > 1024 || writeQueue > 1024 {
		return fmt.Errorf("创建 Topic 失败: 队列数不能超过 1024")
	}
	if perm != string(model.PermRW) && perm != string(model.PermR) &&
		perm != string(model.PermW) && perm != string(model.PermDeny) {
		return fmt.Errorf("创建 Topic 失败: 不支持的权限 %q", perm)
	}

	// Create the topic through the admin client's CreateTopic method.
	config := admin.TopicConfig{
		TopicName:       topic,
		ReadQueueNums:   readQueue,
		WriteQueueNums:  writeQueue,
		Perm:            model.PermToInt(model.TopicPerm(perm)),
		TopicFilterType: "SINGLE_TAG",
	}

	err = executeWithClientRetryTimeout(client, s.settingsService.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
		return retryClient.CreateTopic(ctx, brokerAddr, config)
	})
	if err != nil {
		return fmt.Errorf("创建 Topic 失败: %w", err)
	}

	return nil
}

// UpdateTopic updates a topic configuration.
func (s *TopicService) UpdateTopic(topic string, brokerAddr string, readQueue int, writeQueue int, perm string) error {
	return s.CreateTopic(topic, brokerAddr, readQueue, writeQueue, perm)
}

// DeleteTopic deletes a topic.
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

// GetTopicStats returns statistics for a topic.
func (s *TopicService) GetTopicStats(topic string) (map[string]interface{}, error) {
	topic = strings.TrimSpace(topic)
	if topic == "" {
		return nil, fmt.Errorf("获取 Topic 统计失败: Topic 名称不能为空")
	}
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return nil, fmt.Errorf("获取客户端失败: %w", err)
	}

	var result map[string]interface{}
	err = executeWithClientRetryTimeout(client, s.settingsService.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
		offsets, callErr := collectTopicQueueOffsets(ctx, retryClient, topic)
		if callErr != nil {
			return callErr
		}
		var totalMinOffset, totalMaxOffset int64
		queues := make([]map[string]interface{}, 0, len(offsets))
		for _, offset := range offsets {
			totalMinOffset += offset.MinOffset
			totalMaxOffset += offset.MaxOffset

			queues = append(queues, map[string]interface{}{
				"brokerName": offset.BrokerName,
				"queueId":    offset.QueueID,
				"minOffset":  offset.MinOffset,
				"maxOffset":  offset.MaxOffset,
				"messages":   offset.MaxOffset - offset.MinOffset,
				"lastUpdate": int64(0),
			})
		}

		sort.Slice(queues, func(i, j int) bool {
			bi := queues[i]["brokerName"].(string)
			bj := queues[j]["brokerName"].(string)
			if bi != bj {
				return bi < bj
			}
			return queues[i]["queueId"].(int) < queues[j]["queueId"].(int)
		})

		result = map[string]interface{}{
			"topic":          topic,
			"queueCount":     len(queues),
			"totalMinOffset": totalMinOffset,
			"totalMaxOffset": totalMaxOffset,
			"totalMessages":  totalMaxOffset - totalMinOffset,
			"queues":         queues,
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("获取 Topic 统计失败: %w", err)
	}

	return result, nil
}

type topicQueueOffset struct {
	BrokerName string
	QueueID    int
	MinOffset  int64
	MaxOffset  int64
}

// collectTopicQueueOffsets queries every readable queue in the topic route
// instead of relying on ExamineTopicStats for only the first broker. It returns
// an error if any queue fails so partial data is never presented as complete.
func collectTopicQueueOffsets(ctx context.Context, client *admin.Client, topic string) ([]topicQueueOffset, error) {
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
		return []topicQueueOffset{}, nil
	}

	type queueResult struct {
		offset topicQueueOffset
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
			results[i].offset = topicQueueOffset{
				BrokerName: current.brokerName,
				QueueID:    current.queueID,
				MinOffset:  minOffset,
				MaxOffset:  maxOffset,
			}
		}(index, target)
	}
	wg.Wait()

	offsets := make([]topicQueueOffset, 0, len(results))
	for _, result := range results {
		if result.err != nil {
			return nil, result.err
		}
		offsets = append(offsets, result.offset)
	}
	return offsets, nil
}

// isSystemTopic reports whether a topic is internal and hidden from the default
// list. Retry and dead-letter topics remain visible for operational use.
func isSystemTopic(topic string) bool {
	topic = strings.TrimSpace(topic)
	if topic == "" {
		return true
	}

	// Retry and dead-letter queues are business-related and remain visible.
	if strings.HasPrefix(topic, "%RETRY%") ||
		strings.HasPrefix(topic, "%DLQ%") ||
		strings.HasPrefix(topic, "RETRY%") ||
		strings.HasPrefix(topic, "DLQ%") {
		return false
	}

	// Other names with a percent prefix are internal.
	if topic[0] == '%' {
		return true
	}

	lower := strings.ToLower(topic)
	upper := strings.ToUpper(topic)

	switch {
	case strings.HasPrefix(upper, "RMQ_SYS_"),
		strings.HasPrefix(lower, "rmq_sys_"),
		strings.HasPrefix(upper, "SCHEDULE_TOPIC"),
		strings.HasPrefix(topic, "DefaultHeartBeat"),
		strings.Contains(upper, "_REPLY_TOPIC"),
		strings.HasSuffix(upper, "REPLY_TOPIC"),
		strings.Contains(upper, "WHEEL_TIMER"),
		strings.Contains(upper, "REVIVE_LOG"),
		strings.Contains(upper, "SYNC_BROKER_MEMBER"),
		strings.Contains(upper, "ROCKSDB"),
		strings.Contains(upper, "TRANS_HALF"),
		strings.Contains(upper, "TRANS_OP_HALF"):
		return true
	}

	exact := map[string]struct{}{
		"SCHEDULE_TOPIC_XXXX":         {},
		"RMQ_SYS_TRANS_HALF_TOPIC":    {},
		"RMQ_SYS_TRACE_TOPIC":         {},
		"RMQ_SYS_TRANS_OP_HALF_TOPIC": {},
		"TRANS_CHECK_MAX_TIME_TOPIC":  {},
		"SELF_TEST_TOPIC":             {},
		"TBW102":                      {},
		"BenchmarkTest":               {},
		"DefaultCluster":              {},
		"OFFSET_MOVED_EVENT":          {},
		"DefaultHeartBeatSyncerTopic": {},
	}
	if _, ok := exact[topic]; ok {
		return true
	}

	return false
}

// parseMQKey extracts brokerName and queueId from a serialized MessageQueue.
// Format: "MessageQueue [topic=xxx, brokerName=broker-a, queueId=0]".
func parseMQKey(key string) (string, int) {
	var parsed struct {
		BrokerName string `json:"brokerName"`
		QueueID    int    `json:"queueId"`
	}
	if json.Unmarshal([]byte(key), &parsed) == nil && parsed.BrokerName != "" {
		return parsed.BrokerName, parsed.QueueID
	}
	brokerName := ""
	queueId := 0
	if idx := strings.Index(key, "brokerName="); idx >= 0 {
		s := key[idx+len("brokerName="):]
		if end := strings.IndexAny(s, ",]"); end >= 0 {
			brokerName = strings.TrimSpace(s[:end])
		}
	}
	if idx := strings.Index(key, "queueId="); idx >= 0 {
		s := key[idx+len("queueId="):]
		if end := strings.IndexAny(s, ",]"); end >= 0 {
			fmt.Sscanf(strings.TrimSpace(s[:end]), "%d", &queueId)
		}
	}
	if brokerName == "" {
		parts := strings.Split(key, "-")
		if len(parts) >= 2 {
			if _, err := fmt.Sscanf(parts[len(parts)-1], "%d", &queueId); err == nil {
				brokerName = strings.Join(parts[:len(parts)-1], "-")
			}
		}
	}
	return brokerName, queueId
}
