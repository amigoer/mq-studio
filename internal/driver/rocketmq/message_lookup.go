package rocketmq

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/amigoer/mq-studio/internal/model"

	admin "github.com/amigoer/rocketmq-admin-go"
	"github.com/apache/rocketmq-client-go/v2/primitive"
)

// QueryMessageByID returns a message by client or offset message ID.
func (c *Conn) QueryMessageByID(ctx context.Context, topic, messageID string) (*model.MessageItem, error) {
	topic = strings.TrimSpace(topic)
	messageID = strings.TrimSpace(messageID)
	if topic == "" || messageID == "" {
		return nil, fmt.Errorf("查询消息失败: Topic 和 Message ID 不能为空")
	}

	client := c.client

	var item *model.MessageItem
	err := ExecWithTimeout(client, timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
		message, findErr := findMessageByID(ctx, retryClient, topic, messageID)
		if findErr != nil {
			return findErr
		}
		item = c.convertMessageExt(message)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("查询消息失败: %w", err)
	}
	return item, nil
}

// findMessageByID applies the shared client-ID and offset-ID compatibility strategy.
func findMessageByID(ctx context.Context, client *admin.Client, topic, messageID string) (*admin.MessageExt, error) {
	message, viewErr := client.ViewMessage(ctx, topic, messageID)
	if viewErr == nil && message != nil {
		return message, nil
	}

	// Direct lookup behavior differs across broker versions, so query the client-ID index next.
	messages, queryErr := client.QueryMessage(ctx, topic, messageID, 64, 0, time.Now().UnixMilli())
	if queryErr != nil {
		if viewErr != nil {
			return nil, fmt.Errorf("直接查看失败: %v；索引回查失败: %w", viewErr, queryErr)
		}
		return nil, queryErr
	}
	for _, candidate := range messages {
		if messageMatchesID(candidate, messageID) {
			return candidate, nil
		}
	}

	// The index may not be visible yet, so scan recent messages as a final fallback.
	recent, scanErr := queryMessagesNewest(
		ctx, client, topic, "", "", 1000, 0, time.Now().UnixMilli(),
	)
	if scanErr != nil {
		return nil, fmt.Errorf("未找到消息: %s；最近消息扫描失败: %w", messageID, scanErr)
	}
	for _, candidate := range recent {
		if messageMatchesID(candidate, messageID) {
			return candidate, nil
		}
	}
	return nil, fmt.Errorf("未找到消息: %s", messageID)
}

func messageMatchesID(message *admin.MessageExt, messageID string) bool {
	if message == nil {
		return false
	}
	if message.MsgId == messageID || message.OffsetMsgId == messageID {
		return true
	}
	return message.Properties[primitive.PropertyUniqueClientMessageIdKeyIndex] == messageID
}
