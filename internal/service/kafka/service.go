// Package kafka orchestrates the operations only Kafka has.
//
// It exists beside the canonical services rather than inside them because the
// canonical ones cannot express the questions. Creating a topic is the clearest
// case: TopicService.Create takes a broker address, a read queue count, a write
// queue count and a permission string, which is RocketMQ's vocabulary and has
// no Kafka meaning at all. A Kafka topic is a partition count, a replication
// factor and a configuration document.
//
// The canonical services still serve Kafka everything they can express -
// topics are destinations, groups are subscriptions, brokers are nodes - so
// nothing here duplicates a read that already has a home.
package kafka

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

// notConnected reports whether the failure is simply that nothing is dialled.
func notConnected(err error) bool {
	return errors.Is(err, driver.ErrNotConnected)
}

// CreateTopic declares a topic.
//
// Partitions and the replication factor are the two decisions that cannot be
// taken back: partitions can be added but never removed, and the factor moves
// only through a reassignment.
func (s *Service) CreateTopic(ctx context.Context, connID int, spec model.DestinationSpec) error {
	api, err := port[driver.DestinationAdmin](s, connID, model.CapDestinationCreate)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.CreateDestination(ctx, spec)
}

// AlterTopicConfigs changes only the settings it is given.
//
// An empty value means "back to the cluster default", which is a deletion
// rather than a set to the empty string.
func (s *Service) AlterTopicConfigs(
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

// DeleteTopic removes a topic and everything in it.
func (s *Service) DeleteTopic(ctx context.Context, connID int, name string) error {
	api, err := port[driver.DestinationAdmin](s, connID, model.CapDestinationDelete)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RemoveDestination(ctx, model.DestinationRef{Name: name})
}
