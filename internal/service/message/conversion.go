package message

import (
	"strconv"
	"strings"
	"time"

	"github.com/amigoer/mq-studio/internal/model"

	admin "github.com/amigoer/rocketmq-admin-go"
	"github.com/apache/rocketmq-client-go/v2/primitive"
)

// convertMessageExt converts a RocketMQ admin message to the public model.
func (s *Service) convertMessageExt(message *admin.MessageExt) *model.MessageItem {
	tags := ""
	keys := ""
	retryTimes := 0
	if message.Properties != nil {
		tags = message.Properties["TAGS"]
		keys = message.Properties["KEYS"]
		if raw, ok := message.Properties[primitive.PropertyReconsumeTime]; ok {
			retryTimes, _ = strconv.Atoi(raw)
		}
	}

	status := model.MsgNormal
	if strings.HasPrefix(message.Topic, "%DLQ%") || strings.HasPrefix(message.Topic, "DLQ%") {
		status = model.MsgDLQ
	} else if strings.HasPrefix(message.Topic, "%RETRY%") || strings.HasPrefix(message.Topic, "RETRY%") {
		status = model.MsgRetry
	}

	messageID := strings.TrimSpace(message.MsgId)
	if messageID == "" {
		messageID = message.OffsetMsgId
	}

	return &model.MessageItem{
		ID:             s.getNextID(),
		Topic:          message.Topic,
		MessageID:      messageID,
		Tags:           tags,
		Keys:           keys,
		QueueID:        message.QueueId,
		QueueOffset:    message.QueueOffset,
		StoreHost:      message.StoreHost,
		BornHost:       message.BornHost,
		StoreTime:      time.Unix(message.StoreTimestamp/1000, 0).Format("2006-01-02 15:04:05"),
		StoreTimestamp: message.StoreTimestamp,
		Body:           string(message.Body),
		Properties:     message.Properties,
		Status:         status,
		RetryTimes:     retryTimes,
	}
}
