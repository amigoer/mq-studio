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

// TailCursor is where a tail has read to, per partition.
//
// An empty cursor means "start at the end": a tail opens on what arrives next
// rather than replaying what is already stored, which is what the message
// query is for.
type TailCursor struct {
	Positions []QueuePosition `json:"positions"`
}

// QueuePosition is one partition's place in a tail.
type QueuePosition struct {
	Node    string `json:"node"` // the broker holding it
	QueueID int    `json:"queueId"`
	Offset  int64  `json:"offset"`
}

// TailBatch is one poll's worth of a tail.
type TailBatch struct {
	// Messages are oldest first, which is the order a tail appends in.
	Messages []*MessageItem `json:"messages"`

	// Cursor is what to pass next time. It advances even when no message came
	// back, because a partition can move on without this tail matching any.
	Cursor TailCursor `json:"cursor"`

	// Dropped counts messages that aged out of the log between two polls -
	// a tail slower than the retention it is watching. Reporting it is the
	// difference between a quiet tail and one that is silently losing.
	Dropped int64 `json:"dropped"`
}

// ReplayRequest asks one connected consumer to handle a message again, now.
//
// It names a client rather than a group because that is the point: a group
// would hand the message to whichever member the rebalance picked, and the
// question being asked is why one particular consumer chokes on it.
type ReplayRequest struct {
	Subscription string `json:"subscription"`
	ClientID     string `json:"clientId"`
	Destination  string `json:"destination"`
	MessageID    string `json:"messageId"`
}

// ReplayResult is what that consumer's own handler returned.
//
// This is not a delivery receipt: the broker forwarded the message and the
// client ran its listener, so a failure here is the application's, reported
// back verbatim in Remark.
type ReplayResult struct {
	Result  string `json:"result"`
	Remark  string `json:"remark"`
	SpentMs int64  `json:"spentMs"`

	// Ordered and AutoCommit describe how the client was configured to consume,
	// which changes what a failure means: an ordered consumer blocks its queue
	// on one it cannot handle.
	Ordered    bool `json:"ordered"`
	AutoCommit bool `json:"autoCommit"`
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
