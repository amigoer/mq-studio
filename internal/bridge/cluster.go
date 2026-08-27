package bridge

import (
	"context"

	"github.com/amigoer/mq-studio/internal/driver/rocketmq"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/cluster"
)

// ClusterService exposes cluster topology and health to the frontend.
//
// The service returns canonical nodes; assembling the RocketMQ-shaped
// ClusterInfo the renderer still expects happens here, alongside the other
// conversions that disappear when the frontend moves onto the canonical model.
type ClusterService struct {
	service *cluster.Service
}

func brokersFrom(nodes []*model.Node) []*model.BrokerNode {
	brokers := make([]*model.BrokerNode, 0, len(nodes))
	for _, node := range nodes {
		brokers = append(brokers, rocketmq.BrokerFromNode(node))
	}
	return brokers
}

// Info returns the full cluster overview.
func (s *ClusterService) Info(connID int) (*model.ClusterInfo, error) {
	overview, nodes, err := s.service.Overview(context.Background(), connID)
	if err != nil {
		return nil, err
	}
	return &model.ClusterInfo{
		ClusterName:   overview.Name,
		TotalBrokers:  overview.TotalNodes,
		OnlineBrokers: overview.OnlineNodes,
		TotalTopics:   overview.Destinations,
		TotalGroups:   overview.Subscriptions,
		AvgDiskUsage:  overview.AvgDiskUsage,
		NameServers:   make([]string, 0),
		Brokers:       brokersFrom(nodes),
	}, nil
}

// Summary returns the aggregated cluster counters.
func (s *ClusterService) Summary(connID int) (*model.ClusterSummary, error) {
	return s.service.GetClusterSummary(context.Background(), connID)
}

// Brokers returns every known broker node.
func (s *ClusterService) Brokers(connID int) ([]*model.BrokerNode, error) {
	nodes, err := s.service.GetBrokers(context.Background(), connID)
	if err != nil {
		return nil, err
	}
	return brokersFrom(nodes), nil
}

// BrokerDetail returns runtime statistics for a single broker.
func (s *ClusterService) BrokerDetail(connID int, brokerAddr string) (*model.BrokerNode, error) {
	node, err := s.service.GetBrokerDetail(context.Background(), connID, brokerAddr)
	if err != nil {
		return nil, err
	}
	return rocketmq.BrokerFromNode(node), nil
}
