package cluster

import "github.com/amigoer/rocket-leaf/internal/model"

// GetClusterSummary returns aggregate cluster statistics.
func (s *Service) GetClusterSummary() (*model.ClusterSummary, error) {
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
