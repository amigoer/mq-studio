// Package pulsar orchestrates the operations only Pulsar has.
//
// It exists beside the canonical services rather than inside them because the
// canonical ones cannot express the questions. Tenants are the clearest case:
// a tenant holds namespaces and carries the roles allowed to administer them
// and the clusters they may live in, and no canonical port describes anything
// of the sort - NamespaceAdmin starts one level below.
//
// The canonical services still serve Pulsar everything they can express -
// topics are destinations, subscriptions are subscriptions, brokers are nodes,
// namespaces are namespaces - so nothing here duplicates a read that already
// has a home.
package pulsar

import (
	"context"
	"fmt"
	"time"

	"github.com/amigoer/mq-studio/internal/driver"
	pulsardriver "github.com/amigoer/mq-studio/internal/driver/pulsar"
	"github.com/amigoer/mq-studio/internal/model"
)

// Settings exposes only what these operations need.
type Settings interface {
	GetRequestTimeout() time.Duration
}

// ConnSource yields the connection a request runs against.
type ConnSource func(connID int) (driver.Conn, error)

// Service is the orchestration layer between the bridge and the driver.
type Service struct {
	conns    ConnSource
	settings Settings
}

// New creates the service.
func New(conns ConnSource, settings Settings) *Service {
	return &Service{conns: conns, settings: settings}
}

func (s *Service) withTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, s.settings.GetRequestTimeout())
}

// pulsarConn resolves the connection and asserts it is this family's.
//
// There is no capability to gate on: tenants have no canonical port and
// therefore no Capability that could describe them, so the gate is the driver
// itself. A profile of another family reaching these methods is a bug in the
// renderer rather than an unsupported operation, and the error says so.
func (s *Service) pulsarConn(connID int) (*pulsardriver.Conn, error) {
	conn, err := s.conns(connID)
	if err != nil {
		return nil, err
	}
	api, ok := conn.(*pulsardriver.Conn)
	if !ok {
		return nil, fmt.Errorf("connection %d is %s, not pulsar", connID, conn.Kind())
	}
	return api, nil
}

// Tenants is every tenant on the cluster.
func (s *Service) Tenants(ctx context.Context, connID int) ([]*pulsardriver.Tenant, error) {
	conn, err := s.pulsarConn(connID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return conn.Tenants(ctx)
}

// SaveTenant creates a tenant or updates the one already there.
func (s *Service) SaveTenant(ctx context.Context, connID int, spec pulsardriver.TenantSpec) error {
	conn, err := s.pulsarConn(connID)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return conn.SaveTenant(ctx, spec)
}

// RemoveTenant deletes one, if it holds no namespaces.
func (s *Service) RemoveTenant(ctx context.Context, connID int, name string) error {
	conn, err := s.pulsarConn(connID)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return conn.RemoveTenant(ctx, name)
}

// Clusters is what a tenant's allowed-cluster list can be drawn from.
//
// It goes through the canonical cluster port rather than the driver, because
// listing a cluster's name is exactly what ClusterOverview already answers -
// this only saves the tenant form from asking for the whole overview.
func (s *Service) Clusters(ctx context.Context, connID int) ([]string, error) {
	conn, err := s.conns(connID)
	if err != nil {
		return nil, err
	}
	api, ok := conn.(driver.ClusterAdmin)
	if !ok {
		return nil, driver.Unsupported(conn, model.CapClusterTopology)
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	overview, err := api.ClusterOverview(ctx)
	if err != nil {
		return nil, err
	}
	return []string{overview.Name}, nil
}

// port resolves the connection and asserts it implements what the caller
// needs, checking the declared capability first.
//
// The capability check comes before the type assertion for the same reason it
// does in every other service: a driver should not have to refuse an operation
// the interface was never meant to offer, and the reason a page gets back
// should name the capability rather than the Go type.
func port[T any](s *Service, connID int, capability model.Capability) (T, error) {
	var zero T
	conn, err := s.conns(connID)
	if err != nil {
		return zero, err
	}
	if !conn.Capabilities().Has(capability) {
		return zero, driver.Unsupported(conn, capability)
	}
	api, ok := conn.(T)
	if !ok {
		return zero, driver.Unsupported(conn, capability)
	}
	return api, nil
}

// Namespaces is every namespace under the profile's tenant, with its limits.
func (s *Service) Namespaces(ctx context.Context, connID int) ([]*model.Namespace, error) {
	api, err := port[driver.NamespaceAdmin](s, connID, model.CapNamespaceList)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.ListNamespaces(ctx)
}

// CreateNamespace adds one under the profile's tenant.
func (s *Service) CreateNamespace(ctx context.Context, connID int, spec model.NamespaceSpec) error {
	api, err := port[driver.NamespaceAdmin](s, connID, model.CapNamespaceAdmin)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.CreateNamespace(ctx, spec)
}

// DeleteNamespace removes one. Pulsar refuses while it still holds topics.
func (s *Service) DeleteNamespace(ctx context.Context, connID int, name string) error {
	api, err := port[driver.NamespaceAdmin](s, connID, model.CapNamespaceAdmin)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RemoveNamespace(ctx, name)
}

// SetNamespaceLimit caps a namespace as a whole.
func (s *Service) SetNamespaceLimit(
	ctx context.Context, connID int, name, limit string, value int,
) error {
	api, err := port[driver.NamespaceLimits](s, connID, model.CapNamespaceLimits)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.SetNamespaceLimit(ctx, name, limit, value)
}

// RemoveNamespaceLimit puts a limit back to the broker's own default, which is
// not the same as setting it to zero.
func (s *Service) RemoveNamespaceLimit(
	ctx context.Context, connID int, name, limit string,
) error {
	api, err := port[driver.NamespaceLimits](s, connID, model.CapNamespaceLimits)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RemoveNamespaceLimit(ctx, name, limit)
}

// CreateTopic declares a topic.
//
// Partitions is the decision that cannot be taken back: Pulsar can raise the
// count but never lower it, and a non-partitioned topic can never become
// partitioned.
func (s *Service) CreateTopic(ctx context.Context, connID int, spec model.DestinationSpec) error {
	api, err := port[driver.DestinationAdmin](s, connID, model.CapDestinationCreate)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.CreateDestination(ctx, spec)
}

// RaisePartitions is the only edit Pulsar offers on a topic.
func (s *Service) RaisePartitions(
	ctx context.Context, connID int, spec model.DestinationSpec,
) error {
	api, err := port[driver.DestinationAdmin](s, connID, model.CapDestinationUpdate)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.UpdateDestination(ctx, spec)
}

// Topics is every topic in one namespace.
//
// Namespace-scoped, which the canonical destination service is not: its List
// takes a connection and a filter whose namespace no other family fills in,
// and its Detail builds a ref with no namespace at all. A Pulsar topic is
// addressed as tenant/namespace/name, so a read that lost the namespace would
// address a different topic - or none.
func (s *Service) Topics(
	ctx context.Context, connID int, namespace string, includeInternal bool,
) ([]*model.Destination, error) {
	api, err := port[driver.DestinationAdmin](s, connID, model.CapDestinationList)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.ListDestinations(ctx, model.DestinationFilter{
		Namespace:       namespace,
		IncludeInternal: includeInternal,
	})
}

// TopicDetail is one topic in one namespace.
func (s *Service) TopicDetail(
	ctx context.Context, connID int, namespace, name string,
) (*model.Destination, error) {
	api, err := port[driver.DestinationAdmin](s, connID, model.CapDestinationList)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.DestinationDetail(ctx, model.DestinationRef{Namespace: namespace, Name: name})
}

// TopicStats is the per-partition breakdown the detail panel draws.
func (s *Service) TopicStats(
	ctx context.Context, connID int, namespace, name string,
) (map[string]interface{}, error) {
	api, err := port[driver.DestinationStats](s, connID, model.CapPartitions)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.DestinationStats(ctx, model.DestinationRef{Namespace: namespace, Name: name})
}

// DeleteTopic removes one. Pulsar refuses while a producer or consumer is
// still attached, and that refusal is passed through rather than forced.
func (s *Service) DeleteTopic(ctx context.Context, connID int, namespace, name string) error {
	api, err := port[driver.DestinationAdmin](s, connID, model.CapDestinationDelete)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RemoveDestination(ctx, model.DestinationRef{Namespace: namespace, Name: name})
}

// SubscriptionStats is one subscription's figures.
//
// Topic-scoped, which the canonical consumer service is not: its Stats builds
// a ref with an empty namespace, and a Pulsar subscription has no identity
// without the topic it belongs to - two topics can each have one called
// "shared" and they are unrelated.
func (s *Service) SubscriptionStats(
	ctx context.Context, connID int, topic, subscription string,
) (map[string]interface{}, error) {
	api, err := port[driver.SubscriptionStats](s, connID, model.CapSubscriptionLag)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.SubscriptionStats(ctx, model.SubscriptionRef{Namespace: topic, Name: subscription})
}

// SubscriptionClients is who is attached to one subscription, and what the
// broker says each of them is doing.
func (s *Service) SubscriptionClients(
	ctx context.Context, connID int, topic, subscription string,
) ([]*model.SubscriptionClient, error) {
	api, err := port[driver.SubscriptionRuntime](s, connID, model.CapSubscriptionRuntime)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.SubscriptionClients(ctx,
		model.SubscriptionRef{Namespace: topic, Name: subscription})
}

// CreateSubscription adds one to a topic, at the earliest message it still
// holds unless the form asked for the latest.
func (s *Service) CreateSubscription(
	ctx context.Context, connID int, topic, subscription, startAt string,
) error {
	api, err := port[driver.SubscriptionAdmin](s, connID, model.CapSubscriptionCreate)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.CreateSubscription(ctx, model.SubscriptionSpec{
		Ref:        model.SubscriptionRef{Namespace: topic, Name: subscription},
		Attributes: map[string]string{pulsardriver.AttrSubscriptionStartAt: startAt},
	})
}

// DeleteSubscription removes one. Pulsar refuses while a consumer is attached.
func (s *Service) DeleteSubscription(
	ctx context.Context, connID int, topic, subscription string,
) error {
	api, err := port[driver.SubscriptionAdmin](s, connID, model.CapSubscriptionDelete)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RemoveSubscription(ctx,
		model.SubscriptionRef{Namespace: topic, Name: subscription})
}

// DeadLetterQueues finds the topics dead letters land in.
//
// Named by the official client libraries' convention rather than declared on
// the broker: a consumer with a DLQ policy republishes to
// "<topic>-<subscription>-DLQ". Nothing on the cluster records the link, so
// the page is a walk of the namespace rather than a question about a group.
func (s *Service) DeadLetterQueues(
	ctx context.Context, connID int, namespace string,
) ([]*model.DeadLetterQueue, error) {
	api, err := port[driver.DeadLetterTopology](s, connID, model.CapDeadLetterTopology)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.DeadLetterQueues(ctx, namespace)
}
