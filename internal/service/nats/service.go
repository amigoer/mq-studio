// Package nats orchestrates the operations only NATS has.
//
// It exists beside the canonical services rather than inside them because the
// requests are NATS's own shape. A stream is a destination and a consumer is a
// subscription, so the canonical services answer the read side in full - what
// they cannot express is the writing. TopicService.Create collects a broker
// address, a read queue, a write queue and a permission mask, which is
// RocketMQ's vocabulary and has no NATS counterpart; a stream is declared with
// a subject list, a retention policy and a set of limits, and there is nowhere
// in that signature to put any of it.
//
// Nothing here duplicates a canonical service. Where one can express the
// operation, the board calls it.
package nats

import (
	"context"
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

// SaveStream declares a stream or rewrites an existing one.
//
// One method for both, because the form is one form: the difference between
// creating and updating is which of them the server will accept, not what the
// caller collected. Which one is sent is the caller's choice rather than a
// guess made here - a create that silently became an update would rewrite
// somebody else's subjects, and an update that silently became a create would
// hide a stream that had been deleted underneath the page.
func (s *Service) SaveStream(ctx context.Context, connID int, spec model.DestinationSpec, update bool) error {
	capability := model.CapDestinationCreate
	if update {
		capability = model.CapDestinationUpdate
	}
	api, err := port[driver.DestinationAdmin](s, connID, capability)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	if update {
		return api.UpdateDestination(ctx, spec)
	}
	return api.CreateDestination(ctx, spec)
}

// DeleteStream removes a stream and everything it holds.
func (s *Service) DeleteStream(ctx context.Context, connID int, name string) error {
	api, err := port[driver.DestinationAdmin](s, connID, model.CapDestinationDelete)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RemoveDestination(ctx, model.DestinationRef{Name: name})
}

// Trim discards messages from the head of a stream, by a bound the caller
// names.
func (s *Service) Trim(ctx context.Context, connID int, request model.TrimRequest) (*model.TrimResult, error) {
	api, err := port[driver.StreamTrimmer](s, connID, model.CapStreamTrim)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.Trim(ctx, request)
}

// DeleteMessages removes messages by sequence and reports how many were there
// to remove, which is not how many were asked for.
func (s *Service) DeleteMessages(ctx context.Context, connID int, name string, sequences []string) (*model.TrimResult, error) {
	api, err := port[driver.StreamTrimmer](s, connID, model.CapStreamTrim)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.DeleteEntries(ctx, model.DestinationRef{Name: name}, sequences)
}

// SaveConsumer declares a consumer on a stream or rewrites an existing one.
//
// Which of the two is the caller's choice for the same reason it is for a
// stream: a create that silently became an update would move another
// application's position, and an update that silently became a create would
// hide a consumer somebody had deleted underneath the page.
func (s *Service) SaveConsumer(ctx context.Context, connID int, spec model.SubscriptionSpec, update bool) error {
	// Both gate on the create capability. The vocabulary has no separate one
	// for editing a subscription - CapSubscriptionCreate is what says a family
	// can declare them at all - and inventing a second here would put a
	// capability in the sidebar contract that no driver declares.
	api, err := port[driver.SubscriptionAdmin](s, connID, model.CapSubscriptionCreate)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	if update {
		return api.UpdateSubscription(ctx, spec)
	}
	return api.CreateSubscription(ctx, spec)
}

// DeleteConsumer removes a consumer and the position it held.
func (s *Service) DeleteConsumer(ctx context.Context, connID int, stream, name string) error {
	api, err := port[driver.SubscriptionAdmin](s, connID, model.CapSubscriptionDelete)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RemoveSubscription(ctx, model.SubscriptionRef{Namespace: stream, Name: name})
}
