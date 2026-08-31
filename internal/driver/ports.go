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

// QueueGuardedRemover deletes a destination only if the broker agrees it is
// unused or empty.
//
// It rides on the same capability as the plain delete rather than declaring
// one of its own: a family either can delete a destination or cannot, and
// whether it will also check a precondition first is a detail of how, not a
// separate thing a page decides to offer.
type QueueGuardedRemover interface {
	RemoveQueueGuarded(ctx context.Context, ref model.DestinationRef, ifUnused, ifEmpty bool) error
}

// QueueActions are the operations that change what a destination holds,
// without changing what it is.
//
// Separate from DestinationAdmin because that is about a destination's
// existence and configuration, and these are about its contents and placement.
// A family may well be able to create and delete a queue and have no way to
// empty one.
type QueueActions interface {
	PurgeQueue(ctx context.Context, ref model.DestinationRef) error
	// MoveMessages returns how many it moved, which is meaningful even on an
	// error: the count is what already reached the target.
	MoveMessages(ctx context.Context, request model.MoveRequest) (int, error)
	// DropMessages discards a bounded batch from the head, which a purge
	// cannot do: a purge empties the whole queue in one call.
	DropMessages(ctx context.Context, ref model.DestinationRef, limit int) (int, error)
	RebalanceQueues(ctx context.Context) error
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

// QueueProgressAdmin writes one queue's read position directly.
//
// Separate from ProgressAdmin because the two are different gestures with
// different blast radii: a reset names a moment and moves a whole
// subscription, this writes a number to one queue. A family whose position is
// per subscription rather than per partition has nothing to implement here.
type QueueProgressAdmin interface {
	SetQueueOffset(ctx context.Context, request model.QueueOffsetRequest) error
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

// DeadLetterTopology finds dead-letter queues by following the topology.
//
// Separate from DeadLetterReader because the two families disagree about what
// a dead-letter queue is. RocketMQ gives every consumer group one, named after
// it, so a group name is enough to find it and the messages come back through
// the same read path as any other. RabbitMQ has no such object: a queue is
// declared with a dead-letter exchange, that exchange routes like any other,
// and whatever it lands in becomes a dead-letter queue by convention. Finding
// one means walking backwards from every queue that declares one; reading it
// afterwards is an ordinary browse.
type DeadLetterTopology interface {
	DeadLetterQueues(ctx context.Context, namespace string) ([]*model.DeadLetterQueue, error)
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

// RichPublisher sends a message with everything the family's own protocol
// carries, and reports what the broker did with it.
//
// Separate from MessagePublisher because that signature is RocketMQ's - a
// topic, tags, keys and a delay level - and none of it but the body maps onto
// AMQP. It also answers a different question: whether the broker kept the
// message and whether anything was bound to receive it, which are two facts
// and not one.
type RichPublisher interface {
	Publish(ctx context.Context, request model.PublishRequest) (*model.PublishResult, error)
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

// WritePermissionAdmin takes a node out of the write path and puts it back.
//
// This is how a broker is drained before it is stopped: producers stop being
// routed to it while consumers keep draining what it already holds, so no
// message is stranded on a node that is about to go away.
//
// Separate from NodeMaintenance because it is the opposite kind of operation -
// maintenance reclaims space on a node that stays in service, this changes
// whether the node is in service at all - and because it is answered by the
// discovery tier rather than by the node itself.
type WritePermissionAdmin interface {
	// SetNodeWritable returns how many destinations the change touched. The
	// count is best effort: the permission change lands either way, and a
	// broker that reports no count is not a broker that refused.
	SetNodeWritable(ctx context.Context, name string, writable bool) (int, error)
}

// NamespaceAdmin manages the namespaces a broker's objects live in.
//
// Only a family whose namespaces are real objects implements it. RocketMQ and
// Kafka have no counterpart: a topic name may look namespaced by convention,
// but there is nothing to create, nothing to delete and nothing that isolates
// one prefix from another.
type NamespaceAdmin interface {
	ListNamespaces(ctx context.Context) ([]*model.Namespace, error)
	// CreateNamespace also updates: the broker spells both as one idempotent
	// call, and unlike a queue a namespace's settings can genuinely change.
	CreateNamespace(ctx context.Context, spec model.NamespaceSpec) error
	RemoveNamespace(ctx context.Context, name string) error
}

// NamespaceLimits caps a namespace as a whole.
//
// Separate from NamespaceAdmin because it is a different endpoint and a
// different permission, and because a limit's absence means something a value
// cannot express: no cap at all, as opposed to a cap of zero.
type NamespaceLimits interface {
	SetNamespaceLimit(ctx context.Context, name, limit string, value int) error
	RemoveNamespaceLimit(ctx context.Context, name, limit string) error
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

// ClientCloser disconnects a client from the broker.
//
// Only whole connections. Some families - RabbitMQ among them - multiplex
// sessions inside one connection and offer no way to close a single session,
// so a port that promised it would have to close more than it named.
type ClientCloser interface {
	CloseClientConnection(ctx context.Context, name, reason string) error
	// CloseUserConnections closes every connection one identity holds, which
	// is how an application with several instances is actually evicted.
	CloseUserConnections(ctx context.Context, username, reason string) error
}

// IdentityAdmin manages the principals a broker authenticates.
//
// A third access model beside AccessAdmin and AccessDirectory, and it is one
// rather than a variation on them because RabbitMQ splits the question in two:
// a user's tags decide what the management API lets it do, and its
// per-namespace permissions decide what its connections may touch. A user with
// every tag and no permission can read every page and open no queue. Merging
// those would lose which of the two is refusing an operation.
type IdentityAdmin interface {
	ListIdentities(ctx context.Context) ([]*model.Identity, error)
	// SaveIdentity creates or updates. An empty password keeps whatever is
	// stored, which the driver has to arrange for: the broker's own endpoint
	// replaces the whole user, so leaving the field out removes it.
	SaveIdentity(ctx context.Context, spec model.IdentitySpec) error
	RemoveIdentity(ctx context.Context, name string) error
}

// IdentityPermissions manages what an identity may touch inside a namespace.
//
// Separate from IdentityAdmin because they are separate endpoints and separate
// permissions on the broker, and because revoking is not the same as granting
// nothing: with no permission record the broker refuses the connection
// outright, where empty patterns let it connect and do nothing.
type IdentityPermissions interface {
	SetPermission(ctx context.Context, permission model.NamespacePermission) error
	RemovePermission(ctx context.Context, namespace, identity string) error

	ListTopicPermissions(ctx context.Context) ([]*model.TopicPermission, error)
	SetTopicPermission(ctx context.Context, permission model.TopicPermission) error
	RemoveTopicPermission(ctx context.Context, namespace, identity string) error
}

// PolicyAdmin manages settings applied to destinations by pattern.
//
// It exists for a family whose destinations are immutable once declared: a
// RabbitMQ queue's arguments are fixed, so a policy matching it is the only
// way to change a live queue's TTL, length limit or dead-letter exchange. A
// family that can simply update a destination has no need of one.
type PolicyAdmin interface {
	ListPolicies(ctx context.Context) ([]*model.Policy, error)
	// MatchingPolicies asks the broker which policies actually apply to one
	// destination, which is not something a caller can work out reliably by
	// matching patterns itself - only the highest-priority match applies, and
	// policies do not merge.
	MatchingPolicies(ctx context.Context, ref model.DestinationRef, kind string) ([]*model.Policy, error)
	SavePolicy(ctx context.Context, policy model.Policy) error
	RemovePolicy(ctx context.Context, namespace, name string, operator bool) error
}

// ParameterAdmin reads the component configuration a broker stores for its
// plugins.
//
// Read and delete only. A parameter's shape belongs to whichever plugin owns
// the component, so a generic setter would be a way to write configuration
// nothing validates; components this app understands get typed surfaces of
// their own.
type ParameterAdmin interface {
	ListRuntimeParameters(ctx context.Context) ([]*model.RuntimeParameter, error)
	RemoveRuntimeParameter(ctx context.Context, component, namespace, name string) error
}

// DefinitionsAdmin exports and imports a broker's whole topology.
//
// Everything except the messages, in one document. Importing is additive
// rather than a replace - anything named in the document is created or
// overwritten and anything the document omits is left alone - so it cannot
// make a cluster match a file, only put the file's contents into it. The page
// says so; the driver does what it is told.
type DefinitionsAdmin interface {
	ExportDefinitions(ctx context.Context, namespace string) (*model.Definitions, error)
	ImportDefinitions(ctx context.Context, namespace, document string) error
}

// StreamInspector reads who is attached to a stream over a protocol of its
// own.
//
// Separate from SubscriptionLister because those clients are not subscribers
// in the family's main protocol and do not appear among them: a stream read by
// three applications can report zero consumers everywhere else.
type StreamInspector interface {
	StreamClients(ctx context.Context, ref model.DestinationRef) (*model.StreamClients, error)
}

// ReplicationAdmin reads the links that move messages between brokers.
//
// Read and delete rather than create. A shovel or an upstream is defined by a
// URI carrying another broker's credentials, and a form that collected one
// would be storing a password in a place this app cannot verify - the pages
// show what exists, say what it is doing, and let it be removed.
type ReplicationAdmin interface {
	ListShovels(ctx context.Context) ([]*model.Shovel, error)
	RemoveShovel(ctx context.Context, namespace, name string) error
	ListFederationUpstreams(ctx context.Context) ([]*model.FederationUpstream, error)
	RemoveFederationUpstream(ctx context.Context, namespace, name string) error
}

// RoutingMutator creates and deletes exchanges and bindings.
//
// Separate from RoutingAdmin because reading a topology and changing it are
// different permissions on the broker: a monitoring user can list every
// exchange in a virtual host and configure none of them.
type RoutingMutator interface {
	DeclareExchange(ctx context.Context, spec model.ExchangeSpec) error
	RemoveExchange(ctx context.Context, namespace, name string) error
	DeclareBinding(ctx context.Context, binding model.Binding) error
	RemoveBinding(ctx context.Context, binding model.Binding) error
}

// CensusReporter answers for the whole broker in one call.
//
// Separate from ClusterAdmin because it is a different question at a different
// cost. The topology is which nodes exist; this is what they are collectively
// holding and how fast it is moving, and a family that cannot answer it in one
// request should not pretend to - assembling it by walking every destination
// would be a page that takes a minute and a figure that was never true at any
// single moment.
type CensusReporter interface {
	Census(ctx context.Context) (*model.BrokerCensus, error)
}

// ClientInspector lists the transport connections and channels open against
// the broker.
//
// Separate from ProducerInspector and SubscriptionRuntime because it answers a
// different question. Those are about roles - who is publishing to this
// destination, what is this consumer group doing. This is the layer beneath:
// which hosts are holding sockets open, which of them are being throttled, and
// which one to close when an application will not let go.
type ClientInspector interface {
	ListClientConnections(ctx context.Context, namespace string) ([]*model.ClientConnection, error)
	ListClientChannels(ctx context.Context, namespace string) ([]*model.ClientChannel, error)
}

// HealthInspector runs the broker's own health checks.
//
// Separate from ClusterAdmin because it is the broker's opinion rather than
// its topology: these are questions it answers about itself, and the answers
// name what to do. A family whose health can only be inferred from metrics
// does not implement it, and its cluster page falls back to the numbers.
type HealthInspector interface {
	Health(ctx context.Context) (*model.BrokerHealth, error)
}

// RoutingAdmin manages exchanges and bindings. Only RabbitMQ has them, which
// is why the canonical page set has no counterpart and the driver contributes
// a page of its own.
type RoutingAdmin interface {
	ListExchanges(ctx context.Context, namespace string) ([]*model.Destination, error)
	ListBindings(ctx context.Context, namespace string) ([]*model.Binding, error)
}
