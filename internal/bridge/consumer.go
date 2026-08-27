package bridge

import (
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/consumer"
)

// ConsumerService exposes RocketMQ consumer group operations to the frontend.
type ConsumerService struct {
	service *consumer.Service
}

// ConsumerInput carries a consumer group form submission.
type ConsumerInput struct {
	Group       string `json:"group"`
	BrokerAddr  string `json:"brokerAddr"`
	ConsumeMode string `json:"consumeMode"`
	MaxRetry    int    `json:"maxRetry"`
}

// List returns every consumer group.
func (s *ConsumerService) List() ([]*model.ConsumerGroupItem, error) {
	return s.service.GetConsumerGroups()
}

// Detail returns a single consumer group with its clients and subscriptions.
func (s *ConsumerService) Detail(group string) (*model.ConsumerGroupItem, error) {
	return s.service.GetConsumerGroupDetail(group)
}

// Stats returns the per-queue consume statistics for a group.
func (s *ConsumerService) Stats(group string) (map[string]interface{}, error) {
	return s.service.GetConsumeStats(group)
}

// Create adds a subscription group on the target broker.
func (s *ConsumerService) Create(input ConsumerInput) error {
	return s.service.CreateConsumerGroup(input.Group, input.BrokerAddr, input.ConsumeMode, input.MaxRetry)
}

// Update changes the configuration of an existing subscription group.
func (s *ConsumerService) Update(input ConsumerInput) error {
	return s.service.UpdateConsumerGroup(input.Group, input.BrokerAddr, input.ConsumeMode, input.MaxRetry)
}

// Remove deletes a subscription group from a broker.
func (s *ConsumerService) Remove(group string, brokerAddr string) error {
	return s.service.DeleteConsumerGroup(group, brokerAddr)
}

// ResetOffset rewinds a group's consume offset to a timestamp.
func (s *ConsumerService) ResetOffset(request model.ResetOffsetRequest) error {
	return s.service.ResetOffset(request.Group, request.Topic, request.Timestamp, request.Force)
}
