package bridge

import (
	"context"

	"github.com/amigoer/mq-studio/internal/driver/rocketmq"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/subscription"
)

// ConsumerService exposes subscription operations to the frontend.
//
// It still speaks model.ConsumerGroupItem. Converting back from the canonical
// shape here keeps the renderer untouched through the backend refactor.
type ConsumerService struct {
	service *subscription.Service
}

// ConsumerInput carries a consumer group form submission.
type ConsumerInput struct {
	Group       string `json:"group"`
	BrokerAddr  string `json:"brokerAddr"`
	ConsumeMode string `json:"consumeMode"`
	MaxRetry    int    `json:"maxRetry"`
}

func (input ConsumerInput) spec() model.SubscriptionSpec {
	return model.SubscriptionSpec{
		Ref: model.SubscriptionRef{Name: input.Group},
		Attributes: map[string]string{
			rocketmq.AttrBrokerAddr:  input.BrokerAddr,
			rocketmq.AttrConsumeMode: input.ConsumeMode,
			rocketmq.AttrMaxRetry:    itoa(input.MaxRetry),
		},
	}
}

// List returns every consumer group.
func (s *ConsumerService) List(connID int) ([]*model.ConsumerGroupItem, error) {
	subscriptions, err := s.service.List(context.Background(), connID)
	if err != nil {
		return nil, err
	}
	groups := make([]*model.ConsumerGroupItem, 0, len(subscriptions))
	for _, current := range subscriptions {
		groups = append(groups, rocketmq.GroupFromSubscription(current))
	}
	return groups, nil
}

// Detail returns a consumer group with its clients and subscriptions.
func (s *ConsumerService) Detail(connID int, group string) (*model.ConsumerGroupItem, error) {
	found, err := s.service.Detail(context.Background(), connID, model.SubscriptionRef{Name: group})
	if err != nil {
		return nil, err
	}
	return rocketmq.GroupFromSubscription(found), nil
}

// Stats returns the per-queue consume progress of a group.
func (s *ConsumerService) Stats(connID int, group string) (map[string]interface{}, error) {
	return s.service.Stats(context.Background(), connID, model.SubscriptionRef{Name: group})
}

// Create adds a consumer group on the target broker.
func (s *ConsumerService) Create(connID int, input ConsumerInput) error {
	return s.service.Create(context.Background(), connID, input.spec())
}

// Update changes an existing consumer group.
func (s *ConsumerService) Update(connID int, input ConsumerInput) error {
	return s.service.Update(context.Background(), connID, input.spec())
}

// Remove deletes a consumer group.
func (s *ConsumerService) Remove(connID int, group string, brokerAddr string) error {
	return s.service.Remove(context.Background(), connID,
		model.SubscriptionRef{Namespace: brokerAddr, Name: group})
}

// ResetOffset moves a consumer group's read position.
func (s *ConsumerService) ResetOffset(connID int, request model.ResetOffsetRequest) error {
	return s.service.ResetOffset(context.Background(), connID, request)
}
