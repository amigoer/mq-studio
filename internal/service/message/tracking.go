package message

import (
	"context"
	"fmt"
	"strings"

	"github.com/amigoer/rocket-leaf/internal/model"
	"github.com/amigoer/rocket-leaf/internal/rocketmq"
	"github.com/amigoer/rocket-leaf/internal/service/internal/mqexec"
	"github.com/amigoer/rocket-leaf/internal/service/internal/resource"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// GetMessageTrack returns consumption progress for groups subscribed to a message topic.
func (s *Service) GetMessageTrack(topic, messageID string) ([]*model.MessageTrackItem, error) {
	topic = strings.TrimSpace(topic)
	messageID = strings.TrimSpace(messageID)
	if topic == "" || messageID == "" {
		return nil, fmt.Errorf("查询消息轨迹失败: Topic 和 Message ID 不能为空")
	}

	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return nil, fmt.Errorf("获取客户端失败: %w", err)
	}

	message, err := s.lookupTrackedMessage(client, topic, messageID)
	if err != nil {
		return nil, err
	}
	if message.BrokerName == "" {
		message.BrokerName = s.resolveMessageBrokerName(client, message)
	}

	groups, err := s.queryConsumerGroups(client, topic)
	if err != nil {
		return nil, err
	}

	tracks := make([]*model.MessageTrackItem, 0, len(groups))
	for _, group := range groups {
		if resource.IsSystemGroup(group) {
			continue
		}
		track := &model.MessageTrackItem{
			ConsumerGroup: group,
			TrackType:     "UNKNOWN",
			ConsumeStatus: "未知",
		}
		if trackErr := s.populateTrack(client, group, message, track); trackErr != nil {
			track.TrackType = "UNKNOWN"
			track.ConsumeStatus = "无法获取消费进度"
			track.ExceptionDesc = trackErr.Error()
		}
		tracks = append(tracks, track)
	}
	return tracks, nil
}

func (s *Service) lookupTrackedMessage(client *admin.Client, topic, messageID string) (*admin.MessageExt, error) {
	var message *admin.MessageExt
	err := mqexec.WithTimeout(client, s.settings.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
		var findErr error
		message, findErr = findMessageByID(ctx, retryClient, topic, messageID)
		return findErr
	})
	if err != nil {
		return nil, fmt.Errorf("查询目标消息失败: %w", err)
	}
	if message == nil {
		return nil, fmt.Errorf("查询目标消息失败: 消息不存在")
	}
	return message, nil
}

func (s *Service) queryConsumerGroups(client *admin.Client, topic string) ([]string, error) {
	var groups []string
	err := mqexec.WithTimeout(client, s.settings.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
		var callErr error
		groups, callErr = retryClient.QueryTopicConsumeByWho(ctx, topic)
		return callErr
	})
	if err != nil {
		return nil, fmt.Errorf("查询消费者组失败: %w", err)
	}
	return groups, nil
}

func (s *Service) populateTrack(
	client *admin.Client,
	group string,
	message *admin.MessageExt,
	track *model.MessageTrackItem,
) error {
	return mqexec.WithTimeout(client, s.settings.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
		stats, err := retryClient.ExamineConsumeStats(ctx, group)
		if err != nil {
			return err
		}

		var targetOffset *admin.OffsetWrapper
		for queueKey, offset := range stats.OffsetTable {
			if offset != nil && matchesMessageQueueKey(queueKey, message.Topic, message.BrokerName, message.QueueId) {
				targetOffset = offset
				break
			}
		}
		if targetOffset == nil {
			track.TrackType = "NOT_CONSUME_YET"
			track.ConsumeStatus = "未找到该消息队列的消费位点"
		} else if targetOffset.ConsumerOffset > message.QueueOffset {
			track.TrackType = "CONSUMED"
			track.ConsumeStatus = "已消费"
		} else {
			track.TrackType = "NOT_CONSUME_YET"
			track.ConsumeStatus = "未消费"
		}
		return nil
	})
}

func (s *Service) resolveMessageBrokerName(client *admin.Client, message *admin.MessageExt) string {
	if message == nil {
		return ""
	}
	var brokerName string
	_ = mqexec.WithTimeout(client, s.settings.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
		route, err := retryClient.ExamineTopicRouteInfo(ctx, message.Topic)
		if err != nil {
			return err
		}
		storeHost := strings.TrimPrefix(strings.TrimSpace(message.StoreHost), "/")
		for _, broker := range route.BrokerDatas {
			if broker == nil {
				continue
			}
			for _, address := range broker.BrokerAddrs {
				if strings.TrimPrefix(strings.TrimSpace(address), "/") == storeHost {
					brokerName = broker.BrokerName
					return nil
				}
			}
		}
		return nil
	})
	return brokerName
}
