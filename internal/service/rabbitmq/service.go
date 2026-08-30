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
