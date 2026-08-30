package rocketmq

import (
	"context"
	"fmt"
	"strings"

	"github.com/amigoer/mq-studio/internal/model"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// RunMaintenance asks one broker to run a housekeeping job now.
//
// Every task here is something the broker does on its own schedule anyway;
// running it on demand is how an operator reclaims space before that schedule
// comes round. None of them report what they freed - the broker answers only
// success or failure - so a caller cannot show a before and after.
func (c *Conn) RunMaintenance(ctx context.Context, address string, task model.MaintenanceTask) error {
	address = strings.TrimSpace(address)
	if address == "" {
		return fmt.Errorf("执行 Broker 维护操作失败: Broker 地址不能为空")
	}

	var run func(context.Context, *admin.Client) error
	switch task {
	case model.TaskCleanExpiredQueues:
		run = func(ctx context.Context, client *admin.Client) error {
			return client.CleanExpiredConsumerQueueByAddr(ctx, address)
		}
	case model.TaskCleanUnusedTopics:
		run = func(ctx context.Context, client *admin.Client) error {
			return client.CleanUnusedTopicByAddr(ctx, address)
		}
	case model.TaskDeleteExpiredLogs:
		run = func(ctx context.Context, client *admin.Client) error {
			return client.DeleteExpiredCommitLogByAddr(ctx, address)
		}
	default:
		return fmt.Errorf("不支持的维护操作: %q", task)
	}

	if err := c.execWithTimeout(timeoutFrom(ctx), run); err != nil {
		return fmt.Errorf("执行 Broker 维护操作 %s 失败: %w", task, err)
	}
	return nil
}
