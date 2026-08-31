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
	kafkadriver "github.com/amigoer/mq-studio/internal/driver/kafka"
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

// ResetGroupOffsets writes a consumer group's committed offsets.
//
// Kafka refuses this while the group has live members, and that refusal is
// passed through: committing on behalf of a running consumer would be
// overwritten by it moments later, so a reset that appeared to work and then
// undid itself is the worst of the three possible outcomes.
func (s *Service) ResetGroupOffsets(
	ctx context.Context, connID int, request kafkadriver.OffsetResetRequest,
) error {
	api, err := port[*kafkadriver.Conn](s, connID, model.CapOffsetReset)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.ResetGroupOffsets(ctx, request)
}

// DeleteGroupOffsets forgets a group's position on some topics.
//
// Different from a reset: a reset says where to read next, this says the group
// has no position at all and the consumer's own auto.offset.reset decides.
func (s *Service) DeleteGroupOffsets(
	ctx context.Context, connID int, group string, topics []string,
) error {
	api, err := port[*kafkadriver.Conn](s, connID, model.CapOffsetReset)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.DeleteGroupOffsets(ctx, group, topics)
}

// CloneGroupOffsets copies one group's positions onto another.
func (s *Service) CloneGroupOffsets(
	ctx context.Context, connID int, request model.CloneOffsetRequest,
) error {
	api, err := port[driver.OffsetCloner](s, connID, model.CapOffsetClone)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.CloneOffset(ctx, request)
}

// DeleteGroup removes a consumer group and the offsets it holds.
func (s *Service) DeleteGroup(ctx context.Context, connID int, group string) error {
	api, err := port[driver.SubscriptionAdmin](s, connID, model.CapSubscriptionDelete)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RemoveSubscription(ctx, model.SubscriptionRef{Name: group})
}

// LogDirs reports how much disk every broker's partitions occupy.
//
// Not connected yields nothing rather than an error: the board draws its own
// state for that, and an error banner over it says the same thing twice.
func (s *Service) LogDirs(ctx context.Context, connID int) ([]*model.LogDirSummary, error) {
	api, err := port[driver.LogDirInspector](s, connID, model.CapLogDirs)
	if err != nil {
		if notConnected(err) {
			return []*model.LogDirSummary{}, nil
		}
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.LogDirs(ctx)
}

// LogDirPartitions is what is inside them, largest first. The reason to open
// the page is to find what is filling a disk.
func (s *Service) LogDirPartitions(
	ctx context.Context, connID int, limit int,
) ([]*model.LogDirPartition, error) {
	api, err := port[driver.LogDirInspector](s, connID, model.CapLogDirs)
	if err != nil {
		if notConnected(err) {
			return []*model.LogDirPartition{}, nil
		}
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.LogDirPartitions(ctx, limit)
}

// SendRecord publishes with everything Kafka carries and reports where the
// record landed.
func (s *Service) SendRecord(
	ctx context.Context, connID int, request kafkadriver.RecordRequest,
) (*kafkadriver.RecordResult, error) {
	api, err := port[*kafkadriver.Conn](s, connID, model.CapPublish)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.SendRecord(ctx, request)
}
