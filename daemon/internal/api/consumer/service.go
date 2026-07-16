package consumer

import "github.com/amigoer/rocket-leaf/daemon/internal/model"

// Service defines the consumer operations required by the HTTP transport.
type Service interface {
	GetConsumerGroups() ([]*model.ConsumerGroupItem, error)
	GetConsumerGroupDetail(string) (*model.ConsumerGroupItem, error)
	GetConsumeStats(string) (map[string]interface{}, error)
	CreateConsumerGroup(string, string, string, int) error
	UpdateConsumerGroup(string, string, string, int) error
	DeleteConsumerGroup(string, string) error
	ResetOffset(string, string, int64, bool) error
}
