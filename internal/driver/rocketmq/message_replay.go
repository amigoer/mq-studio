package rocketmq

import (
	"context"
	"fmt"
	"strings"

	"github.com/amigoer/mq-studio/internal/model"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// ReplayMessage asks one connected consumer to run its listener on a message
// again, and reports what that listener returned.
//
// It is the answer to "why does this one message fail", which nothing else
// here can give: a dead letter says a message was given up on after N
// attempts, the trace says which groups saw it, and neither says what the
// application did with it. This runs the handler on a live client and brings
// back its verdict, its remark and how long it took.
//
// The message is consumed for real. On a client with auto-commit the offset
// moves, so this is a diagnostic with a side effect rather than a dry run.
func (c *Conn) ReplayMessage(ctx context.Context, request model.ReplayRequest) (*model.ReplayResult, error) {
	group := strings.TrimSpace(request.Subscription)
	client := strings.TrimSpace(request.ClientID)
	topic := strings.TrimSpace(request.Destination)
	messageID := strings.TrimSpace(request.MessageID)
	switch {
	case group == "":
		return nil, fmt.Errorf("消费组名称不能为空")
	case client == "":
		return nil, fmt.Errorf("客户端 ID 不能为空")
	case topic == "":
		return nil, fmt.Errorf("Topic 名称不能为空")
	case messageID == "":
		return nil, fmt.Errorf("消息 ID 不能为空")
	}

	var returned *admin.ConsumeMessageDirectlyResult
	err := c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
		var callErr error
		returned, callErr = retryClient.ConsumeMessageDirectly(ctx, group, client, topic, messageID)
		return callErr
	})
	if err != nil {
		return nil, fmt.Errorf("投递到消费者失败: %w", err)
	}
	if returned == nil {
		return nil, fmt.Errorf("消费者没有返回结果")
	}
	return &model.ReplayResult{
		Result:     returned.ConsumeResult,
		Remark:     returned.Remark,
		SpentMs:    returned.SpentTimeMills,
		Ordered:    returned.Order,
		AutoCommit: returned.AutoCommit,
	}, nil
}
