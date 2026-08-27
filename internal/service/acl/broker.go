package acl

import (
	"context"
	"fmt"

	"github.com/amigoer/mq-studio/internal/driver/rocketmq"
	"github.com/amigoer/mq-studio/internal/service/internal/mqexec"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// getBrokerAddress returns the first available master broker and the active client.
func (s *Service) getBrokerAddress() (string, *admin.Client, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return "", nil, fmt.Errorf("未连接集群: %w", err)
	}

	var (
		clusterInfo  *admin.ClusterInfo
		activeClient = client
	)
	err = mqexec.WithTimeout(client, s.settings.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
		var callErr error
		clusterInfo, callErr = retryClient.ExamineBrokerClusterInfo(ctx)
		if callErr == nil {
			activeClient = retryClient
		}
		return callErr
	})
	if err != nil {
		return "", nil, fmt.Errorf("获取集群信息失败: %w", err)
	}

	for _, brokerData := range clusterInfo.BrokerAddrTable {
		if brokerData == nil {
			continue
		}
		if address := brokerData.BrokerAddrs["0"]; address != "" {
			return address, activeClient, nil
		}
	}

	return "", nil, fmt.Errorf("未找到可用的 Master Broker")
}
