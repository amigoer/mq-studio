package rocketmq

import (
	"context"
	"fmt"
	"strconv"
	"sync"

	"github.com/amigoer/mq-studio/internal/driver/rocketmq/resource"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/timestamp"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// GetClusterInfo returns cluster information.
func (c *Conn) GetClusterInfo(ctx context.Context) (*model.ClusterInfo, error) {

	var result *model.ClusterInfo
	err := c.exec(func(retryClient *admin.Client) error {

		clusterInfo, callErr := retryClient.ExamineBrokerClusterInfo(ctx)
		if callErr != nil {
			return callErr
		}

		current := buildClusterInfo(retryClient, clusterInfo)
		c.enrichBrokers(ctx, current)
		c.enrichResourceTotals(ctx, clusterInfo, current)
		result = current
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("获取集群信息失败: %w", err)
	}

	return result, nil
}

// buildClusterInfo maps the raw broker tables into the application model. The
// runtime fields are left at their sentinel values for enrichBrokers to fill.
func buildClusterInfo(client *admin.Client, clusterInfo *admin.ClusterInfo) *model.ClusterInfo {
	current := &model.ClusterInfo{
		NameServers: client.GetNameServerAddressList(),
		Brokers:     make([]*model.BrokerNode, 0),
	}

	brokerClusters := make(map[string]string)
	for clusterName, brokerNames := range clusterInfo.ClusterAddrTable {
		if current.ClusterName == "" {
			current.ClusterName = clusterName
		}

		for _, brokerName := range brokerNames {
			if brokerName == "" {
				continue
			}
			if _, exists := brokerClusters[brokerName]; !exists {
				brokerClusters[brokerName] = clusterName
			}
		}
	}

	brokerID := 1
	for brokerName, brokerData := range clusterInfo.BrokerAddrTable {
		if brokerData == nil {
			continue
		}

		clusterName := brokerData.Cluster
		if clusterName == "" {
			clusterName = brokerClusters[brokerName]
		}
		if clusterName == "" {
			clusterName = "默认集群"
		}
		if current.ClusterName == "" {
			current.ClusterName = clusterName
		}

		for brokerIDText, address := range brokerData.BrokerAddrs {
			if address == "" {
				continue
			}

			role := model.RoleSlave
			if brokerIDText == "0" {
				role = model.RoleMaster
			}

			brokerIDValue, _ := strconv.Atoi(brokerIDText)
			current.Brokers = append(current.Brokers, &model.BrokerNode{
				ID:         brokerID,
				Cluster:    clusterName,
				BrokerName: brokerName,
				BrokerID:   brokerIDValue,
				Role:       role,
				Address:    address,
				Status:     model.NodeWarning,
				Topics:     -1,
				Groups:     -1,
				TpsIn:      -1,
				TpsOut:     -1,
				LastUpdate: timestamp.Now(),
			})
			brokerID++
		}
	}

	current.TotalBrokers = len(current.Brokers)
	return current
}

// enrichBrokers populates runtime fields without failing the complete overview
// when an individual broker cannot be inspected.
func (c *Conn) enrichBrokers(ctx context.Context, result *model.ClusterInfo) {
	semaphore := make(chan struct{}, 6)
	var waitGroup sync.WaitGroup
	for _, broker := range result.Brokers {
		if broker == nil {
			continue
		}
		waitGroup.Add(1)
		go func(node *model.BrokerNode) {
			defer waitGroup.Done()
			semaphore <- struct{}{}
			defer func() { <-semaphore }()

			c.enrichBrokerRuntimeStats(ctx, node)
		}(broker)
	}
	waitGroup.Wait()

	diskSum := 0
	diskCount := 0
	for _, broker := range result.Brokers {
		if broker.Status == model.NodeOnline {
			result.OnlineBrokers++
		}
		if broker.CommitLogDiskUsage > 0 {
			diskSum += broker.CommitLogDiskUsage
			diskCount++
		}
	}
	if diskCount > 0 {
		result.AvgDiskUsage = diskSum / diskCount
	}
}

// enrichResourceTotals adds best-effort topic and consumer-group totals.
func (c *Conn) enrichResourceTotals(ctx context.Context, clusterInfo *admin.ClusterInfo, result *model.ClusterInfo) {
	topicCtx, topicCancel := context.WithTimeout(context.Background(), timeoutFrom(ctx))
	if topicList, err := c.current().FetchAllTopicList(topicCtx); err == nil && topicList != nil {
		for _, topic := range topicList.TopicList {
			if !resource.IsSystemTopic(topic) {
				result.TotalTopics++
			}
		}
	}
	topicCancel()

	groups := make(map[string]struct{})
	for _, brokerData := range clusterInfo.BrokerAddrTable {
		if brokerData == nil {
			continue
		}
		masterAddress, ok := brokerData.BrokerAddrs["0"]
		if !ok {
			continue
		}

		groupCtx, groupCancel := context.WithTimeout(context.Background(), timeoutFrom(ctx))
		subscriptionGroups, err := c.current().GetAllSubscriptionGroup(groupCtx, masterAddress)
		groupCancel()
		if err != nil || subscriptionGroups == nil {
			continue
		}
		for groupName := range subscriptionGroups {
			if !resource.IsSystemGroup(groupName) {
				groups[groupName] = struct{}{}
			}
		}
	}
	result.TotalGroups = len(groups)
}
