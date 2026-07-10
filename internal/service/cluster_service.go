package service

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strconv"
	"sync"

	"rocket-leaf/internal/model"
	"rocket-leaf/internal/rocketmq"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// brokerTPSHistory 单 broker 的滚动 TPS 历史，最大 tpsHistoryLen 个采样。
type brokerTPSHistory struct {
	tpsIn  []int
	tpsOut []int
}

// tpsHistoryLen 决定吞吐趋势图能回放的采样深度；前端按 30s 拉一次时
// 60 个采样约等于 30 分钟。
const tpsHistoryLen = 60

// ClusterService 集群状态服务
type ClusterService struct {
	connectionService *ConnectionService
	settingsService   *SettingsService

	historyMu sync.Mutex
	history   map[string]*brokerTPSHistory // key: broker address
}

// NewClusterService 创建集群状态服务
func NewClusterService(connService *ConnectionService, settingsService *SettingsService) *ClusterService {
	return &ClusterService{
		connectionService: connService,
		settingsService:   settingsService,
		history:           make(map[string]*brokerTPSHistory),
	}
}

// recordBrokerTPS 把当前 TPS 追加到该 broker 的滚动历史并把历史回写到 broker
// 对象，方便前端在没有专门的历史接口时也能直接画图。
func (s *ClusterService) recordBrokerTPS(broker *model.BrokerNode) {
	if broker == nil || broker.Address == "" || broker.Status != model.NodeOnline || broker.TpsIn < 0 || broker.TpsOut < 0 {
		return
	}
	s.historyMu.Lock()
	defer s.historyMu.Unlock()
	h, ok := s.history[broker.Address]
	if !ok {
		h = &brokerTPSHistory{}
		s.history[broker.Address] = h
	}
	h.tpsIn = appendCapped(h.tpsIn, broker.TpsIn, tpsHistoryLen)
	h.tpsOut = appendCapped(h.tpsOut, broker.TpsOut, tpsHistoryLen)
	// 拷贝出去防止后续追加污染前端拿到的切片。
	broker.TpsInHistory = append([]int(nil), h.tpsIn...)
	broker.TpsOutHistory = append([]int(nil), h.tpsOut...)
}

// appendCapped 追加并裁剪保持 cap 上限的切片。
func appendCapped(arr []int, v int, cap int) []int {
	arr = append(arr, v)
	if len(arr) > cap {
		arr = arr[len(arr)-cap:]
	}
	return arr
}

// GetClusterInfo 获取集群信息
func (s *ClusterService) GetClusterInfo() (*model.ClusterInfo, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		// 无连接时返回空数据
		return &model.ClusterInfo{
			Brokers:     make([]*model.BrokerNode, 0),
			NameServers: make([]string, 0),
		}, nil
	}

	var result *model.ClusterInfo
	err = executeWithClientRetry(client, func(retryClient *admin.Client) error {
		ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
		defer cancel()

		clusterInfo, callErr := retryClient.ExamineBrokerClusterInfo(ctx)
		if callErr != nil {
			return callErr
		}

		tmpResult := &model.ClusterInfo{
			NameServers: retryClient.GetNameServerAddressList(),
			Brokers:     make([]*model.BrokerNode, 0),
		}

		brokerClusterMap := make(map[string]string)
		for clusterName, brokerNames := range clusterInfo.ClusterAddrTable {
			if tmpResult.ClusterName == "" {
				tmpResult.ClusterName = clusterName
			}

			for _, brokerName := range brokerNames {
				if brokerName == "" {
					continue
				}
				if _, exists := brokerClusterMap[brokerName]; !exists {
					brokerClusterMap[brokerName] = clusterName
				}
			}
		}

		brokerID := 1
		for brokerName, brokerData := range clusterInfo.BrokerAddrTable {
			if brokerData == nil {
				continue
			}

			clusterName := brokerData.Cluster
			if clusterName == "" {
				clusterName = brokerClusterMap[brokerName]
			}
			if clusterName == "" {
				clusterName = "默认集群"
			}
			if tmpResult.ClusterName == "" {
				tmpResult.ClusterName = clusterName
			}

			for brokerIDStr, addr := range brokerData.BrokerAddrs {
				if addr == "" {
					continue
				}

				role := model.RoleSlave
				if brokerIDStr == "0" {
					role = model.RoleMaster
				}

				brokerIDInt, _ := strconv.Atoi(brokerIDStr)
				broker := &model.BrokerNode{
					ID:         brokerID,
					Cluster:    clusterName,
					BrokerName: brokerName,
					BrokerID:   brokerIDInt,
					Role:       role,
					Address:    addr,
					Status:     model.NodeWarning,
					Topics:     -1,
					Groups:     -1,
					TpsIn:      -1,
					TpsOut:     -1,
					LastUpdate: formatNow(),
				}

				tmpResult.Brokers = append(tmpResult.Brokers, broker)
				brokerID++
			}
		}

		tmpResult.TotalBrokers = len(tmpResult.Brokers)

		// 最佳努力：为每个 broker 补齐 runtime 字段（版本号、TPS、磁盘等），
		// 让 Cluster 屏幕的 KPI 卡片和 broker 列表能显示真实数据。
		// 每个 broker 用独立的 ctx，避免共享 ctx 的剩余预算被前面的调用耗尽；
		// 失败的单个 broker 仅丢失 runtime 字段，不影响整体返回。
		diskSum := 0
		diskCount := 0
		onlineCount := 0
		semaphore := make(chan struct{}, 6)
		var runtimeWG sync.WaitGroup
		for _, broker := range tmpResult.Brokers {
			if broker == nil {
				continue
			}
			runtimeWG.Add(1)
			go func(node *model.BrokerNode) {
				defer runtimeWG.Done()
				semaphore <- struct{}{}
				defer func() { <-semaphore }()
				brokerCtx, brokerCancel := context.WithTimeout(
					context.Background(),
					s.settingsService.GetRequestTimeout(),
				)
				defer brokerCancel()
				s.enrichBrokerRuntimeStats(brokerCtx, retryClient, node)
			}(broker)
		}
		runtimeWG.Wait()
		for _, broker := range tmpResult.Brokers {
			s.recordBrokerTPS(broker)
			if broker.Status == model.NodeOnline {
				onlineCount++
			}
			if broker.CommitLogDiskUsage > 0 {
				diskSum += broker.CommitLogDiskUsage
				diskCount++
			}
		}
		tmpResult.OnlineBrokers = onlineCount
		if diskCount > 0 {
			tmpResult.AvgDiskUsage = diskSum / diskCount
		}

		// 最佳努力：补齐 Topic 与 ConsumerGroup 总数，使 Overview / Cluster
		// 屏幕的 KPI 卡片即便在不单独拉列表的页面也能显示真实数字。
		// 这两个调用失败不影响 broker 信息返回。
		topicCtx, topicCancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
		if topicList, topicErr := retryClient.FetchAllTopicList(topicCtx); topicErr == nil && topicList != nil {
			count := 0
			for _, topic := range topicList.TopicList {
				if !isSystemTopic(topic) {
					count++
				}
			}
			tmpResult.TotalTopics = count
		}
		topicCancel()

		groupSet := make(map[string]struct{})
		for _, brokerData := range clusterInfo.BrokerAddrTable {
			if brokerData == nil {
				continue
			}
			masterAddr, ok := brokerData.BrokerAddrs["0"]
			if !ok {
				continue
			}
			groupCtx, groupCancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
			subGroups, groupErr := retryClient.GetAllSubscriptionGroup(groupCtx, masterAddr)
			groupCancel()
			if groupErr != nil || subGroups == nil {
				continue
			}
			for groupName := range subGroups {
				if isSystemGroup(groupName) {
					continue
				}
				groupSet[groupName] = struct{}{}
			}
		}
		tmpResult.TotalGroups = len(groupSet)

		result = tmpResult

		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("获取集群信息失败: %w", err)
	}

	return result, nil
}

// GetBrokers 获取 Broker 列表
func (s *ClusterService) GetBrokers() ([]*model.BrokerNode, error) {
	clusterInfo, err := s.GetClusterInfo()
	if err != nil {
		return nil, err
	}
	return clusterInfo.Brokers, nil
}

// GetBrokerDetail 获取 Broker 详情
func (s *ClusterService) GetBrokerDetail(brokerAddr string) (*model.BrokerNode, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return nil, fmt.Errorf("获取客户端失败: %w", err)
	}

	broker := &model.BrokerNode{
		Address:    brokerAddr,
		Status:     model.NodeWarning,
		Topics:     -1,
		Groups:     -1,
		TpsIn:      -1,
		TpsOut:     -1,
		LastUpdate: formatNow(),
	}
	if clusterInfo, clusterErr := s.GetClusterInfo(); clusterErr == nil && clusterInfo != nil {
		for _, node := range clusterInfo.Brokers {
			if node == nil || node.Address != brokerAddr {
				continue
			}

			broker.ID = node.ID
			broker.Cluster = node.Cluster
			broker.BrokerName = node.BrokerName
			broker.BrokerID = node.BrokerID
			broker.Role = node.Role
			broker.HAAddress = node.HAAddress
			broker.Topics = node.Topics
			broker.Groups = node.Groups
			broker.Remark = node.Remark
			break
		}
	}

	err = executeWithClientRetryTimeout(client, s.settingsService.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
		if statsErr := s.applyBrokerRuntimeStats(ctx, retryClient, broker); statsErr != nil {
			return statsErr
		}
		broker.Status = model.NodeOnline
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("获取 Broker 统计信息失败: %w", err)
	}

	return broker, nil
}

// enrichBrokerRuntimeStats 静默地补齐 broker 的 runtime 字段。
// 区别于 applyBrokerRuntimeStats: 失败时不返回错误，让 GetClusterInfo
// 在批量补齐时跳过单个失败的 broker 而不影响整体。失败原因记录到日志。
func (s *ClusterService) enrichBrokerRuntimeStats(ctx context.Context, client *admin.Client, broker *model.BrokerNode) {
	if broker == nil || broker.Address == "" {
		return
	}
	if err := s.applyBrokerRuntimeStats(ctx, client, broker); err != nil {
		log.Printf("enrichBrokerRuntimeStats(%s): %v", broker.Address, err)
		if isRetryableNetworkError(err) {
			broker.Status = model.NodeOffline
		} else {
			broker.Status = model.NodeWarning
		}
		return
	}
	broker.Status = model.NodeOnline
}

// applyBrokerRuntimeStats 拉取 broker runtime 统计并写入字段。
// 网络错误等会返回 error，由调用方决定是否传播。
func (s *ClusterService) applyBrokerRuntimeStats(ctx context.Context, client *admin.Client, broker *model.BrokerNode) error {
	stats, err := client.FetchBrokerRuntimeStats(ctx, broker.Address)
	if err != nil {
		return err
	}
	if stats == nil || stats.Table == nil {
		return errors.New("Broker 返回空运行时统计")
	}
	if version, ok := stats.Table["brokerVersionDesc"]; ok {
		broker.Version = version
	}
	// putTps / getTransferredTps 形如 "0.0 0.0 0.0"（当前/5分钟均/15分钟均），
	// 取第一个数值并按 float 解析（之前用 parseIntSafe 会把 "0.5" 截成 0）。
	if tpsIn, ok := stats.Table["putTps"]; ok {
		broker.TpsIn = int(parseFloatSafe(extractFirstValue(tpsIn)))
	}
	if tpsOut, ok := stats.Table["getTransferredTps"]; ok {
		broker.TpsOut = int(parseFloatSafe(extractFirstValue(tpsOut)))
	}
	if msgInToday, ok := stats.Table["msgPutTotalTodayNow"]; ok {
		broker.MsgInToday = parseInt64Safe(msgInToday)
	}
	if msgOutToday, ok := stats.Table["msgGetTotalTodayNow"]; ok {
		broker.MsgOutToday = parseInt64Safe(msgOutToday)
	}
	if diskRatio, ok := stats.Table["commitLogDiskRatio"]; ok {
		broker.CommitLogDiskUsage = int(parseFloatSafe(diskRatio) * 100)
	}
	if diskRatio, ok := stats.Table["consumeQueueDiskRatio"]; ok {
		broker.ConsumeQueueDiskUsage = int(parseFloatSafe(diskRatio) * 100)
	}
	return nil
}

// GetNameServers 获取 NameServer 列表
func (s *ClusterService) GetNameServers() ([]*model.NameServerNode, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		// 无连接时返回空数据
		return []*model.NameServerNode{}, nil
	}

	addrs := client.GetNameServerAddressList()

	result := make([]*model.NameServerNode, 0, len(addrs))
	for i, addr := range addrs {
		node := &model.NameServerNode{
			ID:       i + 1,
			Address:  addr,
			Status:   model.NodeOnline,
			LastSeen: formatNow(),
		}
		result = append(result, node)
	}

	return result, nil
}

// GetClusterSummary 获取集群概览统计
func (s *ClusterService) GetClusterSummary() (*model.ClusterSummary, error) {
	clusterInfo, err := s.GetClusterInfo()
	if err != nil {
		return &model.ClusterSummary{}, nil
	}

	summary := &model.ClusterSummary{
		TotalClusters: 1,
		TotalBrokers:  clusterInfo.TotalBrokers,
		AvgDiskUsage:  clusterInfo.AvgDiskUsage,
	}
	for _, broker := range clusterInfo.Brokers {
		if broker == nil {
			continue
		}
		switch broker.Status {
		case model.NodeOnline:
			summary.OnlineBrokers++
		case model.NodeWarning:
			summary.WarningBrokers++
		case model.NodeOffline:
			summary.OfflineBrokers++
		}
	}

	return summary, nil
}

// 辅助函数
func parseIntSafe(s string) int {
	var result int
	fmt.Sscanf(s, "%d", &result)
	return result
}

func parseInt64Safe(s string) int64 {
	var result int64
	fmt.Sscanf(s, "%d", &result)
	return result
}

func parseFloatSafe(s string) float64 {
	var result float64
	fmt.Sscanf(s, "%f", &result)
	return result
}

func extractFirstValue(s string) string {
	for i, c := range s {
		if c == ' ' || c == '\t' {
			return s[:i]
		}
	}
	return s
}
