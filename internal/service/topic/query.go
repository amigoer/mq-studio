package topic

import (
	"context"
	"fmt"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/rocketmq"
	"github.com/amigoer/mq-studio/internal/service/internal/mqexec"
	"github.com/amigoer/mq-studio/internal/service/internal/resource"
	"github.com/amigoer/mq-studio/internal/service/internal/timestamp"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// newTopicItem creates a list entry holding only what the name server returned.
// Everything the brokers own starts unknown so a failed enrichment shows "—"
// instead of an invented zero.
func (s *Service) newTopicItem(topicName string) *model.TopicItem {
	return &model.TopicItem{
		ID:             s.getNextID(),
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
func (s *Service) GetTopics() ([]*model.TopicItem, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return []*model.TopicItem{}, nil
	}

	result := make([]*model.TopicItem, 0)
	// mqexec may swap in a reconnected client; enrichment must use that one.
	var working *admin.Client
	err = mqexec.WithTimeout(client, s.settings.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
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
			topics = append(topics, s.newTopicItem(topicName))
		}
		result = topics
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("获取 Topic 列表失败: %w", err)
	}

	s.enrichTopics(working, result)
	return result, nil
}

// GetAllTopics returns all topics, including system topics.
func (s *Service) GetAllTopics() ([]*model.TopicItem, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return []*model.TopicItem{}, nil
	}

	result := make([]*model.TopicItem, 0)
	var working *admin.Client
	err = mqexec.WithTimeout(client, s.settings.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
		working = retryClient

		topicList, callErr := retryClient.FetchAllTopicList(ctx)
		if callErr != nil {
			return callErr
		}

		topics := make([]*model.TopicItem, 0, len(topicList.TopicList))
		for _, topicName := range topicList.TopicList {
			item := s.newTopicItem(topicName)
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

	s.enrichTopics(working, result)
	return result, nil
}

// GetTopicTotal returns the number of non-system topics.
func (s *Service) GetTopicTotal() (int, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return 0, nil
	}

	total := 0
	err = mqexec.Do(client, func(retryClient *admin.Client) error {
		ctx, cancel := context.WithTimeout(context.Background(), s.settings.GetRequestTimeout())
		defer cancel()

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
func (s *Service) GetTopicsByCluster(clusterName string) ([]*model.TopicItem, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return nil, fmt.Errorf("获取客户端失败: %w", err)
	}

	result := make([]*model.TopicItem, 0)
	var working *admin.Client
	err = mqexec.WithTimeout(client, s.settings.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
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
			item := s.newTopicItem(topicName)
			item.Cluster = clusterName
			topics = append(topics, item)
		}
		result = topics
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("获取集群 Topic 列表失败: %w", err)
	}

	s.enrichTopics(working, result)
	return result, nil
}
