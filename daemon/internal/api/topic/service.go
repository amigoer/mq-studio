package topic

import "github.com/amigoer/rocket-leaf/daemon/internal/model"

// Service defines the topic operations required by the HTTP transport.
type Service interface {
	GetTopics() ([]*model.TopicItem, error)
	GetAllTopics() ([]*model.TopicItem, error)
	GetTopicDetail(string) (*model.TopicItem, error)
	GetTopicStats(string) (map[string]interface{}, error)
	CreateTopic(string, string, int, int, string) error
	UpdateTopic(string, string, int, int, string) error
	DeleteTopic(string, string) error
}
