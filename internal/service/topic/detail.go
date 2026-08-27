package topic

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/amigoer/mq-studio/internal/driver/rocketmq"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/internal/mqexec"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// GetTopicDetail returns details for a topic.
func (s *Service) GetTopicDetail(topicName string) (*model.TopicItem, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return nil, fmt.Errorf("获取客户端失败: %w", err)
	}

	var item *model.TopicItem
	var working *admin.Client
	err = mqexec.WithTimeout(client, s.settings.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
		working = retryClient

		routeInfo, callErr := retryClient.ExamineTopicRouteInfo(ctx, topicName)
		if callErr != nil {
			return callErr
		}

		detail := s.newTopicItem(topicName)
		detail.Routes = make([]model.TopicRouteItem, 0)
		if strings.TrimSpace(routeInfo.OrderTopicConf) != "" {
			detail.MessageType = model.MessageTypeFIFO
		}

		for _, queueData := range routeInfo.QueueDatas {
			route := model.TopicRouteItem{
				Broker:     queueData.BrokerName,
				ReadQueue:  queueData.ReadQueueNums,
				WriteQueue: queueData.WriteQueueNums,
				Perm:       model.IntToPerm(queueData.Perm),
			}
			for _, brokerData := range routeInfo.BrokerDatas {
				if brokerData.BrokerName != queueData.BrokerName {
					continue
				}
				if address, ok := brokerData.BrokerAddrs["0"]; ok {
					route.BrokerAddr = address
				}
				if detail.Cluster == "" {
					detail.Cluster = brokerData.Cluster
				}
				break
			}

			detail.Routes = append(detail.Routes, route)
		}

		// The name server returns routes in map order. Sort them so the entry
		// promoted to the topic-level summary is stable across refreshes.
		sort.Slice(detail.Routes, func(left, right int) bool {
			return detail.Routes[left].Broker < detail.Routes[right].Broker
		})
		if len(detail.Routes) > 0 {
			// Queue counts are per-broker configuration, not a cluster total:
			// the edit form writes this value back to a single broker, so
			// summing the routes here would multiply the queues on save.
			primary := detail.Routes[0]
			detail.ReadQueue = primary.ReadQueue
			detail.WriteQueue = primary.WriteQueue
			detail.Perm = primary.Perm
		}
		item = detail
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("获取 Topic 路由信息失败: %w", err)
	}

	s.enrichTopicDetail(working, item)
	return item, nil
}

// GetTopicRoute returns routing information for a topic.
func (s *Service) GetTopicRoute(topicName string) ([]model.TopicRouteItem, error) {
	detail, err := s.GetTopicDetail(topicName)
	if err != nil {
		return nil, err
	}
	return detail.Routes, nil
}
