package bridge

import (
	"context"

	"github.com/amigoer/mq-studio/internal/driver/rocketmq"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/destination"
)

// TopicService exposes destination operations to the frontend.
//
// It still speaks model.TopicItem. Converting back from the canonical shape
// here keeps the renderer untouched through the backend refactor; the
// conversion goes away when the frontend moves onto model.Destination.
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

func topicsFrom(destinations []*model.Destination) []*model.TopicItem {
	topics := make([]*model.TopicItem, 0, len(destinations))
	for _, current := range destinations {
		topics = append(topics, rocketmq.TopicFromDestination(current))
	}
	return topics
}

// List returns the user-visible topics.
func (s *TopicService) List() ([]*model.TopicItem, error) {
	destinations, err := s.service.List(context.Background(), model.DestinationFilter{})
	if err != nil {
		return nil, err
	}
	return topicsFrom(destinations), nil
}

// ListAll returns every topic, including system topics.
func (s *TopicService) ListAll() ([]*model.TopicItem, error) {
	destinations, err := s.service.List(context.Background(),
		model.DestinationFilter{IncludeInternal: true})
	if err != nil {
		return nil, err
	}
	return topicsFrom(destinations), nil
}

// Detail returns a single topic with its routes and metrics.
func (s *TopicService) Detail(topicName string) (*model.TopicItem, error) {
	found, err := s.service.Detail(context.Background(), model.DestinationRef{Name: topicName})
	if err != nil {
		return nil, err
	}
	return rocketmq.TopicFromDestination(found), nil
}

// Stats returns the per-queue statistics for a topic.
func (s *TopicService) Stats(topicName string) (map[string]interface{}, error) {
	return s.service.Stats(context.Background(), model.DestinationRef{Name: topicName})
}

// Create adds a topic on the target broker.
func (s *TopicService) Create(input TopicInput) error {
	return s.service.Create(context.Background(), input.spec())
}

// Update changes the configuration of an existing topic.
func (s *TopicService) Update(input TopicInput) error {
	return s.service.Update(context.Background(), input.spec())
}

// Remove deletes a topic from the cluster.
func (s *TopicService) Remove(topicName string, clusterName string) error {
	return s.service.Remove(context.Background(),
		model.DestinationRef{Namespace: clusterName, Name: topicName})
}
