package topic

import (
	"context"
	"fmt"
	"strings"

	"github.com/amigoer/rocket-leaf/internal/model"
	"github.com/amigoer/rocket-leaf/internal/rocketmq"
	"github.com/amigoer/rocket-leaf/internal/service/internal/mqexec"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// CreateTopic creates a topic.
func (s *Service) CreateTopic(topicName string, brokerAddress string, readQueue int, writeQueue int, permission string) error {
	return s.applyTopicConfig("创建", topicName, brokerAddress, readQueue, writeQueue, permission)
}

// UpdateTopic updates a topic configuration. RocketMQ has no separate update
// command: the broker upserts whatever configuration it is handed.
func (s *Service) UpdateTopic(topicName string, brokerAddress string, readQueue int, writeQueue int, permission string) error {
	return s.applyTopicConfig("更新", topicName, brokerAddress, readQueue, writeQueue, permission)
}

// applyTopicConfig writes a topic configuration to one broker. The queue counts
// are that broker's own setting, so callers must pass the value for the broker
// they selected rather than a cluster-wide total.
func (s *Service) applyTopicConfig(action string, topicName string, brokerAddress string, readQueue int, writeQueue int, permission string) error {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return fmt.Errorf("获取客户端失败: %w", err)
	}

	topicName = strings.TrimSpace(topicName)
	brokerAddress = strings.TrimSpace(brokerAddress)
	if topicName == "" {
		return fmt.Errorf("%s Topic 失败: Topic 名称不能为空", action)
	}
	if brokerAddress == "" {
		return fmt.Errorf("%s Topic 失败: Broker 地址不能为空，请先连接集群并选择可用 Broker", action)
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

	config := admin.TopicConfig{
		TopicName:       topicName,
		ReadQueueNums:   readQueue,
		WriteQueueNums:  writeQueue,
		Perm:            model.PermToInt(model.TopicPerm(permission)),
		TopicFilterType: "SINGLE_TAG",
	}
	err = mqexec.WithTimeout(client, s.settings.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
		return retryClient.CreateTopic(ctx, brokerAddress, config)
	})
	if err != nil {
		return fmt.Errorf("%s Topic 失败: %w", action, err)
	}
	return nil
}

// DeleteTopic deletes a topic.
func (s *Service) DeleteTopic(topicName string, clusterName string) error {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return fmt.Errorf("获取客户端失败: %w", err)
	}

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

	_ = mqexec.Do(client, func(retryClient *admin.Client) error {
		ctx, cancel := context.WithTimeout(context.Background(), s.settings.GetRequestTimeout())
		defer cancel()
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
		_ = mqexec.Do(client, func(retryClient *admin.Client) error {
			ctx, cancel := context.WithTimeout(context.Background(), s.settings.GetRequestTimeout())
			defer cancel()
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
		callErr := mqexec.Do(client, func(retryClient *admin.Client) error {
			ctx, cancel := context.WithTimeout(context.Background(), s.settings.GetRequestTimeout())
			defer cancel()
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
