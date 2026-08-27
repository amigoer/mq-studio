package cluster

import (
	"context"

	"github.com/amigoer/mq-studio/internal/model"
)

// GetClusterSummary returns aggregate cluster statistics.
func (s *Service) GetClusterSummary(ctx context.Context) (*model.ClusterSummary, error) {
	overview, nodes, err := s.Overview(ctx)
	if err != nil {
		return &model.ClusterSummary{}, nil
	}

	summary := &model.ClusterSummary{
		TotalClusters: 1,
		TotalBrokers:  overview.TotalNodes,
		AvgDiskUsage:  overview.AvgDiskUsage,
	}
	for _, node := range nodes {
		if node == nil {
			continue
		}
		switch node.Status {
		case model.NodeOnline:
			summary.OnlineBrokers++
		case model.NodeWarning:
			summary.WarningBrokers++
		default:
			summary.OfflineBrokers++
		}
	}
	return summary, nil
}
