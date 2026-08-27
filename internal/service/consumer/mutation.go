package consumer

import (
	"context"
	"fmt"
	"strings"

	"github.com/amigoer/mq-studio/internal/driver/rocketmq"
	"github.com/amigoer/mq-studio/internal/model"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// CreateConsumerGroup creates a consumer group.
func (s *Service) CreateConsumerGroup(groupName string, brokerAddress string, consumeMode string, maxRetry int) error {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return fmt.Errorf("获取客户端失败: %w", err)
	}

	groupName, brokerAddress, consumeMode, maxRetry, err = validateConsumerGroupInput(
		groupName,
		brokerAddress,
		consumeMode,
		maxRetry,
	)
	if err != nil {
		return err
	}
	candidates, err := s.resolveMasterBrokerAddrs(client, brokerAddress)
	if err != nil {
		return fmt.Errorf("创建消费者组失败: %w", err)
	}

	config := admin.SubscriptionGroupConfig{
		GroupName:              groupName,
		ConsumeEnable:          true,
		ConsumeFromMinEnable:   true,
		ConsumeBroadcastEnable: consumeMode == string(model.ModeBroadcasting),
		RetryMaxTimes:          maxRetry,
	}
	return s.applySubscriptionGroupConfig(client, candidates, config, "创建")
}

// UpdateConsumerGroup updates a consumer group configuration.
func (s *Service) UpdateConsumerGroup(groupName string, brokerAddress string, consumeMode string, maxRetry int) error {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return fmt.Errorf("获取客户端失败: %w", err)
	}

	groupName, brokerAddress, consumeMode, maxRetry, err = validateConsumerGroupInput(
		groupName,
		brokerAddress,
		consumeMode,
		maxRetry,
	)
	if err != nil {
		return err
	}
	candidates, err := s.resolveMasterBrokerAddrs(client, brokerAddress)
	if err != nil {
		return fmt.Errorf("更新消费者组失败: %w", err)
	}

	config := admin.SubscriptionGroupConfig{
		GroupName:              groupName,
		ConsumeEnable:          true,
		ConsumeFromMinEnable:   true,
		ConsumeBroadcastEnable: consumeMode == string(model.ModeBroadcasting),
		RetryMaxTimes:          maxRetry,
	}
	return s.applySubscriptionGroupConfig(client, candidates, config, "更新")
}

// DeleteConsumerGroup deletes a consumer group.
func (s *Service) DeleteConsumerGroup(groupName string, brokerAddress string) error {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return fmt.Errorf("获取客户端失败: %w", err)
	}

	groupName = strings.TrimSpace(groupName)
	brokerAddress = strings.TrimSpace(brokerAddress)
	if groupName == "" {
		return fmt.Errorf("删除消费者组失败: 消费者组名称不能为空")
	}
	candidates, err := s.resolveMasterBrokerAddrs(client, brokerAddress)
	if err != nil {
		return fmt.Errorf("删除消费者组失败: %w", err)
	}

	failures := make([]string, 0)
	for _, address := range candidates {
		callErr := rocketmq.ExecWithTimeout(client, s.settings.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
			return retryClient.DeleteSubscriptionGroup(ctx, address, groupName)
		})
		if callErr != nil {
			failures = append(failures, fmt.Sprintf("%s: %v", address, callErr))
		}
	}
	if len(failures) > 0 {
		return fmt.Errorf("删除消费者组时部分 Broker 失败: %s", strings.Join(failures, "; "))
	}
	return nil
}

// ResetOffset resets consumer offsets.
func (s *Service) ResetOffset(groupName string, topicName string, timestamp int64, force bool) error {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return fmt.Errorf("获取客户端失败: %w", err)
	}

	groupName = strings.TrimSpace(groupName)
	topicName = strings.TrimSpace(topicName)
	if groupName == "" || topicName == "" {
		return fmt.Errorf("重置消费位点失败: 消费者组和 Topic 不能为空")
	}
	if timestamp < 0 {
		return fmt.Errorf("重置消费位点失败: 时间戳不能为负数")
	}

	err = rocketmq.ExecWithTimeout(client, s.settings.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
		_, callErr := retryClient.ResetOffsetByTimestamp(ctx, topicName, groupName, timestamp, force)
		return callErr
	})
	if err != nil {
		return fmt.Errorf("重置消费位点失败: %w", err)
	}
	return nil
}

func (s *Service) applySubscriptionGroupConfig(
	client *admin.Client,
	candidates []string,
	config admin.SubscriptionGroupConfig,
	operation string,
) error {
	if len(candidates) == 0 {
		return fmt.Errorf("%s消费者组失败: 未找到可用 Broker", operation)
	}
	failures := make([]string, 0)
	for _, address := range candidates {
		callErr := rocketmq.ExecWithTimeout(client, s.settings.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
			return retryClient.CreateSubscriptionGroup(ctx, address, config)
		})
		if callErr != nil {
			failures = append(failures, fmt.Sprintf("%s: %v", address, callErr))
		}
	}
	if len(failures) > 0 {
		return fmt.Errorf("%s消费者组时部分 Broker 失败: %s", operation, strings.Join(failures, "; "))
	}
	return nil
}
