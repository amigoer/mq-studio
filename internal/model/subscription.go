package model

// SubscriptionStatus is the health of a subscription.
type SubscriptionStatus string

const (
	SubscriptionOnline  SubscriptionStatus = "online"
	SubscriptionWarning SubscriptionStatus = "warning"
	SubscriptionOffline SubscriptionStatus = "offline"
)

// SubscriptionRef identifies a consumer group, subscription or queue consumer.
type SubscriptionRef struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
}

// Subscription is a consumer group, a Pulsar subscription or a RabbitMQ queue
// consumer, as the canonical pages see it.
//
// Backlog is deliberately not called lag: RocketMQ and Kafka compute it from
// offsets, RabbitMQ reads ready plus unacknowledged, and Redis Stream reads
// XPENDING. The number means "messages still owed to this subscriber" in all
// three, but only the first two have an offset behind it — which is why
// resetting position is a separate capability.
type Subscription struct {
	ID  int             `json:"id"` // list key for the renderer, not broker data
	Ref SubscriptionRef `json:"ref"`

	Status       SubscriptionStatus `json:"status"`
	Members      int                `json:"members"`      // connected consumers
	Destinations int                `json:"destinations"` // how many it reads from
	Backlog      int64              `json:"backlog"`      // UnknownMetric when not reported
	RateOut      int                `json:"rateOut"`      // messages per second consumed

	LastUpdated string            `json:"lastUpdated"`
	Attributes  map[string]string `json:"attributes"`
}

// Attribute returns a driver-specific field.
func (s *Subscription) Attribute(key string) string {
	return s.Attributes[key]
}

// SubscriptionSpec is a create or update request.
type SubscriptionSpec struct {
	Ref        SubscriptionRef   `json:"ref"`
	Attributes map[string]string `json:"attributes"`
}
