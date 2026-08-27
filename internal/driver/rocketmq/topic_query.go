package rocketmq

import (
	"context"
	"fmt"

	"github.com/amigoer/mq-studio/internal/driver/rocketmq/resource"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/timestamp"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// newTopicItem creates a list entry holding only what the name server returned.
// Everything the brokers own starts unknown so a failed enrichment shows "—"
// instead of an invented zero.
func newTopicItem(topicName string) *model.TopicItem {
	return &model.TopicItem{
		Topic:          topicName,
		ReadQueue:      unknownMetric,
		WriteQueue:     unknownMetric,
		MessageType:    model.MessageTypeNormal,
		ConsumerGroups: unknownMetric,
		TpsIn:          unknownMetric,
		TpsOut:         unknownMetric,
		LastUpdated:    timestamp.Now(),
	}
}

// GetTopics returns all non-system topics.
func (c *Conn) GetTopics(ctx context.Context) ([]*model.TopicItem, error) {
	client := c.client

	result := make([]*model.TopicItem, 0)
	// mqexec may swap in a reconnected client; enrichment must use that one.
	var working *admin.Client
	err := ExecWithTimeout(client, timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
		working = retryClient

		topicList, callErr := retryClient.FetchAllTopicList(ctx)
		if callErr != nil {
			return callErr
		}

		topics := make([]*model.TopicItem, 0, len(topicList.TopicList))
		for _, topicName := range topicList.TopicList {
			if resource.IsSystemTopic(topicName) {
				continue
			}
			topics = append(topics, newTopicItem(topicName))
		}
		result = topics
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("获取 Topic 列表失败: %w", err)
	}

	c.enrichTopics(ctx, working, result)
	return result, nil
}

// GetAllTopics returns all topics, including system topics.
func (c *Conn) GetAllTopics(ctx context.Context) ([]*model.TopicItem, error) {
	client := c.client

	result := make([]*model.TopicItem, 0)
	var working *admin.Client
	err := ExecWithTimeout(client, timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
		working = retryClient

		topicList, callErr := retryClient.FetchAllTopicList(ctx)
		if callErr != nil {
			return callErr
		}

		topics := make([]*model.TopicItem, 0, len(topicList.TopicList))
		for _, topicName := range topicList.TopicList {
			item := newTopicItem(topicName)
			if resource.IsSystemTopic(topicName) {
				item.Description = "系统"
			}
			topics = append(topics, item)
		}
		result = topics
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("获取 Topic 列表失败: %w", err)
	}

	c.enrichTopics(ctx, working, result)
	return result, nil
}

// GetTopicTotal returns the number of non-system topics.
func (c *Conn) GetTopicTotal(ctx context.Context) (int, error) {
	client := c.client

	total := 0
	err := Exec(client, func(retryClient *admin.Client) error {

		topicList, callErr := retryClient.FetchAllTopicList(ctx)
		if callErr != nil {
			return callErr
		}

		count := 0
		for _, topicName := range topicList.TopicList {
			if !resource.IsSystemTopic(topicName) {
				count++
			}
		}
		total = count
		return nil
	})
	if err != nil {
		return 0, fmt.Errorf("获取 Topic 总数失败: %w", err)
	}
	return total, nil
}

// GetTopicsByCluster returns topics for a cluster.
func (c *Conn) GetTopicsByCluster(ctx context.Context, clusterName string) ([]*model.TopicItem, error) {
	client := c.client

	result := make([]*model.TopicItem, 0)
	var working *admin.Client
	err := ExecWithTimeout(client, timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
		working = retryClient

		topicList, callErr := retryClient.FetchTopicsByCluster(ctx, clusterName)
		if callErr != nil {
			return callErr
		}

		topics := make([]*model.TopicItem, 0, len(topicList.TopicList))
		for _, topicName := range topicList.TopicList {
			if resource.IsSystemTopic(topicName) {
				continue
			}
			item := newTopicItem(topicName)
			item.Cluster = clusterName
			topics = append(topics, item)
		}
		result = topics
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("获取集群 Topic 列表失败: %w", err)
	}

	c.enrichTopics(ctx, working, result)
	return result, nil
}
