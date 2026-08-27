package message

import (
	"context"
	"fmt"
	"strings"

	"github.com/amigoer/mq-studio/internal/driver/rocketmq"

	rocketmqClient "github.com/apache/rocketmq-client-go/v2"
	"github.com/apache/rocketmq-client-go/v2/primitive"
	"github.com/apache/rocketmq-client-go/v2/producer"
)

// ResendMessage republishes the original content as a new message.
func (s *Service) ResendMessage(consumerGroup, clientID, topic, messageID string) (string, error) {
	// Preserve legacy binding parameters while using a true republish operation.
	_ = consumerGroup
	_ = clientID

	item, err := s.QueryMessageByID(topic, messageID)
	if err != nil {
		return "", fmt.Errorf("读取原消息失败: %w", err)
	}
	targetTopic := item.Topic
	if item.Properties != nil {
		if original := strings.TrimSpace(item.Properties[primitive.PropertyRetryTopic]); original != "" {
			targetTopic = original
		} else if original := strings.TrimSpace(item.Properties[primitive.PropertyRealTopic]); original != "" {
			targetTopic = original
		}
	}
	if strings.HasPrefix(targetTopic, "%DLQ%") || strings.HasPrefix(targetTopic, "%RETRY%") ||
		strings.HasPrefix(targetTopic, "DLQ%") || strings.HasPrefix(targetTopic, "RETRY%") {
		return "", fmt.Errorf("无法从内部 Topic %s 解析原业务 Topic", targetTopic)
	}
	return s.SendMessage(targetTopic, item.Tags, item.Keys, item.Body, 0)
}

// SendMessage sends a message to a topic. Delay levels range from zero through eighteen.
func (s *Service) SendMessage(topic, tags, keys, body string, delayLevel int) (string, error) {
	topic = strings.TrimSpace(topic)
	if topic == "" {
		return "", fmt.Errorf("发送消息失败: Topic 不能为空")
	}
	if strings.TrimSpace(body) == "" {
		return "", fmt.Errorf("发送消息失败: 消息体不能为空")
	}
	if delayLevel < 0 || delayLevel > 18 {
		return "", fmt.Errorf("发送消息失败: 延迟等级必须在 0-18 之间")
	}

	manager := rocketmq.GetClientManager()
	if _, err := manager.GetDefaultClient(); err != nil {
		return "", fmt.Errorf("发送消息失败: %w", err)
	}
	clientConfig, err := manager.GetDefaultClientConfig()
	if err != nil {
		return "", fmt.Errorf("发送消息失败: %w", err)
	}

	producerOptions := []producer.Option{
		producer.WithNameServer(clientConfig.NameServers),
		producer.WithRetry(2),
		producer.WithSendMsgTimeout(s.settings.GetRequestTimeout()),
	}
	if clientConfig.EnableACL {
		producerOptions = append(producerOptions, producer.WithCredentials(primitive.Credentials{
			AccessKey: clientConfig.AccessKey,
			SecretKey: clientConfig.SecretKey,
		}))
	}
	messageProducer, err := rocketmqClient.NewProducer(producerOptions...)
	if err != nil {
		return "", fmt.Errorf("创建 Producer 失败: %w", err)
	}
	if err := messageProducer.Start(); err != nil {
		return "", fmt.Errorf("启动 Producer 失败: %w", err)
	}
	defer messageProducer.Shutdown()

	message := &primitive.Message{Topic: topic, Body: []byte(body)}
	if tags != "" {
		message.WithTag(tags)
	}
	if keys != "" {
		message.WithKeys([]string{keys})
	}
	if delayLevel > 0 {
		message.WithDelayTimeLevel(delayLevel)
	}

	ctx, cancel := context.WithTimeout(context.Background(), s.settings.GetRequestTimeout())
	defer cancel()
	result, err := messageProducer.SendSync(ctx, message)
	if err != nil {
		return "", fmt.Errorf("发送消息失败: %w", err)
	}

	messageID := strings.TrimSpace(result.MsgID)
	if messageID == "" {
		messageID = result.OffsetMsgID
	}
	return messageID, nil
}
