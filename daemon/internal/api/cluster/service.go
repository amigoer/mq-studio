package cluster

import "github.com/amigoer/rocket-leaf/daemon/internal/model"

// Service defines the cluster operations required by the HTTP transport.
type Service interface {
	GetClusterInfo() (*model.ClusterInfo, error)
	GetClusterSummary() (*model.ClusterSummary, error)
	GetBrokers() ([]*model.BrokerNode, error)
	GetBrokerDetail(string) (*model.BrokerNode, error)
}
