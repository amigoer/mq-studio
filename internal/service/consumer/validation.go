package consumer

import (
	"fmt"
	"strings"

	"github.com/amigoer/rocket-leaf/internal/model"
)

func validateConsumerGroupInput(groupName, brokerAddress, consumeMode string, maxRetry int) (string, string, string, int, error) {
	groupName = strings.TrimSpace(groupName)
	brokerAddress = strings.TrimSpace(brokerAddress)
	if groupName == "" || brokerAddress == "" {
		return "", "", "", 0, fmt.Errorf("消费者组名称和 Broker 地址不能为空")
	}
	if consumeMode != string(model.ModeClustering) && consumeMode != string(model.ModeBroadcasting) {
		return "", "", "", 0, fmt.Errorf("不支持的消费模式: %s", consumeMode)
	}
	if maxRetry < 0 || maxRetry > 64 {
		return "", "", "", 0, fmt.Errorf("最大重试次数必须在 0-64 之间")
	}
	return groupName, brokerAddress, consumeMode, maxRetry, nil
}
