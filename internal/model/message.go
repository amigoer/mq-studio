package model

// MessageStatus is the message status.
type MessageStatus string

const (
	MsgNormal MessageStatus = "normal"
	MsgRetry  MessageStatus = "retry"
	MsgDLQ    MessageStatus = "dlq"
)

// MessageItem holds message information.
type MessageItem struct {
	ID             int               `json:"id"`             // Message sequence number
	Cluster        string            `json:"cluster"`        // Cluster name
	Topic          string            `json:"topic"`          // Topic name
	MessageID      string            `json:"messageId"`      // Message ID
	Tags           string            `json:"tags"`           // Message tags
	Keys           string            `json:"keys"`           // Message keys
	QueueID        int               `json:"queueId"`        // Queue ID
	QueueOffset    int64             `json:"queueOffset"`    // Queue offset
	StoreHost      string            `json:"storeHost"`      // Store host
	BornHost       string            `json:"bornHost"`       // Born host
	StoreTime      string            `json:"storeTime"`      // Store time
	StoreTimestamp int64             `json:"storeTimestamp"` // Store timestamp
	Status         MessageStatus     `json:"status"`         // Message status
	RetryTimes     int               `json:"retryTimes"`     // Retry times
	Body           string            `json:"body"`           // Message body
	Properties     map[string]string `json:"properties"`     // Message properties
}

// MessageQueryParams holds message query parameters.
type MessageQueryParams struct {
	Cluster    string `json:"cluster"`    // Cluster name
	Topic      string `json:"topic"`      // Topic name
	MessageID  string `json:"messageId"`  // Message ID
	MessageKey string `json:"messageKey"` // Message key
	StartTime  int64  `json:"startTime"`  // Start timestamp
	EndTime    int64  `json:"endTime"`    // End timestamp
	MaxResults int    `json:"maxResults"` // Maximum result count

	// Filters narrows a search by something only one family has: a RocketMQ
	// tag, a Kafka header, a RabbitMQ routing key. The keys are a contract
	// between one driver and its frontend module.
	Filters map[string]string `json:"filters"`
}

// MessageTrackItem holds message track information.
type MessageTrackItem struct {
	ConsumerGroup string `json:"consumerGroup"` // Consumer group
	TrackType     string `json:"trackType"`     // Track type: CONSUMED / NOT_CONSUME_YET / CONSUMED_BUT_FILTERED / UNKNOWN
	ConsumeStatus string `json:"consumeStatus"` // Consume status description
	ExceptionDesc string `json:"exceptionDesc"` // Exception description
}

// ResendMessageRequest is a request to resend a message.
type ResendMessageRequest struct {
	Topic      string `json:"topic"`      // Topic name
	MessageID  string `json:"messageId"`  // Message ID
	BrokerAddr string `json:"brokerAddr"` // Broker address
}
