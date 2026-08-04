package message

import (
	"errors"
	"fmt"
	"strings"

	"github.com/amigoer/rocket-leaf/internal/model"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// QueryDLQMessages returns dead-letter messages for a consumer group.
func (s *Service) QueryDLQMessages(groupName string, maxResults int) ([]*model.MessageItem, error) {
	groupName = strings.TrimSpace(groupName)
	if groupName == "" {
		return nil, fmt.Errorf("查询死信消息失败: 消费者组不能为空")
	}
	messages, err := s.QueryMessages("%DLQ%"+groupName, "", "", maxResults, 0, 0)
	if err != nil && errors.Is(err, admin.ErrTopicNotFound) {
		return []*model.MessageItem{}, nil
	}
	return messages, err
}

// QueryRetryMessages returns retry messages for a consumer group.
func (s *Service) QueryRetryMessages(groupName string, maxResults int) ([]*model.MessageItem, error) {
	groupName = strings.TrimSpace(groupName)
	if groupName == "" {
		return nil, fmt.Errorf("查询重试消息失败: 消费者组不能为空")
	}
	messages, err := s.QueryMessages("%RETRY%"+groupName, "", "", maxResults, 0, 0)
	if err != nil && errors.Is(err, admin.ErrTopicNotFound) {
		return []*model.MessageItem{}, nil
	}
	return messages, err
}
