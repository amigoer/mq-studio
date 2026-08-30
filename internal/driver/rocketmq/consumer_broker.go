package rocketmq

import (
	"context"
	"strings"

	admin "github.com/amigoer/rocketmq-admin-go"
)

type subscriptionGroupLookup struct {
	Cluster string
	Config  *admin.SubscriptionGroupConfig
}

func (c *Conn) getSubscriptionGroupConfig(ctx context.Context, groupName string) (*subscriptionGroupLookup, error) {
	var clusterInfo *admin.ClusterInfo
	err := c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
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
		groupErr := c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
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

// resolveMasterBrokerAddrs picks the brokers a group operation writes to.
//
// An empty address means every master, which is what a consumer group normally
// wants: a group configured on one broker of three only rebalances across that
// one's queues. A named address narrows it to that broker.
//
// It used to put the named address first and then append every master anyway,
// so naming one decided nothing.
func (c *Conn) resolveMasterBrokerAddrs(ctx context.Context, preferredAddress string) ([]string, error) {
	if address := strings.TrimSpace(preferredAddress); address != "" {
		return []string{address}, nil
	}
	return c.masterBrokerAddrs(ctx)
}
