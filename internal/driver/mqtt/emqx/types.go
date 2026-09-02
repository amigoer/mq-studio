package emqx

// The shapes EMQX answers with.
//
// Only the fields this app reads are declared. EMQX sends around fifty per
// client and adds more between minor versions, so listing them all would be a
// contract to keep up with rather than a description of what is used.
//
// Every field here was checked against a running broker rather than against
// the documentation: `username` is null rather than absent for an anonymous
// client, `proto_ver` is the wire number and not a version string, and the
// timestamps are RFC 3339 with an offset.

// Node is one member of the cluster.
type Node struct {
	Node    string `json:"node"`
	Version string `json:"version"`
	Role    string `json:"role"`
	Status  string `json:"node_status"`
	Edition string `json:"edition"`
	// Uptime is milliseconds since the node started.
	Uptime          int64   `json:"uptime"`
	Connections     int64   `json:"connections"`
	LiveConnections int64   `json:"live_connections"`
	Sessions        int64   `json:"cluster_sessions"`
	MemoryUsed      string  `json:"memory_used"`
	MemoryTotal     string  `json:"memory_total"`
	Load1           float64 `json:"load1"`
	Load5           float64 `json:"load5"`
	Load15          float64 `json:"load15"`
	OTPRelease      string  `json:"otp_release"`
	SysPath         string  `json:"sys_path"`
}

// Stats is one node's current counts.
//
// The JSON names carry dots, which are part of the key rather than nesting -
// EMQX sends a flat object with keys like "connections.count".
type Stats struct {
	Node                 string `json:"node"`
	ConnectionsCount     int64  `json:"connections.count"`
	ConnectionsMax       int64  `json:"connections.max"`
	LiveConnectionsCount int64  `json:"live_connections.count"`
	SessionsCount        int64  `json:"sessions.count"`
	SessionsMax          int64  `json:"sessions.max"`
	SubscriptionsCount   int64  `json:"subscriptions.count"`
	SubscriptionsMax     int64  `json:"subscriptions.max"`
	SubscriptionsShared  int64  `json:"subscriptions.shared.count"`
	SubscribersCount     int64  `json:"subscribers.count"`
	TopicsCount          int64  `json:"topics.count"`
	RoutesCount          int64  `json:"routes.count"`
	RetainedCount        int64  `json:"retained.count"`
	DelayedCount         int64  `json:"delayed.count"`
}

// Metrics is one node's running totals.
type Metrics struct {
	Node             string `json:"node"`
	BytesReceived    int64  `json:"bytes.received"`
	BytesSent        int64  `json:"bytes.sent"`
	MessagesReceived int64  `json:"messages.received"`
	MessagesSent     int64  `json:"messages.sent"`
	MessagesDropped  int64  `json:"messages.dropped"`
	PacketsReceived  int64  `json:"packets.received"`
	PacketsSent      int64  `json:"packets.sent"`
	ClientAuthzDeny  int64  `json:"client.authorize.deny"`
}

// ClientInfo is one connected client, or one session that outlived its
// connection.
type ClientInfo struct {
	ClientID string `json:"clientid"`
	// Username is null for an anonymous client, which is why it is a pointer:
	// the zero string would be indistinguishable from a client that
	// authenticated as "".
	Username  *string `json:"username"`
	Node      string  `json:"node"`
	IPAddress string  `json:"ip_address"`
	Port      int     `json:"port"`
	Connected bool    `json:"connected"`
	// ProtoVer is the wire number: 4 is MQTT 3.1.1 and 5 is MQTT 5.0.
	ProtoVer         int    `json:"proto_ver"`
	ProtoName        string `json:"proto_name"`
	ConnectedAt      string `json:"connected_at"`
	DisconnectedAt   string `json:"disconnected_at"`
	Keepalive        int    `json:"keepalive"`
	CleanStart       bool   `json:"clean_start"`
	ExpiryInterval   int64  `json:"expiry_interval"`
	SubscriptionsCnt int    `json:"subscriptions_cnt"`
	InflightCnt      int    `json:"inflight_cnt"`
	MqueueLen        int    `json:"mqueue_len"`
	MqueueDropped    int64  `json:"mqueue_dropped"`
	RecvMsg          int64  `json:"recv_msg"`
	SendMsg          int64  `json:"send_msg"`
	RecvOct          int64  `json:"recv_oct"`
	SendOct          int64  `json:"send_oct"`
	Listener         string `json:"listener"`
	IsPersistent     bool   `json:"is_persistent"`
	Durable          bool   `json:"durable"`
}

// Subscription is one topic filter a client holds.
type Subscription struct {
	ClientID string `json:"clientid"`
	Node     string `json:"node"`
	Topic    string `json:"topic"`
	QoS      int    `json:"qos"`
	// The three 5.0 subscription options, as the numbers the wire carries.
	NoLocal           int  `json:"nl"`
	RetainAsPublished int  `json:"rap"`
	RetainHandling    int  `json:"rh"`
	Durable           bool `json:"durable"`
}

// RetainedMessage is one topic's stored last-known value.
//
// The payload is deliberately not read: the listing is a topic list, and a
// broker holding a megabyte under each of ten thousand topics would serialise
// all of it to answer one page.
type RetainedMessage struct {
	Topic      string `json:"topic"`
	QoS        int    `json:"qos"`
	MessageID  string `json:"msgid"`
	FromClient string `json:"from_clientid"`
	PublishAt  string `json:"publish_at"`
}
