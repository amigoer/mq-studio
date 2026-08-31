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

// AccessControl is the access page in one round trip: whether the cluster has
// an authorizer at all, the rules it holds, and the users it stores.
//
// One call because the three are read together and separately they can
// disagree: a page that fetched rules and users apart could show a rule for a
// user the same refresh says does not exist.
func (s *Service) AccessControl(
	ctx context.Context, connID int,
) (bool, []*model.AccessRule, []*model.AccessPrincipal, error) {
	api, err := port[driver.AccessDirectory](s, connID, model.CapAccessDirectory)
	if err != nil {
		if notConnected(err) {
			return false, nil, nil, nil
		}
		return false, nil, nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	enabled, err := api.DirectoryEnabled(ctx)
	if err != nil {
		return false, nil, nil, err
	}
	if !enabled {
		// Not an error: the cluster runs without an authorizer, which the page
		// explains rather than failing over.
		return false, []*model.AccessRule{}, []*model.AccessPrincipal{}, nil
	}

	rules, err := api.ListAccessRules(ctx)
	if err != nil {
		return true, nil, nil, err
	}
	// A cluster can authenticate over mTLS or Kerberos and store no users at
	// all, so a failure here does not cost the rules.
	principals, _ := api.ListPrincipals(ctx)
	return true, rules, principals, nil
}

// PutAccessRule writes every policy a subject should have.
func (s *Service) PutAccessRule(ctx context.Context, connID int, rule model.AccessRule) error {
	api, err := port[driver.AccessDirectory](s, connID, model.CapAccessDirectory)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.PutAccessRule(ctx, rule)
}

// RemoveAccessRule deletes every rule belonging to a principal.
func (s *Service) RemoveAccessRule(ctx context.Context, connID int, subject string) error {
	api, err := port[driver.AccessDirectory](s, connID, model.CapAccessDirectory)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RemoveAccessRule(ctx, subject)
}

// PutPrincipal creates or updates a SCRAM user.
func (s *Service) PutPrincipal(
	ctx context.Context, connID int, spec model.AccessPrincipalSpec,
) error {
	api, err := port[driver.AccessDirectory](s, connID, model.CapAccessDirectory)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.PutPrincipal(ctx, spec)
}

// RemovePrincipal deletes a SCRAM user's password for every mechanism.
func (s *Service) RemovePrincipal(ctx context.Context, connID int, name string) error {
	api, err := port[driver.AccessDirectory](s, connID, model.CapAccessDirectory)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RemovePrincipal(ctx, name)
}

// TruncateTopic moves every partition's start offset to its end.
//
// Not a delete: the records before it become unreadable and the offsets keep
// counting, so a consumer that was at 900 stays at 900 and is simply caught up.
func (s *Service) TruncateTopic(ctx context.Context, connID int, name string) error {
	api, err := port[driver.QueueActions](s, connID, model.CapDestinationPurge)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.PurgeQueue(ctx, model.DestinationRef{Name: name})
}

// DropOldestRecords takes a bounded batch off the head of each partition and
// reports how many it actually removed.
func (s *Service) DropOldestRecords(
	ctx context.Context, connID int, name string, limit int,
) (int, error) {
	api, err := port[driver.QueueActions](s, connID, model.CapDestinationPurge)
	if err != nil {
		return 0, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.DropMessages(ctx, model.DestinationRef{Name: name}, limit)
}

// ElectPreferredLeaders puts each partition's leadership back on the first
// broker in its replica list.
func (s *Service) ElectPreferredLeaders(ctx context.Context, connID int) error {
	api, err := port[driver.QueueActions](s, connID, model.CapQueueRebalance)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RebalanceQueues(ctx)
}

// Reassignments reports the partitions currently being moved between brokers.
//
// Empty is the normal state and the useful one: a reassignment has no
// completion event, so an empty list is how an operator knows the last plan
// finished.
func (s *Service) Reassignments(
	ctx context.Context, connID int,
) ([]*model.PartitionReassignment, error) {
	api, err := port[driver.PartitionReassigner](s, connID, model.CapReassign)
	if err != nil {
		if notConnected(err) {
			return []*model.PartitionReassignment{}, nil
		}
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.ListReassignments(ctx)
}

// Reassign rewrites where one partition's replicas live. The list is ordered:
// the first broker is the preferred leader.
func (s *Service) Reassign(
	ctx context.Context, connID int, topic string, partition int32, brokers []int32,
) error {
	api, err := port[driver.PartitionReassigner](s, connID, model.CapReassign)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.Reassign(ctx, topic, partition, brokers)
}

// CancelReassignment stops a move in flight, leaving the partition wherever it
// has got to.
func (s *Service) CancelReassignment(
	ctx context.Context, connID int, topic string, partition int32,
) error {
	api, err := port[driver.PartitionReassigner](s, connID, model.CapReassign)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.CancelReassignment(ctx, topic, partition)
}

// Quotas reports the limits attached to clients rather than to topics.
func (s *Service) Quotas(ctx context.Context, connID int) ([]*model.ClientQuota, error) {
	api, err := port[driver.QuotaAdmin](s, connID, model.CapQuotaList)
	if err != nil {
		if notConnected(err) {
			return []*model.ClientQuota{}, nil
		}
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.ListQuotas(ctx)
}

/*
 * Transactions reports every transactional producer the cluster knows about.
 *
 * The reason a page wants this is the stuck one: a transaction left Ongoing
 * holds the last stable offset of every partition it wrote to, and a consumer
 * reading committed records stops there. Nothing else in this app shows that -
 * the topic looks healthy, the group looks healthy, and the pipeline is not.
 */
func (s *Service) Transactions(ctx context.Context, connID int) ([]*model.Transaction, error) {
	api, err := port[driver.TransactionInspector](s, connID, model.CapTransactions)
	if err != nil {
		if notConnected(err) {
			return []*model.Transaction{}, nil
		}
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.ListTransactions(ctx)
}

// AlterQuota sets the limits in set and removes the keys in remove. A removal
// is not a set to zero: zero throttles a client to nothing.
func (s *Service) AlterQuota(
	ctx context.Context, connID int,
	entity []model.QuotaEntity, set map[string]float64, remove []string,
) error {
	api, err := port[driver.QuotaAdmin](s, connID, model.CapQuotaAdmin)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.AlterQuota(ctx, entity, set, remove)
}

// RemoveQuota clears every limit on an entity, which is how a quota stops
// existing: Kafka has no delete, only a set of removals.
func (s *Service) RemoveQuota(
	ctx context.Context, connID int, entity []model.QuotaEntity, keys []string,
) error {
	api, err := port[driver.QuotaAdmin](s, connID, model.CapQuotaAdmin)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RemoveQuota(ctx, entity, keys)
}
