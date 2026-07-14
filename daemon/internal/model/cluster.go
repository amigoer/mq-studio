package model

// NodeStatus 节点状态
type NodeStatus string

const (
	NodeOnline  NodeStatus = "online"
	NodeWarning NodeStatus = "warning"
	NodeOffline NodeStatus = "offline"
)

// BrokerRole Broker 角色
type BrokerRole string

const (
	RoleMaster BrokerRole = "MASTER"
	RoleSlave  BrokerRole = "SLAVE"
)

// NameServerNode NameServer 节点信息
type NameServerNode struct {
	ID       int        `json:"id"`       // 节点ID
	Cluster  string     `json:"cluster"`  // 所属集群
	Address  string     `json:"address"`  // 节点地址
	Version  string     `json:"version"`  // 版本号
	Status   NodeStatus `json:"status"`   // 节点状态
	LastSeen string     `json:"lastSeen"` // 最后可见时间
}

// BrokerNode Broker 节点信息
type BrokerNode struct {
	ID                    int        `json:"id"`                    // 节点ID
	Cluster               string     `json:"cluster"`               // 所属集群
	BrokerName            string     `json:"brokerName"`            // Broker 名称
	BrokerID              int        `json:"brokerId"`              // Broker ID
	Role                  BrokerRole `json:"role"`                  // 角色(MASTER/SLAVE)
	Address               string     `json:"address"`               // 主地址
	HAAddress             string     `json:"haAddress"`             // HA地址
	Version               string     `json:"version"`               // 版本号
	Status                NodeStatus `json:"status"`                // 节点状态
	Topics                int        `json:"topics"`                // Topic 数量
	Groups                int        `json:"groups"`                // 消费者组数量
	TpsIn                 int        `json:"tpsIn"`                 // 入流 TPS
	TpsOut                int        `json:"tpsOut"`                // 出流 TPS
	TpsInHistory          []int      `json:"tpsInHistory"`          // TPS 入流历史
	TpsOutHistory         []int      `json:"tpsOutHistory"`         // TPS 出流历史
	MsgInToday            int64      `json:"msgInToday"`            // 今日入消息量
	MsgOutToday           int64      `json:"msgOutToday"`           // 今日出消息量
	CommitLogDiskUsage    int        `json:"commitLogDiskUsage"`    // CommitLog 磁盘使用率
	ConsumeQueueDiskUsage int        `json:"consumeQueueDiskUsage"` // ConsumeQueue 磁盘使用率
	LastUpdate            string     `json:"lastUpdate"`            // 最后更新时间
	Remark                string     `json:"remark"`                // 备注
}

// ClusterInfo 集群概览信息
type ClusterInfo struct {
	ClusterName   string        `json:"clusterName"`   // 集群名称
	TotalBrokers  int           `json:"totalBrokers"`  // Broker 总数
	OnlineBrokers int           `json:"onlineBrokers"` // 在线 Broker 数
	TotalTopics   int           `json:"totalTopics"`   // Topic 总数
	TotalGroups   int           `json:"totalGroups"`   // 消费者组总数
	AvgDiskUsage  int           `json:"avgDiskUsage"`  // 平均磁盘使用率
	NameServers   []string      `json:"nameServers"`   // NameServer 列表
	Brokers       []*BrokerNode `json:"brokers"`       // Broker 列表
}

// ClusterSummary 集群状态概览（用于前端展示）
type ClusterSummary struct {
	TotalClusters  int `json:"totalClusters"`  // 集群数量
	TotalBrokers   int `json:"totalBrokers"`   // Broker 总数
	OnlineBrokers  int `json:"onlineBrokers"`  // 在线 Broker 数
	WarningBrokers int `json:"warningBrokers"` // 告警 Broker 数
	OfflineBrokers int `json:"offlineBrokers"` // 离线 Broker 数
	AvgDiskUsage   int `json:"avgDiskUsage"`   // 平均磁盘使用率
}
