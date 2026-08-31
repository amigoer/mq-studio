package bridge

import (
	"context"

	kafkadriver "github.com/amigoer/mq-studio/internal/driver/kafka"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/kafka"
)

// KafkaService exposes what only Kafka has.
//
// It is one service rather than several because it is one family's surface:
// splitting topic administration, quotas and reassignment into three would put
// three names in the bindings for what a reader thinks of as "the Kafka pages".
//
// Reading topics, groups and brokers is not here. Those are destinations,
// subscriptions and nodes, and the canonical services already answer them; a
// second read path would be two sources for one number.
type KafkaService struct {
	service *kafka.Service
}

// KafkaTopicInput is a topic declaration as the Kafka form collects it.
//
// Deliberately not TopicService.Create's shape. That one takes a broker
// address, a read queue count, a write queue count and a permission string,
// which is RocketMQ's vocabulary: a Kafka topic has none of those, and a form
// that filled them in with placeholders would be lying about what it sent.
type KafkaTopicInput struct {
	Name string `json:"name"`

	// Partitions and ReplicationFactor are fixed at creation. Zero means "let
	// the broker use its own default", which is what an operator who left the
	// field alone meant.
	Partitions        int `json:"partitions"`
	ReplicationFactor int `json:"replicationFactor"`

	// Configs are Kafka's own setting names - cleanup.policy, retention.ms -
	// passed through as given. This app does not curate the list: a cluster
	// knows settings this build has never heard of, and refusing them would
	// make the form less capable than kafka-topics.sh.
	Configs map[string]string `json:"configs"`
}

func (input KafkaTopicInput) spec() model.DestinationSpec {
	attributes := make(map[string]string, len(input.Configs)+1)
	for key, value := range input.Configs {
		attributes[key] = value
	}
	if input.ReplicationFactor > 0 {
		attributes[kafkadriver.AttrReplicationFactor] = itoa(input.ReplicationFactor)
	}
	return model.DestinationSpec{
		Ref:        model.DestinationRef{Name: input.Name},
		Partitions: input.Partitions,
		Attributes: attributes,
	}
}

// CreateTopic declares a topic.
func (s *KafkaService) CreateTopic(connID int, input KafkaTopicInput) error {
	return s.service.CreateTopic(context.Background(), connID, input.spec())
}

// AlterTopicConfigs changes only the settings it is given. An empty value puts
// a setting back to the cluster default rather than setting it to nothing.
func (s *KafkaService) AlterTopicConfigs(connID int, name string, configs map[string]string) error {
	return s.service.AlterTopicConfigs(context.Background(), connID, model.DestinationSpec{
		Ref:        model.DestinationRef{Name: name},
		Attributes: configs,
	})
}

// DeleteTopic removes a topic and everything in it.
//
// It returns once the cluster agrees the topic is gone rather than once the
// delete is accepted, so a board that re-reads on success does not list what
// was just deleted.
func (s *KafkaService) DeleteTopic(connID int, name string) error {
	return s.service.DeleteTopic(context.Background(), connID, name)
}

// OffsetResetInput is an offset reset as the form collects it.
//
// Deliberately not ConsumerService's ResetOffset, which takes a group, a topic
// and a timestamp: that is one of Kafka's five targets and the form offers all
// five, because "start again", "skip everything" and "go back to when the
// incident started" are different requests.
type OffsetResetInput struct {
	Group string `json:"group"`
	Topic string `json:"topic"`

	// Partitions narrows the reset. Empty means every partition of the topic.
	Partitions []int32 `json:"partitions"`

	// Target is earliest, latest, timestamp, offset or shift.
	Target string `json:"target"`
	// Timestamp is milliseconds, for the timestamp target.
	Timestamp int64 `json:"timestamp"`
	// Value is the offset for the offset target and the signed delta for shift.
	Value int64 `json:"value"`
}

// ResetGroupOffsets writes a consumer group's committed offsets.
//
// Kafka refuses this while the group has live members. That refusal reaches
// the user as-is: the fix is to stop the consumers, and saying so is more use
// than a reset a running consumer would overwrite moments later.
func (s *KafkaService) ResetGroupOffsets(connID int, input OffsetResetInput) error {
	return s.service.ResetGroupOffsets(context.Background(), connID, kafkadriver.OffsetResetRequest{
		Group:      input.Group,
		Topic:      input.Topic,
		Partitions: input.Partitions,
		Target:     kafkadriver.OffsetTarget(input.Target),
		Timestamp:  input.Timestamp,
		Value:      input.Value,
	})
}

// DeleteGroupOffsets forgets a group's position on some topics without
// deleting the group.
func (s *KafkaService) DeleteGroupOffsets(connID int, group string, topics []string) error {
	return s.service.DeleteGroupOffsets(context.Background(), connID, group, topics)
}

// CloneGroupOffsets copies one group's positions onto another, which is how a
// replacement consumer group starts where the old one is instead of replaying
// everything it already handled.
func (s *KafkaService) CloneGroupOffsets(connID int, from, to, topic string) error {
	return s.service.CloneGroupOffsets(context.Background(), connID, model.CloneOffsetRequest{
		From: from, To: to, Destination: topic,
	})
}

// DeleteGroup removes a consumer group and the offsets it holds.
func (s *KafkaService) DeleteGroup(connID int, group string) error {
	return s.service.DeleteGroup(context.Background(), connID, group)
}

// LogDirView is the cluster page's storage tab in one round trip.
type LogDirView struct {
	Dirs []*model.LogDirSummary `json:"dirs"`
	// Largest is the biggest partitions across the cluster, which is what an
	// operator opens this for.
	Largest []*model.LogDirPartition `json:"largest"`

	// Total is the occupied bytes across every directory that answered, and
	// Failed is how many did not. A directory that cannot be described is
	// counted separately rather than as zero: a disk that will not answer must
	// not make a cluster look smaller than it is.
	Total  int64 `json:"total"`
	Failed int   `json:"failed"`
}

// largestPartitions caps what the storage tab draws. A cluster with thousands
// of partitions has a long tail nobody reads.
const largestPartitions = 20

// LogDirs reports where a cluster's disk has gone.
func (s *KafkaService) LogDirs(connID int) (*LogDirView, error) {
	ctx := context.Background()
	dirs, err := s.service.LogDirs(ctx, connID)
	if err != nil {
		return nil, err
	}
	largest, err := s.service.LogDirPartitions(ctx, connID, largestPartitions)
	if err != nil {
		return nil, err
	}

	view := &LogDirView{Dirs: dirs, Largest: largest}
	for _, dir := range dirs {
		if dir.Err != "" {
			view.Failed++
			continue
		}
		view.Total += dir.Size
	}
	return view, nil
}

// RecordInput is a Kafka publish as the send console collects it.
//
// Deliberately not MessageService's PublishInput. That one carries an exchange,
// a routing key, mandatory, persistent, a TTL and a priority - AMQP's, none of
// which Kafka has. A Kafka record has a partition it can be pinned to, a key
// that decides the partition when it is not, and an acknowledgement level that
// decides what a confirmation is worth.
type RecordInput struct {
	Topic string `json:"topic"`

	// Partition pins the record. -1 lets the key decide, which is what
	// ordering by key depends on.
	Partition int32 `json:"partition"`

	// HasKey separates a record with no key from one with an empty key. Kafka
	// treats them differently: the first is spread across partitions, the
	// second is pinned like any other.
	HasKey bool   `json:"hasKey"`
	Key    string `json:"key"`

	Value   string            `json:"value"`
	Headers map[string]string `json:"headers"`
	// Timestamp in milliseconds. Zero stamps it now.
	Timestamp int64 `json:"timestamp"`

	// Acks is none, leader or all.
	Acks  string `json:"acks"`
	Count int    `json:"count"`
}

// SendRecord publishes and reports the partition and offset it landed on.
func (s *KafkaService) SendRecord(connID int, input RecordInput) (*kafkadriver.RecordResult, error) {
	request := kafkadriver.RecordRequest{
		Topic:     input.Topic,
		Value:     input.Value,
		Headers:   input.Headers,
		Timestamp: input.Timestamp,
		Acks:      kafkadriver.Acks(input.Acks),
		Count:     input.Count,
	}
	if input.Partition >= 0 {
		partition := input.Partition
		request.Partition = &partition
	}
	if input.HasKey {
		key := input.Key
		request.Key = &key
	}
	return s.service.SendRecord(context.Background(), connID, request)
}

// AccessView is the access control page in one answer.
type AccessView struct {
	// Enabled is false on a cluster running without an authorizer. Its ACL
	// calls all answer SECURITY_DISABLED, which is a deployment choice rather
	// than a fault, so the page says so instead of showing an error.
	Enabled bool `json:"enabled"`

	Rules []*model.AccessRule `json:"rules"`

	// Principals are the SCRAM users the cluster stores. A cluster
	// authenticating over mTLS or Kerberos has principals it never stores, so
	// a rule can name someone who is not in this list - which is the truth
	// rather than an omission.
	Principals []*model.AccessPrincipal `json:"principals"`

	// Operations and ResourceKinds are what a rule may be built from. The set
	// is closed and comes from Go, so the renderer cannot write a grant that
	// has not been reviewed.
	Operations    []string `json:"operations"`
	ResourceKinds []string `json:"resourceKinds"`
}

// AccessControl reports the cluster's ACLs and the users it stores.
func (s *KafkaService) AccessControl(connID int) (*AccessView, error) {
	enabled, rules, principals, err := s.service.AccessControl(context.Background(), connID)
	if err != nil {
		return nil, err
	}
	return &AccessView{
		Enabled:       enabled,
		Rules:         rules,
		Principals:    principals,
		Operations:    kafkadriver.KnownACLOperations(),
		ResourceKinds: kafkadriver.KnownACLResourceKinds(),
	}, nil
}

// PutAccessRule writes every policy a subject should have.
func (s *KafkaService) PutAccessRule(connID int, rule model.AccessRule) error {
	return s.service.PutAccessRule(context.Background(), connID, rule)
}

// RemoveAccessRule deletes every rule belonging to a principal.
func (s *KafkaService) RemoveAccessRule(connID int, subject string) error {
	return s.service.RemoveAccessRule(context.Background(), connID, subject)
}

// PutPrincipal creates or updates a SCRAM user. The password is write-only:
// Kafka stores it salted and cannot be asked for it again.
func (s *KafkaService) PutPrincipal(connID int, spec model.AccessPrincipalSpec) error {
	return s.service.PutPrincipal(context.Background(), connID, spec)
}

// RemovePrincipal deletes a user's password for every mechanism it has.
func (s *KafkaService) RemovePrincipal(connID int, name string) error {
	return s.service.RemovePrincipal(context.Background(), connID, name)
}

// TruncateTopic empties a topic without deleting it.
//
// The offsets do not restart: a consumer that was at 900 stays at 900 and is
// simply caught up, which is what makes this safe on a topic something reads.
func (s *KafkaService) TruncateTopic(connID int, name string) error {
	return s.service.TruncateTopic(context.Background(), connID, name)
}

// DropOldestRecords takes a bounded batch off the head of each partition and
// returns how many it actually removed - which is not always what was asked
// for, because a partition holding less gives up only what it has.
func (s *KafkaService) DropOldestRecords(connID int, name string, limit int) (int, error) {
	return s.service.DropOldestRecords(context.Background(), connID, name, limit)
}

// ElectPreferredLeaders puts each partition's leadership back on the first
// broker in its replica list, which is where Kafka put it when the topic was
// created and where a broker restart moves it away from.
func (s *KafkaService) ElectPreferredLeaders(connID int) error {
	return s.service.ElectPreferredLeaders(context.Background(), connID)
}

// Reassignments reports the partitions being moved between brokers right now.
func (s *KafkaService) Reassignments(connID int) ([]*model.PartitionReassignment, error) {
	return s.service.Reassignments(context.Background(), connID)
}

// Reassign rewrites where one partition's replicas live. The order matters:
// the first broker becomes the preferred leader.
func (s *KafkaService) Reassign(connID int, topic string, partition int32, brokers []int32) error {
	return s.service.Reassign(context.Background(), connID, topic, partition, brokers)
}

// CancelReassignment stops a move in flight, leaving the partition wherever it
// has got to.
func (s *KafkaService) CancelReassignment(connID int, topic string, partition int32) error {
	return s.service.CancelReassignment(context.Background(), connID, topic, partition)
}

// QuotaView is the quotas page in one answer.
type QuotaView struct {
	Quotas []*model.ClientQuota `json:"quotas"`

	// EntityTypes and Limits are what a quota may be built from. The entity
	// types are a closed set because Kafka's are; the limits are the four
	// worth naming rather than all there are, because a cluster knows keys
	// this build has never heard of.
	EntityTypes []string `json:"entityTypes"`
	Limits      []string `json:"limits"`
}

// Quotas reports the limits attached to clients rather than to topics.
func (s *KafkaService) Quotas(connID int) (*QuotaView, error) {
	quotas, err := s.service.Quotas(context.Background(), connID)
	if err != nil {
		return nil, err
	}
	return &QuotaView{
		Quotas:      quotas,
		EntityTypes: kafkadriver.KnownQuotaEntityTypes(),
		Limits:      kafkadriver.KnownQuotaLimits(),
	}, nil
}

// AlterQuota sets the limits in set and removes the keys in remove.
func (s *KafkaService) AlterQuota(
	connID int, entity []model.QuotaEntity, set map[string]float64, remove []string,
) error {
	return s.service.AlterQuota(context.Background(), connID, entity, set, remove)
}

// RemoveQuota clears every limit on an entity, which is how a quota stops
// existing.
func (s *KafkaService) RemoveQuota(connID int, entity []model.QuotaEntity, keys []string) error {
	return s.service.RemoveQuota(context.Background(), connID, entity, keys)
}
