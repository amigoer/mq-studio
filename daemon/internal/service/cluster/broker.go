package cluster

import (
	"context"
	"errors"
	"fmt"
	"log"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
	"github.com/amigoer/rocket-leaf/daemon/internal/rocketmq"
	"github.com/amigoer/rocket-leaf/daemon/internal/service/internal/mqexec"
	"github.com/amigoer/rocket-leaf/daemon/internal/service/internal/timestamp"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// GetBrokers returns the broker list.
func (s *Service) GetBrokers() ([]*model.BrokerNode, error) {
	clusterInfo, err := s.GetClusterInfo()
	if err != nil {
		return nil, err
	}
	return clusterInfo.Brokers, nil
}

// GetBrokerDetail returns details for a broker.
func (s *Service) GetBrokerDetail(brokerAddress string) (*model.BrokerNode, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return nil, fmt.Errorf("获取客户端失败: %w", err)
	}

	broker := &model.BrokerNode{
		Address:    brokerAddress,
		Status:     model.NodeWarning,
		Topics:     -1,
		Groups:     -1,
		TpsIn:      -1,
		TpsOut:     -1,
		LastUpdate: timestamp.Now(),
	}
	if clusterInfo, clusterErr := s.GetClusterInfo(); clusterErr == nil && clusterInfo != nil {
		copyBrokerMetadata(clusterInfo.Brokers, broker)
	}

	err = mqexec.WithTimeout(client, s.settings.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
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

func copyBrokerMetadata(brokers []*model.BrokerNode, target *model.BrokerNode) {
	for _, broker := range brokers {
		if broker == nil || broker.Address != target.Address {
			continue
		}

		target.ID = broker.ID
		target.Cluster = broker.Cluster
		target.BrokerName = broker.BrokerName
		target.BrokerID = broker.BrokerID
		target.Role = broker.Role
		target.HAAddress = broker.HAAddress
		target.Topics = broker.Topics
		target.Groups = broker.Groups
		target.Remark = broker.Remark
		return
	}
}

// enrichBrokerRuntimeStats populates runtime fields without propagating an
// individual broker failure to a bulk overview request.
func (s *Service) enrichBrokerRuntimeStats(ctx context.Context, client *admin.Client, broker *model.BrokerNode) {
	if broker == nil || broker.Address == "" {
		return
	}
	if err := s.applyBrokerRuntimeStats(ctx, client, broker); err != nil {
		log.Printf("enrichBrokerRuntimeStats(%s): %v", broker.Address, err)
		if mqexec.IsRetryableNetworkError(err) {
			broker.Status = model.NodeOffline
		} else {
			broker.Status = model.NodeWarning
		}
		return
	}
	broker.Status = model.NodeOnline
}

// applyBrokerRuntimeStats fetches runtime statistics and populates a broker model.
func (s *Service) applyBrokerRuntimeStats(ctx context.Context, client *admin.Client, broker *model.BrokerNode) error {
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
	// TPS values contain current, five-minute, and fifteen-minute samples.
	if value, ok := stats.Table["putTps"]; ok {
		broker.TpsIn = int(parseFloatSafe(extractFirstValue(value)))
	}
	if value, ok := stats.Table["getTransferredTps"]; ok {
		broker.TpsOut = int(parseFloatSafe(extractFirstValue(value)))
	}
	if value, ok := stats.Table["msgPutTotalTodayNow"]; ok {
		broker.MsgInToday = parseInt64Safe(value)
	}
	if value, ok := stats.Table["msgGetTotalTodayNow"]; ok {
		broker.MsgOutToday = parseInt64Safe(value)
	}
	if value, ok := stats.Table["commitLogDiskRatio"]; ok {
		broker.CommitLogDiskUsage = int(parseFloatSafe(value) * 100)
	}
	if value, ok := stats.Table["consumeQueueDiskRatio"]; ok {
		broker.ConsumeQueueDiskUsage = int(parseFloatSafe(value) * 100)
	}
	return nil
}

// GetNameServers returns the NameServer list.
func (s *Service) GetNameServers() ([]*model.NameServerNode, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return []*model.NameServerNode{}, nil
	}

	addresses := client.GetNameServerAddressList()
	result := make([]*model.NameServerNode, 0, len(addresses))
	for index, address := range addresses {
		result = append(result, &model.NameServerNode{
			ID:       index + 1,
			Address:  address,
			Status:   model.NodeOnline,
			LastSeen: timestamp.Now(),
		})
	}
	return result, nil
}
