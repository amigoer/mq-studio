package rocketmq

import (
	"context"
	"fmt"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// getBrokerAddress returns the first available master broker and the active client.
func (c *Conn) getBrokerAddress(ctx context.Context) (string, *admin.Client, error) {
	client := c.client

	var (
		clusterInfo  *admin.ClusterInfo
		activeClient = client
	)
	err := ExecWithTimeout(client, timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
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
