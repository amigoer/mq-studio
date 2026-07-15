package model

// TopicPerm Topic 权限
type TopicPerm string

const (
	PermRW   TopicPerm = "RW"
	PermR    TopicPerm = "R"
	PermW    TopicPerm = "W"
	PermDeny TopicPerm = "DENY"
)

// TopicMessageType 消息类型
type TopicMessageType string

const (
	MessageTypeNormal TopicMessageType = "Normal"
	MessageTypeFIFO   TopicMessageType = "FIFO"
	MessageTypeDelay  TopicMessageType = "Delay"
)

// TopicRouteItem Topic 路由条目
type TopicRouteItem struct {
	Broker     string    `json:"broker"`     // Broker 名称
	BrokerAddr string    `json:"brokerAddr"` // Broker 地址
	ReadQueue  int       `json:"readQueue"`  // 读队列数
	WriteQueue int       `json:"writeQueue"` // 写队列数
	Perm       TopicPerm `json:"perm"`       // 权限
}

// TopicItem Topic 信息
type TopicItem struct {
	ID             int              `json:"id"`             // Topic ID
	Topic          string           `json:"topic"`          // Topic 名称
	Cluster        string           `json:"cluster"`        // 所属集群
	ReadQueue      int              `json:"readQueue"`      // 读队列数
	WriteQueue     int              `json:"writeQueue"`     // 写队列数
	Perm           TopicPerm        `json:"perm"`           // 权限
	MessageType    TopicMessageType `json:"messageType"`    // 消息类型
	ConsumerGroups int              `json:"consumerGroups"` // 消费者组数量
	TpsIn          int              `json:"tpsIn"`          // 入流 TPS
	TpsOut         int              `json:"tpsOut"`         // 出流 TPS
	LastUpdated    string           `json:"lastUpdated"`    // 最后更新时间
	Description    string           `json:"description"`    // 描述
	Routes         []TopicRouteItem `json:"routes"`         // 路由信息
}

// TopicConfig Topic 创建/更新配置
type TopicConfig struct {
	Topic       string           `json:"topic"`       // Topic 名称
	Cluster     string           `json:"cluster"`     // 集群名称
	BrokerAddr  string           `json:"brokerAddr"`  // Broker 地址
	ReadQueue   int              `json:"readQueue"`   // 读队列数
	WriteQueue  int              `json:"writeQueue"`  // 写队列数
	Perm        TopicPerm        `json:"perm"`        // 权限
	MessageType TopicMessageType `json:"messageType"` // 消息类型
	Description string           `json:"description"` // 描述
}

// PermToInt 将权限转换为整数
func PermToInt(perm TopicPerm) int {
	switch perm {
	case PermRW:
		return 6 // 读写权限
	case PermR:
		return 4 // 只读
	case PermW:
		return 2 // 只写
	case PermDeny:
		return 0 // 禁止
	default:
		return 6
	}
}

// IntToPerm 将整数转换为权限
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
