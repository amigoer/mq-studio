package model

// MessageStatus 消息状态
type MessageStatus string

const (
	MsgNormal MessageStatus = "normal"
	MsgRetry  MessageStatus = "retry"
	MsgDLQ    MessageStatus = "dlq"
)

// MessageItem 消息信息
type MessageItem struct {
	ID             int               `json:"id"`             // 消息序号
	Cluster        string            `json:"cluster"`        // 所属集群
	Topic          string            `json:"topic"`          // Topic 名称
	MessageID      string            `json:"messageId"`      // 消息ID
	Tags           string            `json:"tags"`           // 消息标签
	Keys           string            `json:"keys"`           // 消息Keys
	ProducerGroup  string            `json:"producerGroup"`  // 生产者组
	QueueID        int               `json:"queueId"`        // 队列ID
	QueueOffset    int64             `json:"queueOffset"`    // 队列偏移
	StoreHost      string            `json:"storeHost"`      // 存储节点
	BornHost       string            `json:"bornHost"`       // 生产节点
	StoreTime      string            `json:"storeTime"`      // 存储时间
	StoreTimestamp int64             `json:"storeTimestamp"` // 存储时间戳
	Status         MessageStatus     `json:"status"`         // 消息状态
	RetryTimes     int               `json:"retryTimes"`     // 重试次数
	Body           string            `json:"body"`           // 消息体
	Properties     map[string]string `json:"properties"`     // 消息属性
}

// MessageQueryParams 消息查询参数
type MessageQueryParams struct {
	Cluster    string `json:"cluster"`    // 集群名称
	Topic      string `json:"topic"`      // Topic 名称
	MessageID  string `json:"messageId"`  // 消息ID
	MessageKey string `json:"messageKey"` // 消息Key
	StartTime  int64  `json:"startTime"`  // 开始时间戳
	EndTime    int64  `json:"endTime"`    // 结束时间戳
	MaxResults int    `json:"maxResults"` // 最大返回数量
}

// MessageTrackItem 消息轨迹
type MessageTrackItem struct {
	ConsumerGroup string `json:"consumerGroup"` // 消费者组
	TrackType     string `json:"trackType"`     // 轨迹类型: CONSUMED / NOT_CONSUME_YET / CONSUMED_BUT_FILTERED / UNKNOWN
	ConsumeStatus string `json:"consumeStatus"` // 消费状态描述
	ExceptionDesc string `json:"exceptionDesc"` // 异常描述
}

// ResendMessageRequest 消息重投请求
type ResendMessageRequest struct {
	Topic      string `json:"topic"`      // Topic 名称
	MessageID  string `json:"messageId"`  // 消息ID
	BrokerAddr string `json:"brokerAddr"` // Broker 地址
}
