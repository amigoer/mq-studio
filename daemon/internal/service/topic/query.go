package topic

import (
	"context"
	"fmt"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
	"github.com/amigoer/rocket-leaf/daemon/internal/rocketmq"
	"github.com/amigoer/rocket-leaf/daemon/internal/service/internal/mqexec"
	"github.com/amigoer/rocket-leaf/daemon/internal/service/internal/resource"
	"github.com/amigoer/rocket-leaf/daemon/internal/service/internal/timestamp"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// GetTopics returns all non-system topics.
func (s *Service) GetTopics() ([]*model.TopicItem, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return []*model.TopicItem{}, nil
	}

	result := make([]*model.TopicItem, 0)
	err = mqexec.Do(client, func(retryClient *admin.Client) error {
		ctx, cancel := context.WithTimeout(context.Background(), s.settings.GetRequestTimeout())
		defer cancel()

		topicList, callErr := retryClient.FetchAllTopicList(ctx)
		if callErr != nil {
			return callErr
		}

		topics := make([]*model.TopicItem, 0, len(topicList.TopicList))
		for _, topicName := range topicList.TopicList {
			if resource.IsSystemTopic(topicName) {
				continue
			}
			topics = append(topics, &model.TopicItem{
				ID:          s.getNextID(),
				Topic:       topicName,
				ReadQueue:   -1,
				WriteQueue:  -1,
				MessageType: model.MessageTypeNormal,
				LastUpdated: timestamp.Now(),
			})
		}
		result = topics
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("获取 Topic 列表失败: %w", err)
	}
	return result, nil
}

// GetAllTopics returns all topics, including system topics.
func (s *Service) GetAllTopics() ([]*model.TopicItem, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return []*model.TopicItem{}, nil
	}

	result := make([]*model.TopicItem, 0)
	err = mqexec.Do(client, func(retryClient *admin.Client) error {
		ctx, cancel := context.WithTimeout(context.Background(), s.settings.GetRequestTimeout())
		defer cancel()

		topicList, callErr := retryClient.FetchAllTopicList(ctx)
		if callErr != nil {
			return callErr
		}

		topics := make([]*model.TopicItem, 0, len(topicList.TopicList))
		for _, topicName := range topicList.TopicList {
			item := &model.TopicItem{
				ID:          s.getNextID(),
				Topic:       topicName,
				ReadQueue:   -1,
				WriteQueue:  -1,
				MessageType: model.MessageTypeNormal,
				LastUpdated: timestamp.Now(),
			}
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
	err = mqexec.Do(client, func(retryClient *admin.Client) error {
		ctx, cancel := context.WithTimeout(context.Background(), s.settings.GetRequestTimeout())
		defer cancel()

		topicList, callErr := retryClient.FetchTopicsByCluster(ctx, clusterName)
		if callErr != nil {
			return callErr
		}

		topics := make([]*model.TopicItem, 0, len(topicList.TopicList))
		for _, topicName := range topicList.TopicList {
			if resource.IsSystemTopic(topicName) {
				continue
			}
			topics = append(topics, &model.TopicItem{
				ID:          s.getNextID(),
				Topic:       topicName,
				Cluster:     clusterName,
				ReadQueue:   -1,
				WriteQueue:  -1,
				MessageType: model.MessageTypeNormal,
				LastUpdated: timestamp.Now(),
			})
		}
		result = topics
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("获取集群 Topic 列表失败: %w", err)
	}
	return result, nil
}
