package rocketmq

import (
	"context"
	"fmt"

	admin "github.com/amigoer/rocketmq-admin-go"
)

type subscriptionGroupLookup struct {
	Cluster string
	Config  *admin.SubscriptionGroupConfig
}

func (c *Conn) getSubscriptionGroupConfig(ctx context.Context, client *admin.Client, groupName string) (*subscriptionGroupLookup, error) {
	var clusterInfo *admin.ClusterInfo
	err := ExecWithTimeout(client, timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
		var callErr error
		clusterInfo, callErr = retryClient.ExamineBrokerClusterInfo(ctx)
		return callErr
	})
	if err != nil {
		return nil, err
	}

	for _, brokerData := range clusterInfo.BrokerAddrTable {
		if brokerData == nil {
			continue
		}
		masterAddress, ok := brokerData.BrokerAddrs["0"]
		if !ok || masterAddress == "" {
			continue
		}

		var subscriptionGroups map[string]*admin.SubscriptionGroupConfig
		groupErr := ExecWithTimeout(client, timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
			var callErr error
			subscriptionGroups, callErr = retryClient.GetAllSubscriptionGroup(ctx, masterAddress)
			return callErr
		})
		if groupErr != nil || subscriptionGroups == nil {
			continue
		}

		if config, exists := subscriptionGroups[groupName]; exists && config != nil {
			return &subscriptionGroupLookup{
				Cluster: brokerData.Cluster,
				Config:  config,
			}, nil
		}
	}
	return nil, nil
}

func (c *Conn) resolveMasterBrokerAddrs(ctx context.Context, client *admin.Client, preferredAddress string) ([]string, error) {
	addresses := make([]string, 0, 4)
	seen := make(map[string]struct{})
	appendAddress := func(address string) {
		if address == "" {
			return
		}
		if _, exists := seen[address]; exists {
			return
		}
		seen[address] = struct{}{}
		addresses = append(addresses, address)
	}
	appendAddress(preferredAddress)

	var clusterInfo *admin.ClusterInfo
	err := ExecWithTimeout(client, timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
		var callErr error
		clusterInfo, callErr = retryClient.ExamineBrokerClusterInfo(ctx)
		return callErr
	})
	if err != nil {
		if len(addresses) > 0 {
			return addresses, nil
		}
		return nil, err
	}

	for _, brokerData := range clusterInfo.BrokerAddrTable {
		if brokerData != nil {
			appendAddress(brokerData.BrokerAddrs["0"])
		}
	}
	if len(addresses) == 0 {
		return nil, fmt.Errorf("未找到可用 Broker")
	}
	return addresses, nil
}
