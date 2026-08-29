package rocketmq

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/amigoer/mq-studio/internal/model"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// CreateTopic creates a topic.
func (c *Conn) CreateTopic(ctx context.Context, topicName string, brokerAddress string, readQueue int, writeQueue int, permission string) error {
	return c.applyTopicConfig(ctx, "创建", topicName, brokerAddress, readQueue, writeQueue, permission)
}

// UpdateTopic updates a topic configuration. RocketMQ has no separate update
// command: the broker upserts whatever configuration it is handed.
func (c *Conn) UpdateTopic(ctx context.Context, topicName string, brokerAddress string, readQueue int, writeQueue int, permission string) error {
	return c.applyTopicConfig(ctx, "更新", topicName, brokerAddress, readQueue, writeQueue, permission)
}

// applyTopicConfig writes a topic configuration to the brokers that should
// hold it.
//
// An empty broker address means every master, which is what creating a topic
// on a cluster normally means: a topic present on one broker of three is a
// topic two thirds of the producers cannot reach. Naming a broker narrows it
// to that one, which is how a per-broker queue count is changed.
//
// The queue counts are one broker's own setting, not a cluster-wide total, so
// applying to every master gives each of them that many queues.
func (c *Conn) applyTopicConfig(ctx context.Context, action string, topicName string, brokerAddress string, readQueue int, writeQueue int, permission string) error {

	topicName = strings.TrimSpace(topicName)
	brokerAddress = strings.TrimSpace(brokerAddress)
	if topicName == "" {
		return fmt.Errorf("%s Topic 失败: Topic 名称不能为空", action)
	}
	if readQueue <= 0 {
		readQueue = 4
	}
	if writeQueue <= 0 {
		writeQueue = 4
	}
	if readQueue > 1024 || writeQueue > 1024 {
		return fmt.Errorf("%s Topic 失败: 队列数不能超过 1024", action)
	}
	if permission != string(model.PermRW) && permission != string(model.PermR) &&
		permission != string(model.PermW) && permission != string(model.PermDeny) {
		return fmt.Errorf("%s Topic 失败: 不支持的权限 %q", action, permission)
	}

	targets := []string{brokerAddress}
	if brokerAddress == "" {
		masters, err := c.masterBrokerAddrs(ctx)
		if err != nil {
			return fmt.Errorf("%s Topic 失败: %w", action, err)
		}
		targets = masters
	}

	config := admin.TopicConfig{
		TopicName:       topicName,
		ReadQueueNums:   readQueue,
		WriteQueueNums:  writeQueue,
		Perm:            model.PermToInt(model.TopicPerm(permission)),
		TopicFilterType: "SINGLE_TAG",
	}

	failures := make([]string, 0)
	for _, target := range targets {
		callErr := c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
			return retryClient.CreateTopic(ctx, target, config)
		})
		if callErr != nil {
			failures = append(failures, fmt.Sprintf("%s: %v", target, callErr))
		}
	}
	// A partial write is reported rather than swallowed: the topic now exists
	// on some brokers and not others, and the caller has to know which.
	if len(failures) > 0 {
		return fmt.Errorf("%s Topic 时部分 Broker 失败: %s", action, strings.Join(failures, "; "))
	}
	return nil
}

// masterBrokerAddrs lists every master in the cluster.
func (c *Conn) masterBrokerAddrs(ctx context.Context) ([]string, error) {
	var clusterInfo *admin.ClusterInfo
	err := c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
		var callErr error
		clusterInfo, callErr = retryClient.ExamineBrokerClusterInfo(ctx)
		return callErr
	})
	if err != nil {
		return nil, fmt.Errorf("获取集群信息失败: %w", err)
	}

	addresses := make([]string, 0, len(clusterInfo.BrokerAddrTable))
	seen := make(map[string]struct{}, len(clusterInfo.BrokerAddrTable))
	for _, brokerData := range clusterInfo.BrokerAddrTable {
		if brokerData == nil {
			continue
		}
		address := brokerData.BrokerAddrs["0"]
		if address == "" {
			continue
		}
		if _, exists := seen[address]; exists {
			continue
		}
		seen[address] = struct{}{}
		addresses = append(addresses, address)
	}
	if len(addresses) == 0 {
		return nil, fmt.Errorf("未找到可用 Master Broker")
	}
	sort.Strings(addresses)
	return addresses, nil
}

// DeleteTopic deletes a topic.
func (c *Conn) DeleteTopic(ctx context.Context, topicName string, clusterName string) error {

	topicName = strings.TrimSpace(topicName)
	clusterName = strings.TrimSpace(clusterName)
	if topicName == "" {
		return fmt.Errorf("删除 Topic 失败: Topic 名称不能为空")
	}

	clusterCandidates := make([]string, 0, 4)
	seenClusters := make(map[string]struct{})
	appendCluster := func(name string) {
		name = strings.TrimSpace(name)
		if name == "" {
			return
		}
		if _, exists := seenClusters[name]; exists {
			return
		}
		seenClusters[name] = struct{}{}
		clusterCandidates = append(clusterCandidates, name)
	}

	if clusterName != "" && clusterName != "默认集群" {
		appendCluster(clusterName)
	}

	_ = c.exec(func(retryClient *admin.Client) error {
		routeInfo, routeErr := retryClient.ExamineTopicRouteInfo(ctx, topicName)
		if routeErr != nil || routeInfo == nil {
			return routeErr
		}
		for _, brokerData := range routeInfo.BrokerDatas {
			if brokerData != nil {
				appendCluster(brokerData.Cluster)
			}
		}
		return nil
	})

	if len(clusterCandidates) == 0 {
		_ = c.exec(func(retryClient *admin.Client) error {
			clusterInfo, clusterErr := retryClient.ExamineBrokerClusterInfo(ctx)
			if clusterErr != nil || clusterInfo == nil {
				return clusterErr
			}
			for name := range clusterInfo.ClusterAddrTable {
				appendCluster(name)
			}
			return nil
		})
	}

	if len(clusterCandidates) == 0 {
		return fmt.Errorf("删除 Topic 失败: 未找到可用集群，请先检查连接状态")
	}

	var lastErr error
	for _, candidate := range clusterCandidates {
		callErr := c.exec(func(retryClient *admin.Client) error {
			return retryClient.DeleteTopic(ctx, topicName, candidate)
		})
		if callErr == nil {
			return nil
		}
		lastErr = callErr
		if strings.Contains(callErr.Error(), "不存在") {
			continue
		}
	}

	if lastErr != nil {
		return fmt.Errorf("删除 Topic 失败: 已尝试集群 %s，最后错误: %w", strings.Join(clusterCandidates, ", "), lastErr)
	}
	return fmt.Errorf("删除 Topic 失败: 未能在集群 %s 中删除", strings.Join(clusterCandidates, ", "))
}
