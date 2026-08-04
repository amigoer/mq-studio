package bridge

import (
	"github.com/amigoer/rocket-leaf/internal/model"
	"github.com/amigoer/rocket-leaf/internal/service/cluster"
)

// ClusterService exposes cluster topology and health to the frontend.
type ClusterService struct {
	service *cluster.Service
}

// Info returns the full cluster overview.
func (s *ClusterService) Info() (*model.ClusterInfo, error) {
	return s.service.GetClusterInfo()
}

// Summary returns the aggregated cluster counters.
func (s *ClusterService) Summary() (*model.ClusterSummary, error) {
	return s.service.GetClusterSummary()
}

// Brokers returns every known broker node.
func (s *ClusterService) Brokers() ([]*model.BrokerNode, error) {
	return s.service.GetBrokers()
}

// BrokerDetail returns runtime statistics for a single broker.
func (s *ClusterService) BrokerDetail(brokerAddr string) (*model.BrokerNode, error) {
	return s.service.GetBrokerDetail(brokerAddr)
}
