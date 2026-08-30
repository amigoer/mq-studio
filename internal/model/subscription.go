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

// SubscriptionClient is what one connected consumer is actually doing.
//
// It is separate from the client list a Subscription carries because the two
// answer different questions and cost different things. The list says who is
// connected, and comes back with the group. This is a round trip to that one
// client, so it is fetched when someone asks about it.
type SubscriptionClient struct {
	ClientID string `json:"clientId"`

	// Assignments is which queues this client currently holds. It is the
	// answer to "why is one consumer behind and the others idle", which a
	// group-level backlog cannot give.
	Assignments []QueueAssignment `json:"assignments"`

	// Throughput is per destination, because a client reading two topics can
	// be healthy on one and stalled on the other.
	Throughput []ConsumeThroughput `json:"throughput"`

	// Properties is what the client reports about itself - version, consume
	// mode, thread counts. Free-form because every family names them
	// differently and none of it is worth a canonical field.
	Properties map[string]string `json:"properties"`
}

// QueueAssignment is one queue a consumer holds, and how far behind it is.
type QueueAssignment struct {
	Destination string `json:"destination"`
	Node        string `json:"node"` // the broker holding this queue
	QueueID     int    `json:"queueId"`

	// Pending is what this client has buffered but not yet finished, which is
	// not the same as the group's backlog on the broker.
	Pending      int64 `json:"pending"`
	PendingBytes int64 `json:"pendingBytes"`

	LastPull    string `json:"lastPull"`
	LastConsume string `json:"lastConsume"`

	// Locked matters only where a family locks a queue to one consumer for
	// ordered delivery; Dropped means the client is releasing it in a rebalance.
	Locked  bool `json:"locked"`
	Dropped bool `json:"dropped"`
}

// ConsumeThroughput is one destination's consume rates for one client.
type ConsumeThroughput struct {
	Destination string `json:"destination"`

	PullLatencyMs    float64 `json:"pullLatencyMs"`
	PullRate         float64 `json:"pullRate"`
	ConsumeLatencyMs float64 `json:"consumeLatencyMs"`
	SuccessRate      float64 `json:"successRate"`
	FailureRate      float64 `json:"failureRate"`
	FailedMessages   int64   `json:"failedMessages"`
}

// ProducerClient is one connected publisher.
//
// There is no list of publishers the way there is of subscriptions: a broker
// tracks connections per producer group and offers no way to enumerate the
// groups, so a caller has to name one. That is why this is not a Producer
// type with a Ref - there is nothing to list, only something to look up.
type ProducerClient struct {
	ClientID string `json:"clientId"`
	Address  string `json:"address"`
	Language string `json:"language"`
	Version  string `json:"version"`
}
