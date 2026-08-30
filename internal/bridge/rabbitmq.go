package bridge

import (
	"context"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/rabbitmq"
)

// RabbitMQService exposes what only RabbitMQ has.
//
// It is one service rather than several because it is one family's surface:
// splitting virtual hosts, policies and the broker census into three would put
// three names in the bindings for what a reader thinks of as "the RabbitMQ
// pages".
type RabbitMQService struct {
	service *rabbitmq.Service
}

// Census returns the broker's running totals: object counts, queued depth and
// message rates for the whole cluster.
//
// Nil means nothing is connected, which the overview renders as its own state
// rather than as an error.
func (s *RabbitMQService) Census(connID int) (*model.BrokerCensus, error) {
	return s.service.Census(context.Background(), connID)
}

// ClientConnections returns the transport connections open against the broker.
func (s *RabbitMQService) ClientConnections(connID int, namespace string) ([]*model.ClientConnection, error) {
	return s.service.ClientConnections(context.Background(), connID, namespace)
}

// ClientChannels returns the channels multiplexed inside those connections.
func (s *RabbitMQService) ClientChannels(connID int, namespace string) ([]*model.ClientChannel, error) {
	return s.service.ClientChannels(context.Background(), connID, namespace)
}

// Health runs the broker's own checks, and reads its feature flags and the
// deprecated features it still allows.
func (s *RabbitMQService) Health(connID int) (*model.BrokerHealth, error) {
	return s.service.Health(context.Background(), connID)
}
