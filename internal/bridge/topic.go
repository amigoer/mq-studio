package bridge

import (
	"github.com/amigoer/rocket-leaf/internal/model"
	"github.com/amigoer/rocket-leaf/internal/service/topic"
)

// TopicService exposes RocketMQ topic operations to the frontend.
type TopicService struct {
	service *topic.Service
}

// TopicInput carries a topic form submission.
type TopicInput struct {
	Topic      string `json:"topic"`
	BrokerAddr string `json:"brokerAddr"`
	ReadQueue  int    `json:"readQueue"`
	WriteQueue int    `json:"writeQueue"`
	Perm       string `json:"perm"`
}

// List returns the user-visible topics.
func (s *TopicService) List() ([]*model.TopicItem, error) {
	return s.service.GetTopics()
}

// ListAll returns every topic, including system topics.
func (s *TopicService) ListAll() ([]*model.TopicItem, error) {
	return s.service.GetAllTopics()
}

// Detail returns a single topic with its routes and metrics.
func (s *TopicService) Detail(topicName string) (*model.TopicItem, error) {
	return s.service.GetTopicDetail(topicName)
}

// Stats returns the per-queue statistics for a topic.
func (s *TopicService) Stats(topicName string) (map[string]interface{}, error) {
	return s.service.GetTopicStats(topicName)
}

// Create adds a topic on the target broker.
func (s *TopicService) Create(input TopicInput) error {
	return s.service.CreateTopic(input.Topic, input.BrokerAddr, input.ReadQueue, input.WriteQueue, input.Perm)
}

// Update changes the configuration of an existing topic.
func (s *TopicService) Update(input TopicInput) error {
	return s.service.UpdateTopic(input.Topic, input.BrokerAddr, input.ReadQueue, input.WriteQueue, input.Perm)
}

// Remove deletes a topic from the cluster.
func (s *TopicService) Remove(topicName string, clusterName string) error {
	return s.service.DeleteTopic(topicName, clusterName)
}
