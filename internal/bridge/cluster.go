package bridge

import (
	"context"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/cluster"
)

// ClusterService exposes cluster topology and health to the frontend.
//
// The service returns canonical nodes and the bridge passes them through.
// Broker role, CommitLog usage and the rest of RocketMQ's runtime detail
// travel in each node's attribute map.
type ClusterService struct {
	service *cluster.Service
}

// ClusterView is the cluster page's snapshot: the header counters and the
// nodes behind them, in one round trip.
type ClusterView struct {
	Overview model.ClusterOverview `json:"overview"`
	Nodes    []*model.Node         `json:"nodes"`
}

// Info returns the full cluster overview.
func (s *ClusterService) Info(connID int) (*ClusterView, error) {
	overview, nodes, err := s.service.Overview(context.Background(), connID)
	if err != nil {
		return nil, err
	}
	return &ClusterView{Overview: *overview, Nodes: nodes}, nil
}

// Summary returns the aggregated cluster counters.
func (s *ClusterService) Summary(connID int) (*model.ClusterSummary, error) {
	return s.service.GetClusterSummary(context.Background(), connID)
}

// Brokers returns every known broker node.
func (s *ClusterService) Brokers(connID int) ([]*model.Node, error) {
	return s.service.GetBrokers(context.Background(), connID)
}

// BrokerDetail returns runtime statistics for a single broker.
func (s *ClusterService) BrokerDetail(connID int, brokerAddr string) (*model.Node, error) {
	return s.service.GetBrokerDetail(context.Background(), connID, brokerAddr)
}

// NodeConfig returns one broker's effective settings, as the broker reports
// them rather than as its config file reads.
func (s *ClusterService) NodeConfig(connID int, brokerAddr string) (map[string]string, error) {
	return s.service.NodeConfig(context.Background(), connID, brokerAddr)
}

// MaintenanceTasks lists the housekeeping jobs a node can be asked to run,
// and which of them destroy message data.
//
// The renderer offers only what this returns, so a task cannot be triggered by
// name from the frontend without appearing here first.
func (s *ClusterService) MaintenanceTasks() []MaintenanceTaskView {
	tasks := model.KnownMaintenanceTasks()
	views := make([]MaintenanceTaskView, 0, len(tasks))
	for _, task := range tasks {
		views = append(views, MaintenanceTaskView{
			Task:        string(task),
			Destructive: task.Destructive(),
		})
	}
	return views
}

// MaintenanceTaskView is one offerable housekeeping job.
type MaintenanceTaskView struct {
	Task string `json:"task"`
	// Destructive marks a task that removes message data rather than only
	// reclaiming what is already unreachable, so the UI can confirm it harder.
	Destructive bool `json:"destructive"`
}

// RunMaintenance asks one broker to run a housekeeping job now.
func (s *ClusterService) RunMaintenance(connID int, brokerAddr string, task string) error {
	return s.service.RunMaintenance(context.Background(), connID, brokerAddr, model.MaintenanceTask(task))
}
