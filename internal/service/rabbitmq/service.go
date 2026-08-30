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
