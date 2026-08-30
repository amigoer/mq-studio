package model

// GroupStatus is the consumer group status.
type GroupStatus string

const (
	GroupOnline  GroupStatus = "online"
	GroupWarning GroupStatus = "warning"
	GroupOffline GroupStatus = "offline"
)

// ConsumeMode is the consume mode.
type ConsumeMode string

const (
	// ModeUnknown is a group whose message model nobody has reported yet.
	// Only a connected client knows it, so an idle group keeps this.
	ModeUnknown      ConsumeMode = ""
	ModeClustering   ConsumeMode = "CLUSTERING"
	ModeBroadcasting ConsumeMode = "BROADCASTING"
)

// GroupSubscription is a subscription relationship.
type GroupSubscription struct {
	Topic      string `json:"topic"`      // Topic name
	Expression string `json:"expression"` // Filter expression
	ConsumeTps int    `json:"consumeTps"` // Consume TPS
}

// GroupClient holds consumer client information.
type GroupClient struct {
	ClientID      string `json:"clientId"`      // Client ID
	IP            string `json:"ip"`            // IP address
	Version       string `json:"version"`       // Version
	LastHeartbeat string `json:"lastHeartbeat"` // Last heartbeat time
}

// ConsumerGroupItem holds consumer group information.
type ConsumerGroupItem struct {
	ID            int                 `json:"id"`            // Consumer group ID
	Group         string              `json:"group"`         // Consumer group name
	Cluster       string              `json:"cluster"`       // Cluster name
	ConsumeMode   ConsumeMode         `json:"consumeMode"`   // Consume mode
	Status        GroupStatus         `json:"status"`        // Status
	OnlineClients int                 `json:"onlineClients"` // Online client count
	TopicCount    int                 `json:"topicCount"`    // Subscribed Topic count
	Lag           int64               `json:"lag"`           // Message lag
	RetryQps      int                 `json:"retryQps"`      // Retry QPS
	DLQ           int                 `json:"dlq"`           // Dead-letter count
	MaxRetry      int                 `json:"maxRetry"`      // Max retry times
	LastUpdate    string              `json:"lastUpdate"`    // Last update time
	Remark        string              `json:"remark"`        // Remark
	Subscriptions []GroupSubscription `json:"subscriptions"` // Subscription list
	Clients       []GroupClient       `json:"clients"`       // Client list
}

// ConsumerGroupConfig holds consumer group create/update configuration.
type ConsumerGroupConfig struct {
	Group            string      `json:"group"`            // Consumer group name
	Cluster          string      `json:"cluster"`          // Cluster name
	BrokerAddr       string      `json:"brokerAddr"`       // Broker address
	ConsumeMode      ConsumeMode `json:"consumeMode"`      // Consume mode
	MaxRetry         int         `json:"maxRetry"`         // Max retry times
	ConsumeFromWhere string      `json:"consumeFromWhere"` // Consume start position
	Topics           []string    `json:"topics"`           // Subscribed Topic list
	Remark           string      `json:"remark"`           // Remark
}

// ResetOffsetRequest is a request to reset offsets.
type ResetOffsetRequest struct {
	Group     string `json:"group"`     // Consumer group name
	Topic     string `json:"topic"`     // Topic name
	Timestamp int64  `json:"timestamp"` // Timestamp (milliseconds)
	Force     bool   `json:"force"`     // Whether to force reset
}
