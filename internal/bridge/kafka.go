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
