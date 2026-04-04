package service

import (
	"context"
	"fmt"
	"strconv"

	"rocket-leaf/internal/model"
	"rocket-leaf/internal/rocketmq"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// ClusterService 集群状态服务
type ClusterService struct {
	connectionService *ConnectionService
	settingsService   *SettingsService
}

// NewClusterService 创建集群状态服务
func NewClusterService(connService *ConnectionService, settingsService *SettingsService) *ClusterService {
	return &ClusterService{
		connectionService: connService,
		settingsService:   settingsService,
	}
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
					Status:     model.NodeOnline,
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
		tmpResult.OnlineBrokers = len(tmpResult.Brokers)
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
		Status:     model.NodeOnline,
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

	ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
	defer cancel()

	err = executeWithClientRetry(client, func(retryClient *admin.Client) error {
		stats, callErr := retryClient.FetchBrokerRuntimeStats(ctx, brokerAddr)
		if callErr != nil {
			return callErr
		}

		if stats != nil && stats.Table != nil {
			if version, ok := stats.Table["brokerVersionDesc"]; ok {
				broker.Version = version
			}
			if tpsIn, ok := stats.Table["putTps"]; ok {
				broker.TpsIn = parseIntSafe(extractFirstValue(tpsIn))
			}
			if tpsOut, ok := stats.Table["getTransferredTps"]; ok {
				broker.TpsOut = parseIntSafe(extractFirstValue(tpsOut))
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
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("获取 Broker 统计信息失败: %w", err)
	}

	return broker, nil
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
		TotalClusters:  1,
		TotalBrokers:   clusterInfo.TotalBrokers,
		OnlineBrokers:  clusterInfo.OnlineBrokers,
		WarningBrokers: 0,
		OfflineBrokers: 0,
		AvgDiskUsage:   clusterInfo.AvgDiskUsage,
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
