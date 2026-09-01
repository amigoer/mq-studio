// Package redisstream orchestrates the operations only Redis Streams has.
//
// It exists beside the canonical services rather than inside them because the
// questions are Redis's own: what a trim removed, what is sitting in a group's
// pending list, what the server has been slow at. Bending those into a shape
// every family shares would cost the detail that makes them worth showing.
//
// The canonical services still serve Redis everything they can express -
// a stream is a destination, a consumer group is a subscription - so nothing
// here duplicates them.
package redisstream

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

// Trim discards entries from the head of a stream, by length or by position.
func (s *Service) Trim(ctx context.Context, connID int, request model.TrimRequest) (*model.TrimResult, error) {
	api, err := port[driver.StreamTrimmer](s, connID, model.CapStreamTrim)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.Trim(ctx, request)
}

// DeleteEntries removes named entries from a stream.
func (s *Service) DeleteEntries(ctx context.Context, connID int, ref model.DestinationRef, ids []string) (*model.TrimResult, error) {
	api, err := port[driver.StreamTrimmer](s, connID, model.CapStreamTrim)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.DeleteEntries(ctx, ref, ids)
}

// notConnected reports whether the failure is simply that nothing is dialled.
//
// List pages answer that with an empty result rather than an error: the board
// renders its own not-connected state, and a red error on top of it says
// something went wrong when nothing did.
func notConnected(err error) bool {
	return errors.Is(err, driver.ErrNotConnected)
}

var _ = notConnected
