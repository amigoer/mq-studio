// Package rabbitmq orchestrates the operations only RabbitMQ has.
//
// It exists beside the canonical services rather than inside them because the
// questions are RabbitMQ's own: what a virtual host holds, which policy a
// queue matched, what one exchange routes. Bending those into a shape every
// family shares would cost the detail that makes them worth showing.
//
// The canonical services still serve RabbitMQ everything they can express -
// queues are destinations, consumers are subscriptions - so nothing here
// duplicates them.
package rabbitmq

import (
	"context"
	"errors"
	"time"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

// Settings exposes only what these operations need.
type Settings interface {
	GetRequestTimeout() time.Duration
}

// ConnSource yields the connection a request runs against.
type ConnSource func(connID int) (driver.Conn, error)

// Service is the orchestration layer between the bridge and a driver.
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

// notConnected reports whether the failure is simply that nothing is dialled.
//
// List pages answer that with an empty result rather than an error: the board
// draws its own "not connected" state, and an error banner over it says the
// same thing twice.
func notConnected(err error) bool {
	return errors.Is(err, driver.ErrNotConnected)
}

// Census returns the broker's own running totals.
func (s *Service) Census(ctx context.Context, connID int) (*model.BrokerCensus, error) {
	api, err := port[driver.CensusReporter](s, connID, model.CapClusterCensus)
	if err != nil {
		if notConnected(err) {
			return nil, nil
		}
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.Census(ctx)
}

// ClientConnections returns the transport connections open against the broker.
//
// An empty list when nothing is dialled, matching every other list page: the
// board draws its own not-connected state.
func (s *Service) ClientConnections(ctx context.Context, connID int, namespace string) ([]*model.ClientConnection, error) {
	api, err := port[driver.ClientInspector](s, connID, model.CapClientInspect)
	if err != nil {
		if notConnected(err) {
			return []*model.ClientConnection{}, nil
		}
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.ListClientConnections(ctx, namespace)
}

// ClientChannels returns the channels multiplexed inside those connections.
func (s *Service) ClientChannels(ctx context.Context, connID int, namespace string) ([]*model.ClientChannel, error) {
	api, err := port[driver.ClientInspector](s, connID, model.CapClientInspect)
	if err != nil {
		if notConnected(err) {
			return []*model.ClientChannel{}, nil
		}
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.ListClientChannels(ctx, namespace)
}

// Health runs the broker's own checks and reads its feature flags.
func (s *Service) Health(ctx context.Context, connID int) (*model.BrokerHealth, error) {
	api, err := port[driver.HealthInspector](s, connID, model.CapClusterHealth)
	if err != nil {
		if notConnected(err) {
			return nil, nil
		}
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.Health(ctx)
}

// DeadLetterQueues finds the queues dead letters land in.
func (s *Service) DeadLetterQueues(ctx context.Context, connID int, namespace string) ([]*model.DeadLetterQueue, error) {
	api, err := port[driver.DeadLetterTopology](s, connID, model.CapDeadLetterTopology)
	if err != nil {
		if notConnected(err) {
			return []*model.DeadLetterQueue{}, nil
		}
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.DeadLetterQueues(ctx, namespace)
}

// DeclareQueue creates a queue with the arguments the form collected.
func (s *Service) DeclareQueue(ctx context.Context, connID int, spec model.DestinationSpec) error {
	api, err := port[driver.DestinationAdmin](s, connID, model.CapDestinationCreate)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.CreateDestination(ctx, spec)
}

// DeleteQueue removes a queue, optionally only if the broker agrees it is
// unused or empty.
//
// The guards are checked by the broker at the moment of deletion, which is the
// only place they can be checked without a race - a queue this app read as
// empty a second ago may not be by the time the request lands.
func (s *Service) DeleteQueue(ctx context.Context, connID int, ref model.DestinationRef, ifUnused, ifEmpty bool) error {
	api, err := port[driver.QueueGuardedRemover](s, connID, model.CapDestinationDelete)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RemoveQueueGuarded(ctx, ref, ifUnused, ifEmpty)
}

// PurgeQueue drops everything a queue is holding.
func (s *Service) PurgeQueue(ctx context.Context, connID int, ref model.DestinationRef) error {
	api, err := port[driver.QueueActions](s, connID, model.CapDestinationPurge)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.PurgeQueue(ctx, ref)
}

// MoveMessages drains one queue into an exchange and reports how many arrived.
//
// The count is returned even when the move failed partway: it is what already
// reached the target, and the page has to say so rather than implying nothing
// happened.
func (s *Service) MoveMessages(ctx context.Context, connID int, request model.MoveRequest) (int, error) {
	api, err := port[driver.QueueActions](s, connID, model.CapDestinationMove)
	if err != nil {
		return 0, err
	}
	// Deliberately not the shared request timeout. Moving is one round trip
	// per message with a confirm on each, so a batch of five hundred against a
	// slow broker takes longer than any page read is allowed to.
	ctx, cancel := context.WithTimeout(ctx, moveTimeout)
	defer cancel()
	return api.MoveMessages(ctx, request)
}

// moveTimeout bounds one move batch.
const moveTimeout = 2 * time.Minute

// RebalanceQueues spreads replicated queue leaders back across the nodes.
func (s *Service) RebalanceQueues(ctx context.Context, connID int) error {
	api, err := port[driver.QueueActions](s, connID, model.CapQueueRebalance)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RebalanceQueues(ctx)
}

// DeclareExchange creates an exchange.
func (s *Service) DeclareExchange(ctx context.Context, connID int, spec model.ExchangeSpec) error {
	api, err := port[driver.RoutingMutator](s, connID, model.CapRoutingAdmin)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.DeclareExchange(ctx, spec)
}

// DeleteExchange removes an exchange, and its bindings with it.
func (s *Service) DeleteExchange(ctx context.Context, connID int, namespace, name string) error {
	api, err := port[driver.RoutingMutator](s, connID, model.CapRoutingAdmin)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RemoveExchange(ctx, namespace, name)
}

// DeclareBinding routes an exchange to a queue or to another exchange.
func (s *Service) DeclareBinding(ctx context.Context, connID int, binding model.Binding) error {
	api, err := port[driver.RoutingMutator](s, connID, model.CapRoutingAdmin)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.DeclareBinding(ctx, binding)
}

// DeleteBinding removes one binding, identified by the properties key the
// broker listed it under.
func (s *Service) DeleteBinding(ctx context.Context, connID int, binding model.Binding) error {
	api, err := port[driver.RoutingMutator](s, connID, model.CapRoutingAdmin)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RemoveBinding(ctx, binding)
}

// Publish sends a message and reports what the broker did with it.
//
// The result is returned even alongside an error: a batch that failed halfway
// has already sent what it counted, and a console that showed nothing would be
// telling the user something untrue.
func (s *Service) Publish(ctx context.Context, connID int, request model.PublishRequest) (*model.PublishResult, error) {
	api, err := port[driver.RichPublisher](s, connID, model.CapPublishRich)
	if err != nil {
		return nil, err
	}
	// Its own timeout, like moving: a repeat count of a thousand is a thousand
	// confirm round trips, which no page read is allowed to take.
	ctx, cancel := context.WithTimeout(ctx, moveTimeout)
	defer cancel()
	return api.Publish(ctx, request)
}

// DropMessages discards a bounded batch from the head of a queue.
//
// The count is returned even alongside an error, like a move: what it reports
// is already gone, and there is no undo.
func (s *Service) DropMessages(ctx context.Context, connID int, ref model.DestinationRef, limit int) (int, error) {
	api, err := port[driver.QueueActions](s, connID, model.CapDestinationPurge)
	if err != nil {
		return 0, err
	}
	ctx, cancel := context.WithTimeout(ctx, moveTimeout)
	defer cancel()
	return api.DropMessages(ctx, ref, limit)
}

// CloseClientConnection disconnects one connection, telling the client why.
func (s *Service) CloseClientConnection(ctx context.Context, connID int, name, reason string) error {
	api, err := port[driver.ClientCloser](s, connID, model.CapClientClose)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.CloseClientConnection(ctx, name, reason)
}

// CloseUserConnections disconnects every connection one user holds.
func (s *Service) CloseUserConnections(ctx context.Context, connID int, username, reason string) error {
	api, err := port[driver.ClientCloser](s, connID, model.CapClientClose)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.CloseUserConnections(ctx, username, reason)
}

// Namespaces returns every virtual host with the limits set on each.
func (s *Service) Namespaces(ctx context.Context, connID int) ([]*model.Namespace, error) {
	api, err := port[driver.NamespaceAdmin](s, connID, model.CapNamespaceList)
	if err != nil {
		if notConnected(err) {
			return []*model.Namespace{}, nil
		}
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.ListNamespaces(ctx)
}

// SaveNamespace creates a virtual host or updates one that exists.
func (s *Service) SaveNamespace(ctx context.Context, connID int, spec model.NamespaceSpec) error {
	api, err := port[driver.NamespaceAdmin](s, connID, model.CapNamespaceAdmin)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.CreateNamespace(ctx, spec)
}

// DeleteNamespace removes a virtual host and everything inside it.
func (s *Service) DeleteNamespace(ctx context.Context, connID int, name string) error {
	api, err := port[driver.NamespaceAdmin](s, connID, model.CapNamespaceAdmin)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RemoveNamespace(ctx, name)
}

// SetNamespaceLimit caps a virtual host, or lifts the cap when value is
// negative - which is how the page says "no limit", since zero forbids
// everything and is a different instruction.
func (s *Service) SetNamespaceLimit(ctx context.Context, connID int, name, limit string, value int) error {
	api, err := port[driver.NamespaceLimits](s, connID, model.CapNamespaceLimits)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	if value < 0 {
		return api.RemoveNamespaceLimit(ctx, name, limit)
	}
	return api.SetNamespaceLimit(ctx, name, limit, value)
}

// Identities returns every user with its permissions attached.
func (s *Service) Identities(ctx context.Context, connID int) ([]*model.Identity, error) {
	api, err := port[driver.IdentityAdmin](s, connID, model.CapIdentityList)
	if err != nil {
		if notConnected(err) {
			return []*model.Identity{}, nil
		}
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.ListIdentities(ctx)
}

// SaveIdentity creates a user or updates one.
func (s *Service) SaveIdentity(ctx context.Context, connID int, spec model.IdentitySpec) error {
	api, err := port[driver.IdentityAdmin](s, connID, model.CapIdentityAdmin)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.SaveIdentity(ctx, spec)
}

// DeleteIdentity removes a user, its permissions and its open connections.
func (s *Service) DeleteIdentity(ctx context.Context, connID int, name string) error {
	api, err := port[driver.IdentityAdmin](s, connID, model.CapIdentityAdmin)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RemoveIdentity(ctx, name)
}

// SetPermission grants an identity rights inside one namespace.
func (s *Service) SetPermission(ctx context.Context, connID int, permission model.NamespacePermission) error {
	api, err := port[driver.IdentityPermissions](s, connID, model.CapIdentityPermissions)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.SetPermission(ctx, permission)
}

// RevokePermission removes an identity's permission record for one namespace,
// which stops it connecting there at all.
func (s *Service) RevokePermission(ctx context.Context, connID int, namespace, identity string) error {
	api, err := port[driver.IdentityPermissions](s, connID, model.CapIdentityPermissions)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RemovePermission(ctx, namespace, identity)
}

// TopicPermissions returns the per-exchange narrowing applied on top of the
// namespace permissions.
func (s *Service) TopicPermissions(ctx context.Context, connID int) ([]*model.TopicPermission, error) {
	api, err := port[driver.IdentityPermissions](s, connID, model.CapIdentityPermissions)
	if err != nil {
		if notConnected(err) {
			return []*model.TopicPermission{}, nil
		}
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.ListTopicPermissions(ctx)
}

// SetTopicPermission narrows write and read on one topic exchange.
func (s *Service) SetTopicPermission(ctx context.Context, connID int, permission model.TopicPermission) error {
	api, err := port[driver.IdentityPermissions](s, connID, model.CapIdentityPermissions)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.SetTopicPermission(ctx, permission)
}

// RevokeTopicPermission lifts the narrowing, leaving the namespace permissions
// alone.
func (s *Service) RevokeTopicPermission(ctx context.Context, connID int, namespace, identity string) error {
	api, err := port[driver.IdentityPermissions](s, connID, model.CapIdentityPermissions)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RemoveTopicPermission(ctx, namespace, identity)
}

// Policies returns both user and operator policies, marked apart.
func (s *Service) Policies(ctx context.Context, connID int) ([]*model.Policy, error) {
	api, err := port[driver.PolicyAdmin](s, connID, model.CapPolicyList)
	if err != nil {
		if notConnected(err) {
			return []*model.Policy{}, nil
		}
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.ListPolicies(ctx)
}

// MatchingPolicies asks the broker which policies actually apply to one
// destination.
func (s *Service) MatchingPolicies(ctx context.Context, connID int, ref model.DestinationRef, kind string) ([]*model.Policy, error) {
	api, err := port[driver.PolicyAdmin](s, connID, model.CapPolicyList)
	if err != nil {
		if notConnected(err) {
			return []*model.Policy{}, nil
		}
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.MatchingPolicies(ctx, ref, kind)
}

// SavePolicy creates a policy or replaces one of the same name.
func (s *Service) SavePolicy(ctx context.Context, connID int, policy model.Policy) error {
	api, err := port[driver.PolicyAdmin](s, connID, model.CapPolicyAdmin)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.SavePolicy(ctx, policy)
}

// DeletePolicy removes one, and every destination it applied to reverts.
func (s *Service) DeletePolicy(ctx context.Context, connID int, namespace, name string, operator bool) error {
	api, err := port[driver.PolicyAdmin](s, connID, model.CapPolicyAdmin)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RemovePolicy(ctx, namespace, name, operator)
}

// RuntimeParameters returns the component configuration the broker stores.
func (s *Service) RuntimeParameters(ctx context.Context, connID int) ([]*model.RuntimeParameter, error) {
	api, err := port[driver.ParameterAdmin](s, connID, model.CapParameterAdmin)
	if err != nil {
		if notConnected(err) {
			return []*model.RuntimeParameter{}, nil
		}
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.ListRuntimeParameters(ctx)
}

// DeleteRuntimeParameter removes one component's stored configuration.
func (s *Service) DeleteRuntimeParameter(ctx context.Context, connID int, component, namespace, name string) error {
	api, err := port[driver.ParameterAdmin](s, connID, model.CapParameterAdmin)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RemoveRuntimeParameter(ctx, component, namespace, name)
}

// ExportDefinitions returns the broker's topology as one document.
func (s *Service) ExportDefinitions(ctx context.Context, connID int, namespace string) (*model.Definitions, error) {
	api, err := port[driver.DefinitionsAdmin](s, connID, model.CapDefinitionsExport)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.ExportDefinitions(ctx, namespace)
}

// ImportDefinitions applies a document to the broker.
func (s *Service) ImportDefinitions(ctx context.Context, connID int, namespace, document string) error {
	api, err := port[driver.DefinitionsAdmin](s, connID, model.CapDefinitionsImport)
	if err != nil {
		return err
	}
	// Its own timeout: a document describing a few hundred queues takes the
	// broker longer to apply than any page read is allowed to wait.
	ctx, cancel := context.WithTimeout(ctx, moveTimeout)
	defer cancel()
	return api.ImportDefinitions(ctx, namespace, document)
}
