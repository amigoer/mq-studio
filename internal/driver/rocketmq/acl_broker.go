package rocketmq

import (
	"context"
	"fmt"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// getBrokerAddress returns the first available master broker.
func (c *Conn) getBrokerAddress(ctx context.Context) (string, error) {
	var clusterInfo *admin.ClusterInfo
	err := c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
		var callErr error
		clusterInfo, callErr = retryClient.ExamineBrokerClusterInfo(ctx)
		return callErr
	})
	if err != nil {
		return "", fmt.Errorf("获取集群信息失败: %w", err)
	}

	for _, brokerData := range clusterInfo.BrokerAddrTable {
		if brokerData == nil {
			continue
		}
		if address := brokerData.BrokerAddrs["0"]; address != "" {
			return address, nil
		}
	}

	return "", fmt.Errorf("未找到可用的 Master Broker")
}
