package model

// PublishRequest is a message as a send console collects it.
//
// It is not the canonical MessagePublisher's shape and cannot be. That takes a
// topic, tags, keys and a delay level, which is RocketMQ's vocabulary: a
// RabbitMQ message goes to an exchange with a routing key, carries a table of
// headers and a fixed set of AMQP properties, and has no tags or delay at all.
type PublishRequest struct {
	Namespace string `json:"namespace"`
	// Exchange empty is the default exchange, which routes by queue name -
	// so an empty exchange with a routing key publishes straight to the queue
	// of that name.
	Exchange   string `json:"exchange"`
	RoutingKey string `json:"routingKey"`
	Body       string `json:"body"`

	// Persistent decides whether the message survives a broker restart. A
	// transient message on a durable queue is still lost with the node.
	Persistent bool `json:"persistent"`
	// Mandatory asks the broker to hand the message back rather than drop it
	// when nothing is bound to take it. Without it an unroutable publish is
	// still confirmed, so a send console that did not set it would report
	// success for a message that no longer exists.
	Mandatory bool `json:"mandatory"`

	Headers map[string]string `json:"headers"`

	ContentType   string `json:"contentType"`
	CorrelationID string `json:"correlationId"`
	ReplyTo       string `json:"replyTo"`
	MessageID     string `json:"messageId"`
	Type          string `json:"type"`
	AppID         string `json:"appId"`
	// Expiration is a per-message TTL in milliseconds, as a string, which is
	// how AMQP carries it.
	Expiration string `json:"expiration"`
	// Priority is only honoured on a queue declared with x-max-priority.
	Priority int `json:"priority"`

	// Count sends the same message more than once, for generating load or
	// filling a queue to test a consumer.
	Count int `json:"count"`
}

// PublishResult is what the broker said about the send.
//
// Confirmed and Routed are different facts and the difference is the whole
// point of this type. A confirm means the broker took responsibility for the
// message; routing means something was bound to receive it. An unroutable
// publish is confirmed and then dropped, so a page reporting only the confirm
// would call that a success.
type PublishResult struct {
	// Sent is how many the broker confirmed.
	Sent int `json:"sent"`
	// Unroutable is how many it handed back because nothing was bound. They
	// were not delivered anywhere, and on a mandatory publish that is the only
	// way to find out.
	Unroutable int `json:"unroutable"`
	// Reason is the broker's own words for the last message handed back.
	Reason string `json:"reason"`
}
