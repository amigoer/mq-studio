package model

// TopicPerm is the Topic permission.
type TopicPerm string

const (
	PermRW   TopicPerm = "RW"
	PermR    TopicPerm = "R"
	PermW    TopicPerm = "W"
	PermDeny TopicPerm = "DENY"
)

// TopicMessageType is the message type.
type TopicMessageType string

const (
	MessageTypeNormal TopicMessageType = "Normal"
	MessageTypeFIFO   TopicMessageType = "FIFO"
	MessageTypeDelay  TopicMessageType = "Delay"
)

// TopicRouteItem is a Topic route entry.
type TopicRouteItem struct {
	Broker     string    `json:"broker"`     // Broker name
	BrokerAddr string    `json:"brokerAddr"` // Broker address
	ReadQueue  int       `json:"readQueue"`  // Read queue count
	WriteQueue int       `json:"writeQueue"` // Write queue count
	Perm       TopicPerm `json:"perm"`       // Permission
}

// TopicItem holds Topic information.
type TopicItem struct {
	ID             int              `json:"id"`             // Topic ID
	Topic          string           `json:"topic"`          // Topic name
	Cluster        string           `json:"cluster"`        // Cluster name
	ReadQueue      int              `json:"readQueue"`      // Read queue count
	WriteQueue     int              `json:"writeQueue"`     // Write queue count
	Perm           TopicPerm        `json:"perm"`           // Permission
	MessageType    TopicMessageType `json:"messageType"`    // Message type
	ConsumerGroups int              `json:"consumerGroups"` // Consumer group count
	// Subscribers names the groups behind ConsumerGroups. Only a per-topic
	// lookup fills it: the list enrichment asks for the count alone.
	Subscribers []string         `json:"subscribers"`
	TpsIn       int              `json:"tpsIn"`       // Inbound TPS
	TpsOut      int              `json:"tpsOut"`      // Outbound TPS
	LastUpdated string           `json:"lastUpdated"` // Last update time
	Description string           `json:"description"` // Description
	Routes      []TopicRouteItem `json:"routes"`      // Route information
}

// TopicConfig holds Topic create/update configuration.
type TopicConfig struct {
	Topic       string           `json:"topic"`       // Topic name
	Cluster     string           `json:"cluster"`     // Cluster name
	BrokerAddr  string           `json:"brokerAddr"`  // Broker address
	ReadQueue   int              `json:"readQueue"`   // Read queue count
	WriteQueue  int              `json:"writeQueue"`  // Write queue count
	Perm        TopicPerm        `json:"perm"`        // Permission
	MessageType TopicMessageType `json:"messageType"` // Message type
	Description string           `json:"description"` // Description
}

// PermToInt converts a permission to its integer code.
func PermToInt(perm TopicPerm) int {
	switch perm {
	case PermRW:
		return 6 // Read-write
	case PermR:
		return 4 // Read-only
	case PermW:
		return 2 // Write-only
	case PermDeny:
		return 0 // Denied
	default:
		return 6
	}
}

// IntToPerm converts an integer code to a permission.
func IntToPerm(perm int) TopicPerm {
	switch perm {
	case 6:
		return PermRW
	case 4:
		return PermR
	case 2:
		return PermW
	case 0:
		return PermDeny
	default:
		return PermRW
	}
}
