package driver

import (
	"context"

	"github.com/amigoer/mq-studio/internal/model"
)

// The interfaces below are optional. A Conn implements the ones its family
// supports; the orchestration layer discovers them by type assertion and
// returns ErrUnsupported for the rest.
//
// Every method takes a context that already carries the request deadline. The
// orchestration layer applies the configured timeout before calling in, so no
// driver holds a reference to application settings.
//
// Two surfaces still speak RocketMQ-shaped models, deliberately:
//
//   - MessageReader and friends use model.MessageItem, because how a canonical
//     message is identified is still an open decision. RocketMQ has a msgId,
//     Kafka has topic/partition/offset, RabbitMQ has no stable id at all, and
//     picking a shape before implementing the second driver would be guesswork.
//   - AccessAdmin follows RocketMQ ACL, the only implementation today.
//
// Both are what P5 exists to correct: implementing RabbitMQ against these is
// how we find out where the canonical shape actually has to sit.

// DestinationAdmin enumerates and manages topics, queues or streams.
type DestinationAdmin interface {
	ListDestinations(ctx context.Context, filter model.DestinationFilter) ([]*model.Destination, error)
	DestinationDetail(ctx context.Context, ref model.DestinationRef) (*model.Destination, error)
	CreateDestination(ctx context.Context, spec model.DestinationSpec) error
	UpdateDestination(ctx context.Context, spec model.DestinationSpec) error
	RemoveDestination(ctx context.Context, ref model.DestinationRef) error
}

// DestinationStats reports per-partition read ranges. Families with no
// partitions - RabbitMQ, MQTT - do not implement it.
//
// The payload is unstructured because it is passed straight through to the
// renderer today. Giving it a shape is part of canonicalising the message
// surface, not something to guess at now.
type DestinationStats interface {
	DestinationStats(ctx context.Context, ref model.DestinationRef) (map[string]interface{}, error)
}

// SubscriptionAdmin enumerates and manages consumer groups, Pulsar
// subscriptions or RabbitMQ queue consumers.
type SubscriptionAdmin interface {
	ListSubscriptions(ctx context.Context) ([]*model.Subscription, error)
	SubscriptionDetail(ctx context.Context, ref model.SubscriptionRef) (*model.Subscription, error)
	CreateSubscription(ctx context.Context, spec model.SubscriptionSpec) error
	RemoveSubscription(ctx context.Context, ref model.SubscriptionRef) error
}

// ProgressAdmin moves a subscription's read position.
//
// It is separate from SubscriptionAdmin because backlog and position are
// different things: RabbitMQ reports a backlog but has no position to move.
type ProgressAdmin interface {
	ResetOffset(ctx context.Context, request model.ResetOffsetRequest) error
}

// MessageReader browses stored messages.
type MessageReader interface {
	QueryMessages(ctx context.Context, params model.MessageQueryParams) ([]*model.MessageItem, error)
	MessageByID(ctx context.Context, topic, messageID string) (*model.MessageItem, error)
}

// MessageTracker reports where a message got to. Only RocketMQ has a trace.
type MessageTracker interface {
	TrackMessage(ctx context.Context, topic, messageID string) ([]*model.MessageTrackItem, error)
}

// DeadLetterReader browses the retry and dead-letter backlogs of a
// subscription.
type DeadLetterReader interface {
	DLQMessages(ctx context.Context, group string, maxResults int) ([]*model.MessageItem, error)
	RetryMessages(ctx context.Context, group string, maxResults int) ([]*model.MessageItem, error)
	ResendMessage(ctx context.Context, consumerGroup, clientID, topic, messageID string) (string, error)
}

// MessagePublisher sends a message.
type MessagePublisher interface {
	SendMessage(ctx context.Context, topic, tags, keys, body string, delayLevel int) (string, error)
}

// ClusterAdmin reports the broker topology.
type ClusterAdmin interface {
	ListNodes(ctx context.Context) ([]*model.Node, error)
	NodeDetail(ctx context.Context, address string) (*model.Node, error)
	ClusterOverview(ctx context.Context) (*model.ClusterOverview, error)
}

// AccessAdmin manages broker access control.
type AccessAdmin interface {
	AccessEnabled(ctx context.Context) (bool, error)
	AccessVersion(ctx context.Context) (*model.AclVersionInfo, error)
	PutAccessConfig(ctx context.Context, config model.AccessConfig) error
	RemoveAccessConfig(ctx context.Context, accessKey string) error
	SetGlobalWhiteAddrs(ctx context.Context, addresses []string) error
}

// RoutingAdmin manages exchanges and bindings. Only RabbitMQ has them, which
// is why the canonical page set has no counterpart and the driver contributes
// a page of its own.
type RoutingAdmin interface {
	ListExchanges(ctx context.Context, namespace string) ([]*model.Destination, error)
	ListBindings(ctx context.Context, namespace string) ([]*model.Binding, error)
}
