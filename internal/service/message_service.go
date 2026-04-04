package service

import (
	"context"
	"fmt"
	"strings"
	"sync/atomic"
	"time"

	"rocket-leaf/internal/model"
	"rocket-leaf/internal/rocketmq"

	rocketmqClient "github.com/apache/rocketmq-client-go/v2"
	"github.com/apache/rocketmq-client-go/v2/primitive"
	"github.com/apache/rocketmq-client-go/v2/producer"
	admin "github.com/amigoer/rocketmq-admin-go"
)

// MessageService 消息查询服务
type MessageService struct {
	nextID          int64
	settingsService *SettingsService
}

// NewMessageService 创建消息查询服务
func NewMessageService(settingsService *SettingsService) *MessageService {
	return &MessageService{
		nextID:          1,
		settingsService: settingsService,
	}
}

func (s *MessageService) getNextID() int {
	return int(atomic.AddInt64(&s.nextID, 1))
}

// QueryMessages 查询消息，startTime/endTime 为 Unix 毫秒时间戳，0 表示不限制
func (s *MessageService) QueryMessages(topic string, key string, maxResults int, startTime, endTime int64) ([]*model.MessageItem, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return nil, fmt.Errorf("获取客户端失败: %w", err)
	}



	if maxResults <= 0 {
		maxResults = s.settingsService.GetFetchLimit()
	}
	if endTime <= 0 {
		endTime = time.Now().UnixMilli()
	}
	if startTime < 0 {
		startTime = 0
	}

	result := make([]*model.MessageItem, 0)
	trimmedKey := strings.TrimSpace(key)

	// 统一使用时间范围浏览（RocketMQ 的 Key 索引查询不够可靠）
	// 如果有 Key 过滤条件，多拉取一些消息以确保过滤后有足够结果
	fetchNum := maxResults
	if trimmedKey != "" {
		fetchNum = maxResults * 8
		if fetchNum < 512 {
			fetchNum = 512
		}
	}

	timeCtx, timeCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer timeCancel()
	err = executeWithClientRetry(client, func(retryClient *admin.Client) error {
		msgs, callErr := retryClient.QueryMessageByTime(timeCtx, topic, startTime, endTime, fetchNum)
		if callErr != nil {
			return callErr
		}

		tmpResult := make([]*model.MessageItem, 0, len(msgs))
		for _, msg := range msgs {
			// 如果指定了 Key，只保留包含该 Key 的消息
			if trimmedKey != "" {
				msgKeys, _ := msg.Properties["KEYS"]
				if !strings.Contains(msgKeys, trimmedKey) {
					continue
				}
			}
			tmpResult = append(tmpResult, s.convertMessageExt(msg))
			if len(tmpResult) >= maxResults {
				break
			}
		}

		result = tmpResult
		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("查询消息失败: %w", err)
	}

	return result, nil
}

// convertMessageExt 将 admin.MessageExt 转换为 model.MessageItem
func (s *MessageService) convertMessageExt(msg *admin.MessageExt) *model.MessageItem {
	tags := ""
	keys := ""
	if msg.Properties != nil {
		if t, ok := msg.Properties["TAGS"]; ok {
			tags = t
		}
		if k, ok := msg.Properties["KEYS"]; ok {
			keys = k
		}
	}

	return &model.MessageItem{
		ID:             s.getNextID(),
		Topic:          msg.Topic,
		MessageID:      msg.MsgId,
		Tags:           tags,
		Keys:           keys,
		QueueID:        msg.QueueId,
		QueueOffset:    msg.QueueOffset,
		StoreHost:      msg.StoreHost,
		BornHost:       msg.BornHost,
		StoreTime:      time.Unix(msg.StoreTimestamp/1000, 0).Format("2006-01-02 15:04:05"),
		StoreTimestamp: msg.StoreTimestamp,
		Body:           string(msg.Body),
		Properties:     msg.Properties,
		Status:         model.MsgNormal,
	}
}

// QueryMessageByID 按消息 ID 查询消息
func (s *MessageService) QueryMessageByID(topic string, msgID string) (*model.MessageItem, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return nil, fmt.Errorf("获取客户端失败: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
	defer cancel()

	var item *model.MessageItem
	err = executeWithClientRetry(client, func(retryClient *admin.Client) error {
		msg, callErr := retryClient.ViewMessage(ctx, topic, msgID)
		if callErr != nil {
			return callErr
		}

		item = s.convertMessageExt(msg)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("查询消息失败: %w", err)
	}

	return item, nil
}

// GetMessageDetail 获取消息详情
func (s *MessageService) GetMessageDetail(topic string, msgID string) (*model.MessageItem, error) {
	return s.QueryMessageByID(topic, msgID)
}

// GetMessageTrack 获取消息轨迹
// 通过查询订阅该 Topic 的消费者组，逐一检查消费进度来判断消息是否已被消费
func (s *MessageService) GetMessageTrack(topic string, msgID string) ([]*model.MessageTrackItem, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return nil, fmt.Errorf("获取客户端失败: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
	defer cancel()

	// 1. 获取订阅该 Topic 的所有消费者组
	var groups []string
	err = executeWithClientRetry(client, func(retryClient *admin.Client) error {
		result, callErr := retryClient.QueryTopicConsumeByWho(ctx, topic)
		if callErr != nil {
			return callErr
		}
		groups = result
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("查询消费者组失败: %w", err)
	}

	tracks := make([]*model.MessageTrackItem, 0, len(groups))

	// 2. 逐个消费者组检查消费状态
	for _, group := range groups {
		if isSystemGroup(group) {
			continue
		}

		track := &model.MessageTrackItem{
			ConsumerGroup: group,
			TrackType:     "UNKNOWN",
			ConsumeStatus: "未知",
		}

		// 检查消费者组是否在线
		checkCtx, checkCancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
		err = executeWithClientRetry(client, func(retryClient *admin.Client) error {
			connInfo, callErr := retryClient.ExamineConsumerConnectionInfo(checkCtx, group)
			if callErr != nil {
				track.TrackType = "NOT_ONLINE"
				track.ConsumeStatus = "消费者不在线"
				track.ExceptionDesc = callErr.Error()
				return nil
			}

			if connInfo == nil || len(connInfo.ConnectionSet) == 0 {
				track.TrackType = "NOT_ONLINE"
				track.ConsumeStatus = "消费者不在线"
				return nil
			}

			// 消费者在线，检查消费进度
			stats, statsErr := retryClient.ExamineConsumeStats(checkCtx, group)
			if statsErr != nil {
				track.TrackType = "UNKNOWN"
				track.ConsumeStatus = "无法获取消费进度"
				track.ExceptionDesc = statsErr.Error()
				return nil
			}

			// 检查该 Topic 下各队列的消费偏移量
			// OffsetTable 的 key 是序列化的 MessageQueue 字符串，包含 topic 名称
			consumed := false
			hasTopicQueue := false
			for mqKey, offset := range stats.OffsetTable {
				if !strings.Contains(mqKey, topic) {
					continue
				}
				hasTopicQueue = true
				if offset.ConsumerOffset >= offset.BrokerOffset {
					consumed = true
				}
			}

			if !hasTopicQueue {
				track.TrackType = "NOT_CONSUME_YET"
				track.ConsumeStatus = "未订阅该 Topic"
			} else if consumed {
				track.TrackType = "CONSUMED"
				track.ConsumeStatus = "已消费"
			} else {
				track.TrackType = "NOT_CONSUME_YET"
				track.ConsumeStatus = "未消费"
			}

			return nil
		})
		checkCancel()

		tracks = append(tracks, track)
	}

	return tracks, nil
}

// ResendMessage 重投消息
func (s *MessageService) ResendMessage(consumerGroup string, clientID string, topic string, msgID string) (string, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return "", fmt.Errorf("获取客户端失败: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
	defer cancel()

	var result string
	err = executeWithClientRetry(client, func(retryClient *admin.Client) error {
		retryResult, callErr := retryClient.ConsumeMessageDirectly(ctx, consumerGroup, clientID, topic, msgID)
		if callErr != nil {
			return callErr
		}
		result = fmt.Sprintf("消息重投结果: %v", retryResult)
		return nil
	})
	if err != nil {
		return "", fmt.Errorf("重投消息失败: %w", err)
	}

	return result, nil
}

// SendMessage 发送消息到指定 Topic
func (s *MessageService) SendMessage(topic string, tags string, keys string, body string) (string, error) {
	topic = strings.TrimSpace(topic)
	if topic == "" {
		return "", fmt.Errorf("发送消息失败: Topic 不能为空")
	}
	if strings.TrimSpace(body) == "" {
		return "", fmt.Errorf("发送消息失败: 消息体不能为空")
	}

	// 获取默认连接的 NameServer 地址
	manager := rocketmq.GetClientManager()
	nameServer := manager.GetDefaultConnection()
	if nameServer == "" {
		return "", fmt.Errorf("发送消息失败: 未设置默认连接")
	}

	// 创建 Producer
	p, err := rocketmqClient.NewProducer(
		producer.WithNameServer([]string{nameServer}),
		producer.WithRetry(2),
		producer.WithSendMsgTimeout(s.settingsService.GetRequestTimeout()),
	)
	if err != nil {
		return "", fmt.Errorf("创建 Producer 失败: %w", err)
	}

	if err := p.Start(); err != nil {
		return "", fmt.Errorf("启动 Producer 失败: %w", err)
	}
	defer p.Shutdown()

	msg := &primitive.Message{
		Topic: topic,
		Body:  []byte(body),
	}
	if tags != "" {
		msg.WithTag(tags)
	}
	if keys != "" {
		msg.WithKeys([]string{keys})
	}

	result, err := p.SendSync(context.Background(), msg)
	if err != nil {
		return "", fmt.Errorf("发送消息失败: %w", err)
	}

	return fmt.Sprintf("发送成功, MsgID: %s", result.MsgID), nil
}
