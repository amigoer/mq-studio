package service

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strconv"
	"sync"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
	"github.com/amigoer/rocket-leaf/daemon/internal/rocketmq"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// brokerTPSHistory stores a rolling TPS history for one broker, up to tpsHistoryLen samples.
type brokerTPSHistory struct {
	tpsIn  []int
	tpsOut []int
}

// tpsHistoryLen controls the sample depth available to the throughput trend chart.
// At a 30-second polling interval, 60 samples represent about 30 minutes.
const tpsHistoryLen = 60

// ClusterService provides cluster status operations.
type ClusterService struct {
	connectionService *ConnectionService
	settingsService   *SettingsService

	historyMu sync.Mutex
	history   map[string]*brokerTPSHistory // key: broker address
}

// NewClusterService creates a cluster status service.
func NewClusterService(connService *ConnectionService, settingsService *SettingsService) *ClusterService {
	return &ClusterService{
		connectionService: connService,
		settingsService:   settingsService,
		history:           make(map[string]*brokerTPSHistory),
	}
}

// recordBrokerTPS appends the current TPS values to the broker's rolling history
// and copies the history back to the broker so the UI can chart it without a dedicated history endpoint.
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
	// Copy the slices so later appends cannot mutate data already returned to the UI.
	broker.TpsInHistory = append([]int(nil), h.tpsIn...)
	broker.TpsOutHistory = append([]int(nil), h.tpsOut...)
}

// appendCapped appends a value and trims the slice to the given maximum length.
func appendCapped(arr []int, v int, cap int) []int {
	arr = append(arr, v)
	if len(arr) > cap {
		arr = arr[len(arr)-cap:]
	}
	return arr
}

// GetClusterInfo returns cluster information.
func (s *ClusterService) GetClusterInfo() (*model.ClusterInfo, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		// Return empty data when there is no active connection.
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

		// Best effort: populate each broker's runtime fields, such as version, TPS,
		// and disk usage, so the Cluster KPI cards and broker list show real data.
		// Give each broker its own context so earlier calls cannot consume a shared
		// timeout budget. A failed broker only loses its runtime fields and does not affect the overall response.
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

		// Best effort: populate the total Topic and ConsumerGroup counts so the Overview
		// and Cluster KPI cards show real values even on pages that do not fetch the lists separately.
		// Failures in these two calls do not prevent broker information from being returned.
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

// GetBrokers returns the broker list.
func (s *ClusterService) GetBrokers() ([]*model.BrokerNode, error) {
	clusterInfo, err := s.GetClusterInfo()
	if err != nil {
		return nil, err
	}
	return clusterInfo.Brokers, nil
}

// GetBrokerDetail returns details for a broker.
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

// enrichBrokerRuntimeStats silently populates a broker's runtime fields.
// Unlike applyBrokerRuntimeStats, it logs errors instead of returning them so
// GetClusterInfo can skip an individual failed broker during bulk enrichment.
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

// applyBrokerRuntimeStats fetches broker runtime statistics and populates the broker fields.
// It returns network and other errors so the caller can decide whether to propagate them.
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
	// putTps and getTransferredTps use the form "0.0 0.0 0.0"
	// (current/5-minute average/15-minute average). Parse the first value as a float;
	// parseIntSafe would truncate a value such as "0.5" to zero.
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

// GetNameServers returns the NameServer list.
func (s *ClusterService) GetNameServers() ([]*model.NameServerNode, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		// Return empty data when there is no active connection.
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

// GetClusterSummary returns aggregate cluster statistics.
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

// Parsing helpers.
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
