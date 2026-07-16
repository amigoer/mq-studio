package topic

import (
	"context"
	"fmt"
	"strings"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
	"github.com/amigoer/rocket-leaf/daemon/internal/rocketmq"
	"github.com/amigoer/rocket-leaf/daemon/internal/service/internal/mqexec"
	"github.com/amigoer/rocket-leaf/daemon/internal/service/internal/timestamp"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// GetTopicDetail returns details for a topic.
func (s *Service) GetTopicDetail(topicName string) (*model.TopicItem, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return nil, fmt.Errorf("获取客户端失败: %w", err)
	}

	var item *model.TopicItem
	err = mqexec.WithTimeout(client, s.settings.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
		routeInfo, callErr := retryClient.ExamineTopicRouteInfo(ctx, topicName)
		if callErr != nil {
			return callErr
		}

		detail := &model.TopicItem{
			ID:          s.getNextID(),
			Topic:       topicName,
			MessageType: model.MessageTypeNormal,
			Routes:      make([]model.TopicRouteItem, 0),
			LastUpdated: timestamp.Now(),
		}
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
			detail.ReadQueue += queueData.ReadQueueNums
			detail.WriteQueue += queueData.WriteQueueNums
		}
		if len(detail.Routes) > 0 {
			detail.Perm = detail.Routes[0].Perm
		}
		item = detail
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("获取 Topic 路由信息失败: %w", err)
	}
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
