package rocketmq

import (
	"strconv"
	"strings"
	"time"

	"github.com/amigoer/mq-studio/internal/model"

	admin "github.com/amigoer/rocketmq-admin-go"
	"github.com/apache/rocketmq-client-go/v2/primitive"
)

// convertMessageExt converts a RocketMQ admin message to the public model.
//
// It is the only place a MessageExt becomes a MessageItem, which makes it the
// one place a namespaced connection has to drop the namespace: every topic on
// a MessageItem is the short name from here on, including the two properties
// that carry the topic a retry or dead letter came from.
func (c *Conn) convertMessageExt(message *admin.MessageExt) *model.MessageItem {
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
		Topic:          c.unwrap(message.Topic),
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
		Properties:     c.unwrapTopicProperties(message.Properties),
		Status:         status,
		RetryTimes:     retryTimes,
	}
}

// unwrapTopicProperties drops the namespace from the two properties that hold
// a topic name. RETRY_TOPIC and REAL_TOPIC are how a retry or dead-letter
// message says where it came from, and the dead-letter board shows that name
// rather than the internal one it is sitting in.
//
// The map is copied rather than edited: it belongs to the caller's MessageExt,
// which the tail path reuses.
func (c *Conn) unwrapTopicProperties(properties map[string]string) map[string]string {
	if c.config.Namespace == "" || properties == nil {
		return properties
	}
	copied := make(map[string]string, len(properties))
	for key, value := range properties {
		if key == primitive.PropertyRetryTopic || key == primitive.PropertyRealTopic {
			value = c.unwrap(value)
		}
		copied[key] = value
	}
	return copied
}
