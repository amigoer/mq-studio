package bridge

import (
	"context"
	"strconv"
	"time"

	pulsardriver "github.com/amigoer/mq-studio/internal/driver/pulsar"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/pulsar"
)

// PulsarService exposes what only Pulsar has.
//
// It is one service rather than several because it is one family's surface:
// splitting tenants, the send console and schema into three would put three
// names in the bindings for what a reader thinks of as "the Pulsar pages".
//
// Reading topics, subscriptions, namespaces and brokers is not here. Those are
// destinations, subscriptions, namespaces and nodes, and the canonical
// services already answer them; a second read path would be two sources for
// one number.
type PulsarService struct {
	service *pulsar.Service
}

// PulsarTenantView is a tenant as the tenants board draws it.
type PulsarTenantView struct {
	Name            string   `json:"name"`
	AdminRoles      []string `json:"adminRoles"`
	AllowedClusters []string `json:"allowedClusters"`
	// Namespaces is -1 when this credential could not list them, which happens
	// for every tenant but its own on a connection that is not a superuser.
	Namespaces int `json:"namespaces"`
}

// PulsarTenantInput is a tenant as the form collects it.
type PulsarTenantInput struct {
	Name string `json:"name"`
	// AdminRoles are the roles allowed to administer this tenant's namespaces.
	AdminRoles []string `json:"adminRoles"`
	// AllowedClusters bounds where the tenant's namespaces may live. Empty
	// means the cluster this connection is pointed at, which is what an
	// operator who left the field alone meant.
	AllowedClusters []string `json:"allowedClusters"`
}

// Tenants lists every tenant on the cluster.
func (s *PulsarService) Tenants(connID int) ([]*PulsarTenantView, error) {
	tenants, err := s.service.Tenants(context.Background(), connID)
	if err != nil {
		return nil, err
	}
	views := make([]*PulsarTenantView, 0, len(tenants))
	for _, tenant := range tenants {
		views = append(views, &PulsarTenantView{
			Name:            tenant.Name,
			AdminRoles:      tenant.AdminRoles,
			AllowedClusters: tenant.AllowedClusters,
			Namespaces:      tenant.Namespaces,
		})
	}
	return views, nil
}

// SaveTenant creates a tenant or updates the one already there.
func (s *PulsarService) SaveTenant(connID int, input PulsarTenantInput) error {
	return s.service.SaveTenant(context.Background(), connID, pulsardriver.TenantSpec{
		Name:            input.Name,
		AdminRoles:      input.AdminRoles,
		AllowedClusters: input.AllowedClusters,
	})
}

// RemoveTenant deletes one. Pulsar refuses while it still holds namespaces,
// and that refusal reaches the user rather than being forced through.
func (s *PulsarService) RemoveTenant(connID int, name string) error {
	return s.service.RemoveTenant(context.Background(), connID, name)
}

// Clusters is what the tenant form offers for its allowed-cluster list.
func (s *PulsarService) Clusters(connID int) ([]string, error) {
	return s.service.Clusters(context.Background(), connID)
}

// Namespaces returns every namespace under the profile's tenant, with the
// limits that are actually set on it.
func (s *PulsarService) Namespaces(connID int) ([]*model.Namespace, error) {
	return s.service.Namespaces(context.Background(), connID)
}

// PulsarNamespaceInput creates a namespace.
//
// Only a name, because that is all Pulsar takes: a namespace is created empty
// and its policies are set afterwards, one call each. A form that collected
// them here would have to either apply them in a second round the user cannot
// see fail, or pretend the create carried them.
type PulsarNamespaceInput struct {
	// Name may be bare or already tenant-qualified. A bare one is created
	// under the tenant this connection is scoped to.
	Name string `json:"name"`
}

// CreateNamespace adds one under the profile's tenant.
func (s *PulsarService) CreateNamespace(connID int, input PulsarNamespaceInput) error {
	return s.service.CreateNamespace(context.Background(), connID, model.NamespaceSpec{
		Name: input.Name,
	})
}

// DeleteNamespace removes one. Pulsar refuses while it still holds topics, and
// that refusal reaches the user rather than being forced through.
func (s *PulsarService) DeleteNamespace(connID int, name string) error {
	return s.service.DeleteNamespace(context.Background(), connID, name)
}

// SetNamespaceLimit caps a namespace as a whole.
func (s *PulsarService) SetNamespaceLimit(connID int, name, limit string, value int) error {
	return s.service.SetNamespaceLimit(context.Background(), connID, name, limit, value)
}

// RemoveNamespaceLimit hands a limit back to the broker's own default. Not the
// same as setting zero: zero producers is a namespace nothing can publish to.
func (s *PulsarService) RemoveNamespaceLimit(connID int, name, limit string) error {
	return s.service.RemoveNamespaceLimit(context.Background(), connID, name, limit)
}

// PulsarTopicInput is a topic declaration as the Pulsar form collects it.
//
// Deliberately not TopicService.Create's shape. That one takes a broker
// address, a read queue count, a write queue count and a permission string,
// which is RocketMQ's vocabulary: a Pulsar topic has none of those. It has a
// namespace, a name, a partition count and a storage kind.
type PulsarTopicInput struct {
	// Namespace is "tenant/namespace". Blank means the one this connection is
	// scoped to, which is what the form's cascade starts on.
	Namespace string `json:"namespace"`
	Name      string `json:"name"`

	// Partitions of 0 is a non-partitioned topic, which is a different object
	// from one with a single partition - the second is addressed as
	// name-partition-0 and can grow, the first can never be partitioned.
	Partitions int `json:"partitions"`

	// Persistent chooses the storage. A non-persistent topic keeps nothing on
	// disk: a message nobody is connected to receive is dropped.
	Persistent bool `json:"persistent"`
}

func (input PulsarTopicInput) spec() model.DestinationSpec {
	return model.DestinationSpec{
		Ref:        model.DestinationRef{Namespace: input.Namespace, Name: input.Name},
		Partitions: input.Partitions,
		Attributes: map[string]string{
			pulsardriver.AttrTopicPersistent: strconv.FormatBool(input.Persistent),
		},
	}
}

// CreateTopic declares a topic.
func (s *PulsarService) CreateTopic(connID int, input PulsarTopicInput) error {
	return s.service.CreateTopic(context.Background(), connID, input.spec())
}

// RaisePartitions adds partitions to a partitioned topic. Pulsar cannot remove
// them, and cannot partition a topic that was created without partitions.
func (s *PulsarService) RaisePartitions(connID int, input PulsarTopicInput) error {
	return s.service.RaisePartitions(context.Background(), connID, input.spec())
}

// Topics returns every topic in one namespace.
//
// Namespace-scoped, which TopicService is not: a Pulsar topic is addressed as
// tenant/namespace/name, and the canonical service's Detail builds a ref with
// no namespace in it at all.
func (s *PulsarService) Topics(
	connID int, namespace string, includeInternal bool,
) ([]*model.Destination, error) {
	return s.service.Topics(context.Background(), connID, namespace, includeInternal)
}

// TopicDetail is one topic in one namespace.
func (s *PulsarService) TopicDetail(
	connID int, namespace, name string,
) (*model.Destination, error) {
	return s.service.TopicDetail(context.Background(), connID, namespace, name)
}

// TopicStats is the per-partition breakdown the detail panel draws.
func (s *PulsarService) TopicStats(
	connID int, namespace, name string,
) (map[string]interface{}, error) {
	return s.service.TopicStats(context.Background(), connID, namespace, name)
}

// DeleteTopic removes one. Pulsar refuses while a producer or consumer is
// still attached, and that refusal reaches the user.
func (s *PulsarService) DeleteTopic(connID int, namespace, name string) error {
	return s.service.DeleteTopic(context.Background(), connID, namespace, name)
}

// SubscriptionStats is one subscription's figures.
//
// Topic-scoped, which ConsumerService.Stats is not: it builds a ref with an
// empty namespace, and a Pulsar subscription has no identity without the topic
// it belongs to.
func (s *PulsarService) SubscriptionStats(
	connID int, topic, subscription string,
) (map[string]interface{}, error) {
	return s.service.SubscriptionStats(context.Background(), connID, topic, subscription)
}

// SubscriptionClients is who is attached, as the broker reports them. No round
// trip to any consumer: Pulsar carries their permits and rates in the topic's
// own stats.
func (s *PulsarService) SubscriptionClients(
	connID int, topic, subscription string,
) ([]*model.SubscriptionClient, error) {
	return s.service.SubscriptionClients(context.Background(), connID, topic, subscription)
}

// CreateSubscription adds one to a topic.
//
// startAt is "earliest" or "latest". Earliest is the default because a
// subscription created at the latest position silently discards whatever is
// already on the topic, which is the opposite of why one is created ahead of
// the consumer that will use it.
func (s *PulsarService) CreateSubscription(
	connID int, topic, subscription, startAt string,
) error {
	return s.service.CreateSubscription(context.Background(), connID, topic, subscription, startAt)
}

// DeleteSubscription removes one. Pulsar refuses while a consumer is attached,
// and that refusal reaches the user.
func (s *PulsarService) DeleteSubscription(connID int, topic, subscription string) error {
	return s.service.DeleteSubscription(context.Background(), connID, topic, subscription)
}

// DeadLetterQueues finds the topics dead letters land in, and the subscription
// each of them came from.
//
// A Pulsar dead-letter topic is a naming convention in the client libraries,
// not a broker object, so this walks the namespace for names that follow it.
// One whose origin topic is gone is reported without a source rather than
// dropped: it holds a backlog nothing will drain, which is the row most worth
// seeing.
func (s *PulsarService) DeadLetterQueues(
	connID int, namespace string,
) ([]*model.DeadLetterQueue, error) {
	return s.service.DeadLetterQueues(context.Background(), connID, namespace)
}

// PulsarPublishInput is a send as the Pulsar console collects it.
//
// Deliberately not model.PublishRequest, which is AMQP: an exchange, a routing
// key and a mandatory flag, none of which this family has. What Pulsar does
// have - an ordering key, an event time, a delivery delay and arbitrary
// properties - has no field there.
type PulsarPublishInput struct {
	// Topic is a full URL, which is how a Pulsar topic is addressed.
	Topic string `json:"topic"`
	// Key is what the broker partitions and compacts by.
	Key string `json:"key"`
	// OrderingKey orders delivery independently of the key, which is how a
	// Key_Shared subscription keeps related messages on one consumer without
	// forcing them onto one partition.
	OrderingKey string            `json:"orderingKey"`
	Properties  map[string]string `json:"properties"`
	Body        string            `json:"body"`
	// DeliverAfterMs holds the message back. Milliseconds because that is what
	// crosses a JSON bridge without a unit anybody has to remember; the driver
	// takes a duration.
	DeliverAfterMs int64 `json:"deliverAfterMs"`
	// EventTimeMs is when the producer says the event happened, as opposed to
	// when the broker stores it. Zero leaves it unset rather than stamping
	// 1970.
	EventTimeMs int64 `json:"eventTimeMs"`
	// Count sends the same message more than once, which makes a repeat
	// deliberate rather than a button pressed several times.
	Count int `json:"count"`
}

// PulsarPublishResult is what the broker acknowledged.
type PulsarPublishResult struct {
	// MessageIDs are in send order, in Pulsar's printed form, so each can be
	// pasted straight into the browse box.
	MessageIDs []string `json:"messageIds"`
}

// Publish sends one or more messages.
func (s *PulsarService) Publish(connID int, input PulsarPublishInput) (*PulsarPublishResult, error) {
	request := pulsardriver.PublishRequest{
		Topic:        input.Topic,
		Key:          input.Key,
		OrderingKey:  input.OrderingKey,
		Properties:   input.Properties,
		Body:         input.Body,
		DeliverAfter: time.Duration(input.DeliverAfterMs) * time.Millisecond,
		Count:        input.Count,
	}
	if input.EventTimeMs > 0 {
		request.EventTime = time.UnixMilli(input.EventTimeMs)
	}

	result, err := s.service.Publish(context.Background(), connID, request)
	if err != nil {
		return nil, err
	}
	return &PulsarPublishResult{MessageIDs: result.MessageIDs}, nil
}

// Producers is who is currently publishing to a topic. Pulsar reports them per
// topic rather than per producer group, which is the better question of the
// two and the only one it can answer.
func (s *PulsarService) Producers(connID int, topic string) ([]*model.ProducerClient, error) {
	return s.service.Producers(context.Background(), connID, topic)
}

// NamespacePermissions is every role granted access to a namespace.
//
// Roles rather than users: Pulsar authorises the subject of a token and keeps
// no directory of them, so a grant may name a role that does not exist yet and
// will be honoured when a token carrying it turns up.
func (s *PulsarService) NamespacePermissions(
	connID int, namespace string,
) ([]*model.NamespacePermission, error) {
	return s.service.NamespacePermissions(context.Background(), connID, namespace)
}

// TopicPermissions is every per-topic grant in the connection's namespace.
func (s *PulsarService) TopicPermissions(connID int) ([]*model.TopicPermission, error) {
	return s.service.TopicPermissions(context.Background(), connID)
}

// PulsarGrantInput is a grant as the Tokens board collects it.
//
// Configure is namespace-only: functions, sinks and packages are deployed into
// a namespace and not into a topic, so a topic grant is produce and consume.
type PulsarGrantInput struct {
	// Namespace is "tenant/namespace". Blank means the connection's own.
	Namespace string `json:"namespace"`
	// Topic narrows the grant to one topic. Blank grants the namespace.
	Topic string `json:"topic"`
	Role  string `json:"role"`

	Configure bool `json:"configure"`
	Write     bool `json:"write"`
	Read      bool `json:"read"`
}

func allow(granted bool) string {
	if granted {
		return "allow"
	}
	return ""
}

// Grant gives a role access to a namespace, or to one topic within it.
func (s *PulsarService) Grant(connID int, input PulsarGrantInput) error {
	if input.Topic != "" {
		return s.service.GrantTopic(context.Background(), connID, model.TopicPermission{
			Namespace: input.Namespace,
			Identity:  input.Role,
			Exchange:  input.Topic,
			Write:     allow(input.Write),
			Read:      allow(input.Read),
		})
	}
	return s.service.GrantNamespace(context.Background(), connID, model.NamespacePermission{
		Namespace: input.Namespace,
		Identity:  input.Role,
		Configure: allow(input.Configure),
		Write:     allow(input.Write),
		Read:      allow(input.Read),
	})
}

// RevokeNamespace takes a role's access to a whole namespace away.
func (s *PulsarService) RevokeNamespace(connID int, namespace, role string) error {
	return s.service.RevokeNamespace(context.Background(), connID, namespace, role)
}

// RevokeTopic takes a role's access to one topic away. Narrower than the
// namespace revoke and a different endpoint, so the two are separate calls
// rather than one with a scope argument.
func (s *PulsarService) RevokeTopic(connID int, topic, role string) error {
	return s.service.RevokeTopic(context.Background(), connID, topic, role)
}
