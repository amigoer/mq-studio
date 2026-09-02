package model

// DeadLetterQueue is a queue that receives what other queues could not keep.
//
// It is not the shape DeadLetterReader describes, and that is the point.
// RocketMQ gives every consumer group a dead-letter topic of its own, named
// after it, so a group name is enough to find one. RabbitMQ has no such thing:
// a queue is declared with a dead-letter exchange, that exchange routes like
// any other, and whatever it routes to becomes a dead-letter queue by
// convention rather than by declaration. Finding one means walking the
// topology backwards.
type DeadLetterQueue struct {
	Namespace string `json:"namespace"`
	// Name is the queue dead letters land in. It has no special status on the
	// broker - it is an ordinary queue that something else points at.
	Name  string `json:"name"`
	Depth int64  `json:"depth"`
	// Consumers is how many are draining it. A dead-letter queue with a
	// consumer is a retry pipeline; one without is a backlog nobody is
	// looking at, which is the case worth surfacing.
	Consumers int `json:"consumers"`

	// Sources are the queues whose dead-letter exchange routes here, and the
	// reason this queue matters. A dead-letter queue with no sources is one
	// whose producers were deleted or reconfigured, and it will never receive
	// anything again.
	Sources []*DeadLetterSource `json:"sources"`
}

// DeadLetterSource is one queue that dead-letters into another.
type DeadLetterSource struct {
	Queue string `json:"queue"`
	// Subscription is which reader of the source queue dead-lettered, where
	// the family attaches the policy to a subscriber rather than to the queue.
	// A Pulsar dead-letter topic is named "<topic>-<subscription>-DLQ", so
	// without this the page could name the topic and not who gave up on it -
	// and one topic read by five subscriptions has five separate answers.
	//
	// Empty on RabbitMQ, where the policy belongs to the queue itself.
	Subscription string `json:"subscription"`
	// Exchange is what the source queue was declared to dead-letter through.
	Exchange string `json:"exchange"`
	// RoutingKey is the key the message is re-published with. Empty means the
	// message keeps its original routing key, which is the default and changes
	// where it lands.
	RoutingKey string `json:"routingKey"`
}
