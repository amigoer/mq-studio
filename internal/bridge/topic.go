package bridge

import (
	"context"

	"github.com/amigoer/mq-studio/internal/driver/rocketmq"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/destination"
)

// TopicService exposes destination operations to the frontend.
//
// It speaks the canonical model. What RocketMQ has and another family does
// not - queue counts, permissions, the route table - travels in the
// destination's attribute map, whose keys the frontend's rocketmq module
// reads.
type TopicService struct {
	service *destination.Service
}

// TopicInput carries a topic form submission.
type TopicInput struct {
	Topic      string `json:"topic"`
	BrokerAddr string `json:"brokerAddr"`
	ReadQueue  int    `json:"readQueue"`
	WriteQueue int    `json:"writeQueue"`
	Perm       string `json:"perm"`
}

func (input TopicInput) spec() model.DestinationSpec {
	return model.DestinationSpec{
		Ref: model.DestinationRef{Name: input.Topic},
		Attributes: map[string]string{
			"brokerAddr":            input.BrokerAddr,
			rocketmq.AttrReadQueue:  itoa(input.ReadQueue),
			rocketmq.AttrWriteQueue: itoa(input.WriteQueue),
			rocketmq.AttrPerm:       input.Perm,
		},
	}
}

// List returns the user-visible topics.
func (s *TopicService) List(connID int) ([]*model.Destination, error) {
	destinations, err := s.service.List(context.Background(), connID, model.DestinationFilter{})
	if err != nil {
		return nil, err
	}
	return destinations, nil
}

// ListAll returns every topic, including system topics.
func (s *TopicService) ListAll(connID int) ([]*model.Destination, error) {
	destinations, err := s.service.List(context.Background(), connID,
		model.DestinationFilter{IncludeInternal: true})
	if err != nil {
		return nil, err
	}
	return destinations, nil
}

// Stats returns the per-queue statistics for a topic.
func (s *TopicService) Stats(connID int, topicName string) (map[string]interface{}, error) {
	return s.service.Stats(context.Background(), connID, model.DestinationRef{Name: topicName})
}

// Create adds a topic on the target broker.
func (s *TopicService) Create(connID int, input TopicInput) error {
	return s.service.Create(context.Background(), connID, input.spec())
}

// Update changes the configuration of an existing topic.
func (s *TopicService) Update(connID int, input TopicInput) error {
	return s.service.Update(context.Background(), connID, input.spec())
}

// Remove deletes a topic from the cluster.
func (s *TopicService) Remove(connID int, topicName string, clusterName string) error {
	return s.service.Remove(context.Background(), connID,
		model.DestinationRef{Namespace: clusterName, Name: topicName})
}

// Detail returns one topic with the fields only a per-topic lookup can fill:
// its route table, and the outbound rate that costs one request per group.
func (s *TopicService) Detail(connID int, topicName string) (*model.Destination, error) {
	return s.service.Detail(context.Background(), connID,
		model.DestinationRef{Name: topicName})
}
