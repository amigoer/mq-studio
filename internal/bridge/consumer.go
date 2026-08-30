package bridge

import (
	"context"

	"github.com/amigoer/mq-studio/internal/driver/rocketmq"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/subscription"
)

// ConsumerService exposes subscription operations to the frontend.
//
// It speaks the canonical model. Consume mode, retry limits and the
// subscription and client lists travel in the attribute map, whose keys the
// frontend's rocketmq module reads.
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
func (s *ConsumerService) List(connID int) ([]*model.Subscription, error) {
	return s.service.List(context.Background(), connID)
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

// Clients reports what each connected consumer in a group is doing: the queues
// it holds and how fast it is getting through them.
//
// It is a separate call rather than part of Detail because it costs one round
// trip per connected client, and a group list should not pay that.
func (s *ConsumerService) Clients(connID int, group string) ([]*model.SubscriptionClient, error) {
	return s.service.Clients(context.Background(), connID, model.SubscriptionRef{Name: group})
}

// CloneOffset copies one consumer group's read position onto another, which is
// how a replacement group starts where the old one is instead of replaying
// everything it already handled.
func (s *ConsumerService) CloneOffset(connID int, request model.CloneOffsetRequest) error {
	return s.service.CloneOffset(context.Background(), connID, request)
}
