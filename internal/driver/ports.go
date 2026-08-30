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
	UpdateSubscription(ctx context.Context, spec model.SubscriptionSpec) error
	RemoveSubscription(ctx context.Context, ref model.SubscriptionRef) error
}

// SubscriptionStats reports per-partition consume progress.
type SubscriptionStats interface {
	SubscriptionStats(ctx context.Context, ref model.SubscriptionRef) (map[string]interface{}, error)
}

// SubscriptionRuntime asks a connected consumer what it is doing.
//
// It is separate from SubscriptionStats because the two ask different things
// of different places: stats are the broker's view of a group's progress,
// this is one client's view of its own work, and only a live client can
// answer it. A group with nothing connected has no answer rather than an
// empty one, which is why it returns an error the UI can distinguish.
type SubscriptionRuntime interface {
	SubscriptionClients(ctx context.Context, ref model.SubscriptionRef) ([]*model.SubscriptionClient, error)
}

// ProgressAdmin moves a subscription's read position.
//
// It is separate from SubscriptionAdmin because backlog and position are
// different things: RabbitMQ reports a backlog but has no position to move.
type ProgressAdmin interface {
	ResetOffset(ctx context.Context, request model.ResetOffsetRequest) error
}

// OffsetCloner copies one subscription's read position onto another.
//
// Separate from ProgressAdmin because it is a different operation with a
// different blast radius: a reset moves one group in time, this writes a
// second group's positions from a first one's.
type OffsetCloner interface {
	CloneOffset(ctx context.Context, request model.CloneOffsetRequest) error
}

// MessageReader browses stored messages.
type MessageReader interface {
	QueryMessages(ctx context.Context, params model.MessageQueryParams) ([]*model.MessageItem, error)
	MessageByID(ctx context.Context, topic, messageID string) (*model.MessageItem, error)
}

// MessageTailer follows a destination's newest messages.
//
// Nothing here streams, and that is the family's doing rather than a shortcut:
// no broker this app speaks to pushes admin data, so a tail is a poll however
// it is dressed. What a driver contributes is making that poll incremental -
// the caller hands back the cursor it was given and receives only what has
// arrived since, instead of re-reading the end of the log every time and
// working out the difference for itself.
//
// The caller owns the loop, because the caller owns the lifetime. A goroutine
// started in Go would outlive the panel that asked for it whenever the
// renderer forgot to say stop, and a tail that keeps pulling after its page is
// gone is the one failure mode worth designing out.
type MessageTailer interface {
	TailMessages(ctx context.Context, ref model.DestinationRef, cursor model.TailCursor, limit int) (*model.TailBatch, error)
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

// MessageReplayer hands one message back to one connected consumer.
//
// Separate from DeadLetterReader's ResendMessage, which puts a copy on the
// retry path for whichever member picks it up. This runs the listener of a
// named client and reports what it returned, which is the difference between
// "try again" and "show me why this one fails".
type MessageReplayer interface {
	ReplayMessage(ctx context.Context, request model.ReplayRequest) (*model.ReplayResult, error)
}

// MessagePublisher sends a message.
type MessagePublisher interface {
	SendMessage(ctx context.Context, topic, tags, keys, body string, delayLevel int) (string, error)
}

// ProducerInspector reports who is currently publishing to a destination.
//
// It takes a producer group because that is what a broker indexes connections
// by, and there is no call that enumerates the groups - so this answers "is
// anything from this service still connected", not "who is writing here".
type ProducerInspector interface {
	ProducerClients(ctx context.Context, group, destination string) ([]*model.ProducerClient, error)
}

// ClusterAdmin reports the broker topology.
type ClusterAdmin interface {
	ListNodes(ctx context.Context) ([]*model.Node, error)
	NodeDetail(ctx context.Context, address string) (*model.Node, error)
	ClusterOverview(ctx context.Context) (*model.ClusterOverview, error)
}

// DirectoryAdmin lists the discovery tier a cluster is reached through -
// RocketMQ name servers, Kafka controllers.
//
// Separate from ClusterAdmin because not every family has one: RabbitMQ nodes
// find each other, and a driver with no tier of its own does not implement
// this rather than listing its brokers a second time.
type DirectoryAdmin interface {
	ListDirectoryNodes(ctx context.Context) ([]*model.Node, error)
}

// ConfigInspector reads the effective settings of the things a cluster is made
// of - what they are actually running with, which is not always what their
// config files say.
//
// Separate from ClusterAdmin because it answers a different question at a
// different cost: the topology is one request for the whole cluster, these are
// one request each and return a few hundred keys.
//
// The results are flat maps because that is what they are - settings
// documents, not a shape any driver should pretend to normalise. What the keys
// mean differs per family and the page renders them as given.
type ConfigInspector interface {
	NodeConfig(ctx context.Context, address string) (map[string]string, error)

	// DirectoryConfig is the settings of whatever the family uses for
	// discovery - a RocketMQ name server, a Kafka controller. Families with no
	// separate discovery tier return an empty map rather than an error.
	DirectoryConfig(ctx context.Context) (map[string]string, error)
}

// NodeMaintenance runs a node's housekeeping on demand.
//
// Scoped to one node rather than a cluster: these reclaim disk, and an
// operator dealing with one broker that is full should not have to run it
// everywhere to fix that one.
type NodeMaintenance interface {
	RunMaintenance(ctx context.Context, address string, task model.MaintenanceTask) error
}

// AccessAdmin manages credential-based access control: an entry carries the
// key, the secret and the permissions together.
//
// It is write-only for RocketMQ, and that is the broker's doing rather than a
// gap here - the 4.x admin protocol has no call that reads plain_acl.yml back.
// A UI on top of it can only edit blind, which is why AccessDirectory exists.
type AccessAdmin interface {
	AccessEnabled(ctx context.Context) (bool, error)
	AccessVersion(ctx context.Context) (*model.AclVersionInfo, error)
	PutAccessConfig(ctx context.Context, config model.AccessConfig) error
	RemoveAccessConfig(ctx context.Context, accessKey string) error
	SetGlobalWhiteAddrs(ctx context.Context, addresses []string) error
}

// AccessDirectory manages identity-based access control: principals the broker
// authenticates, and rules attached to a subject.
//
// Separate from AccessAdmin because they are two systems on the same broker
// rather than two views of one. RocketMQ 4.x plain_acl is a file of
// AccessKey entries that can be written and never read; 5.3's auth is a store
// that answers, which is what lets a page show what is actually in force.
// Kafka's ACLs have the same shape.
type AccessDirectory interface {
	// DirectoryEnabled reports whether the broker runs this at all. A broker
	// with it switched off answers false rather than failing, so a page can
	// say which system is on instead of showing an error.
	DirectoryEnabled(ctx context.Context) (bool, error)

	ListPrincipals(ctx context.Context) ([]*model.AccessPrincipal, error)
	PutPrincipal(ctx context.Context, spec model.AccessPrincipalSpec) error
	RemovePrincipal(ctx context.Context, name string) error

	ListAccessRules(ctx context.Context) ([]*model.AccessRule, error)
	PutAccessRule(ctx context.Context, rule model.AccessRule) error
	RemoveAccessRule(ctx context.Context, subject string) error
}

// RoutingAdmin manages exchanges and bindings. Only RabbitMQ has them, which
// is why the canonical page set has no counterpart and the driver contributes
// a page of its own.
type RoutingAdmin interface {
	ListExchanges(ctx context.Context, namespace string) ([]*model.Destination, error)
	ListBindings(ctx context.Context, namespace string) ([]*model.Binding, error)
}
