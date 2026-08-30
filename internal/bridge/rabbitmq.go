package bridge

import (
	"context"
	"strconv"

	rabbitmqdriver "github.com/amigoer/mq-studio/internal/driver/rabbitmq"
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

// DeadLetterQueues finds the queues dead letters land in, and the queues that
// feed each one.
func (s *RabbitMQService) DeadLetterQueues(connID int, namespace string) ([]*model.DeadLetterQueue, error) {
	return s.service.DeadLetterQueues(context.Background(), connID, namespace)
}

// QueueInput is a queue declaration as the form collects it.
//
// Nothing like TopicInput, and it should not be: a RocketMQ topic is read and
// write queue counts and a permission bitmask, a RabbitMQ queue is a type, a
// lifetime and a bag of arguments the broker validates itself.
type QueueInput struct {
	Vhost      string `json:"vhost"`
	Name       string `json:"name"`
	QueueType  string `json:"queueType"`
	Durable    bool   `json:"durable"`
	AutoDelete bool   `json:"autoDelete"`
	// Arguments is the declaration bag as JSON, so a number stays a number.
	// RabbitMQ rejects a float where it wants an integer, and a string where
	// it wants either.
	Arguments string `json:"arguments"`
}

// DeclareQueue creates a queue.
func (s *RabbitMQService) DeclareQueue(connID int, input QueueInput) error {
	return s.service.DeclareQueue(context.Background(), connID, model.DestinationSpec{
		Ref: model.DestinationRef{Namespace: input.Vhost, Name: input.Name},
		Attributes: map[string]string{
			rabbitmqdriver.AttrQueueType:  input.QueueType,
			rabbitmqdriver.AttrDurable:    strconv.FormatBool(input.Durable),
			rabbitmqdriver.AttrAutoDelete: strconv.FormatBool(input.AutoDelete),
			rabbitmqdriver.AttrArguments:  input.Arguments,
		},
	})
}

// DeleteQueue removes a queue and everything in it.
//
// ifUnused and ifEmpty are the broker's own preconditions. They are checked
// where the delete happens, which is the only place they can be checked
// without a race.
func (s *RabbitMQService) DeleteQueue(connID int, vhost, name string, ifUnused, ifEmpty bool) error {
	return s.service.DeleteQueue(context.Background(), connID,
		model.DestinationRef{Namespace: vhost, Name: name}, ifUnused, ifEmpty)
}

// PurgeQueue drops everything a queue is holding. There is no undo.
func (s *RabbitMQService) PurgeQueue(connID int, vhost, name string) error {
	return s.service.PurgeQueue(context.Background(), connID,
		model.DestinationRef{Namespace: vhost, Name: name})
}

// MoveInput drains one queue into an exchange.
type MoveInput struct {
	Vhost string `json:"vhost"`
	From  string `json:"from"`
	// ToExchange empty is the default exchange, which routes by queue name.
	ToExchange string `json:"toExchange"`
	// ToRoutingKey empty means each message keeps its own.
	ToRoutingKey string `json:"toRoutingKey"`
	Limit        int    `json:"limit"`
}

// MoveMessages returns how many reached the target, which is meaningful even
// when the call also returns an error: that count already moved.
func (s *RabbitMQService) MoveMessages(connID int, input MoveInput) (int, error) {
	return s.service.MoveMessages(context.Background(), connID, model.MoveRequest{
		Namespace:    input.Vhost,
		From:         input.From,
		ToExchange:   input.ToExchange,
		ToRoutingKey: input.ToRoutingKey,
		Limit:        input.Limit,
	})
}

// RebalanceQueues spreads quorum queue leaders back across the nodes.
func (s *RabbitMQService) RebalanceQueues(connID int) error {
	return s.service.RebalanceQueues(context.Background(), connID)
}
