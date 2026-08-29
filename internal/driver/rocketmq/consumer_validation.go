package rocketmq

import (
	"fmt"
	"strings"

	"github.com/amigoer/mq-studio/internal/model"
)

func validateConsumerGroupInput(groupName, brokerAddress, consumeMode string, maxRetry int) (string, string, string, int, error) {
	groupName = strings.TrimSpace(groupName)
	// An empty broker address is allowed and means every master, which is what
	// a consumer group normally wants: one configured on a single broker only
	// rebalances across that broker's queues.
	brokerAddress = strings.TrimSpace(brokerAddress)
	if groupName == "" {
		return "", "", "", 0, fmt.Errorf("消费者组名称不能为空")
	}
	if consumeMode != string(model.ModeClustering) && consumeMode != string(model.ModeBroadcasting) {
		return "", "", "", 0, fmt.Errorf("不支持的消费模式: %s", consumeMode)
	}
	if maxRetry < 0 || maxRetry > 64 {
		return "", "", "", 0, fmt.Errorf("最大重试次数必须在 0-64 之间")
	}
	return groupName, brokerAddress, consumeMode, maxRetry, nil
}
