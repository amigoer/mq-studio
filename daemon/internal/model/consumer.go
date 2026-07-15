package model

// GroupStatus 消费者组状态
type GroupStatus string

const (
	GroupOnline  GroupStatus = "online"
	GroupWarning GroupStatus = "warning"
	GroupOffline GroupStatus = "offline"
)

// ConsumeMode 消费模式
type ConsumeMode string

const (
	ModeClustering   ConsumeMode = "CLUSTERING"
	ModeBroadcasting ConsumeMode = "BROADCASTING"
)

// GroupSubscription 订阅关系
type GroupSubscription struct {
	Topic      string `json:"topic"`      // Topic 名称
	Expression string `json:"expression"` // 过滤表达式
	ConsumeTps int    `json:"consumeTps"` // 消费 TPS
}

// GroupClient 消费者客户端信息
type GroupClient struct {
	ClientID      string `json:"clientId"`      // 客户端ID
	IP            string `json:"ip"`            // IP 地址
	Version       string `json:"version"`       // 版本号
	LastHeartbeat string `json:"lastHeartbeat"` // 最后心跳时间
}

// ConsumerGroupItem 消费者组信息
type ConsumerGroupItem struct {
	ID            int                 `json:"id"`            // 消费者组ID
	Group         string              `json:"group"`         // 消费者组名称
	Cluster       string              `json:"cluster"`       // 所属集群
	ConsumeMode   ConsumeMode         `json:"consumeMode"`   // 消费模式
	Status        GroupStatus         `json:"status"`        // 状态
	OnlineClients int                 `json:"onlineClients"` // 在线客户端数
	TopicCount    int                 `json:"topicCount"`    // 订阅 Topic 数
	Lag           int64               `json:"lag"`           // 堆积量
	RetryQps      int                 `json:"retryQps"`      // 重试 QPS
	DLQ           int                 `json:"dlq"`           // 死信数量
	MaxRetry      int                 `json:"maxRetry"`      // 最大重试次数
	LastUpdate    string              `json:"lastUpdate"`    // 最后更新时间
	Remark        string              `json:"remark"`        // 备注
	Subscriptions []GroupSubscription `json:"subscriptions"` // 订阅关系列表
	Clients       []GroupClient       `json:"clients"`       // 客户端列表
}

// ConsumerGroupConfig 消费者组创建/更新配置
type ConsumerGroupConfig struct {
	Group            string      `json:"group"`            // 消费者组名称
	Cluster          string      `json:"cluster"`          // 集群名称
	BrokerAddr       string      `json:"brokerAddr"`       // Broker 地址
	ConsumeMode      ConsumeMode `json:"consumeMode"`      // 消费模式
	MaxRetry         int         `json:"maxRetry"`         // 最大重试次数
	ConsumeFromWhere string      `json:"consumeFromWhere"` // 消费起始位置
	Topics           []string    `json:"topics"`           // 订阅的 Topic 列表
	Remark           string      `json:"remark"`           // 备注
}

// ResetOffsetRequest 重置位点请求
type ResetOffsetRequest struct {
	Group     string `json:"group"`     // 消费者组名称
	Topic     string `json:"topic"`     // Topic 名称
	Timestamp int64  `json:"timestamp"` // 时间戳(毫秒)
	Force     bool   `json:"force"`     // 是否强制重置
}
