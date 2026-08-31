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
