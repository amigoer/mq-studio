package model

// NodeStatus is the node status.
type NodeStatus string

const (
	NodeOnline  NodeStatus = "online"
	NodeWarning NodeStatus = "warning"
	NodeOffline NodeStatus = "offline"

	// NodeUnknown is a node whose health the family does not report. A
	// RocketMQ name server is one: the admin protocol names the addresses the
	// client dials and says nothing about whether each of them answers, and
	// calling that "online" would be inventing a check nobody ran.
	NodeUnknown NodeStatus = "unknown"
)

// BrokerRole is the Broker role.
type BrokerRole string

const (
	RoleMaster BrokerRole = "MASTER"
	RoleSlave  BrokerRole = "SLAVE"
)

// NameServerNode holds NameServer node information.
type NameServerNode struct {
	ID       int        `json:"id"`       // Node ID
	Cluster  string     `json:"cluster"`  // Cluster name
	Address  string     `json:"address"`  // Node address
	Version  string     `json:"version"`  // Version
	Status   NodeStatus `json:"status"`   // Node status
	LastSeen string     `json:"lastSeen"` // Last seen time
}

// BrokerNode holds Broker node information.
type BrokerNode struct {
	ID                    int        `json:"id"`                    // Node ID
	Cluster               string     `json:"cluster"`               // Cluster name
	BrokerName            string     `json:"brokerName"`            // Broker name
	BrokerID              int        `json:"brokerId"`              // Broker ID
	Role                  BrokerRole `json:"role"`                  // Role (MASTER/SLAVE)
	Address               string     `json:"address"`               // Primary address
	HAAddress             string     `json:"haAddress"`             // HA address
	Version               string     `json:"version"`               // Version
	Status                NodeStatus `json:"status"`                // Node status
	Topics                int        `json:"topics"`                // Topic count
	Groups                int        `json:"groups"`                // Consumer group count
	TpsIn                 int        `json:"tpsIn"`                 // Inbound TPS
	TpsOut                int        `json:"tpsOut"`                // Outbound TPS
	TpsHistoryTimestamps  []int64    `json:"tpsHistoryTimestamps"`  // Unix-second timestamps for TPS history
	TpsInHistory          []int      `json:"tpsInHistory"`          // Inbound TPS history
	TpsOutHistory         []int      `json:"tpsOutHistory"`         // Outbound TPS history
	MsgInToday            int64      `json:"msgInToday"`            // Messages in today
	MsgOutToday           int64      `json:"msgOutToday"`           // Messages out today
	CommitLogDiskUsage    int        `json:"commitLogDiskUsage"`    // CommitLog disk usage percent
	ConsumeQueueDiskUsage int        `json:"consumeQueueDiskUsage"` // ConsumeQueue disk usage percent
	LastUpdate            string     `json:"lastUpdate"`            // Last update time
	Remark                string     `json:"remark"`                // Remark
}

// ClusterInfo holds cluster overview information.
type ClusterInfo struct {
	ClusterName   string        `json:"clusterName"`   // Cluster name
	TotalBrokers  int           `json:"totalBrokers"`  // Total Broker count
	OnlineBrokers int           `json:"onlineBrokers"` // Online Broker count
	TotalTopics   int           `json:"totalTopics"`   // Total Topic count
	TotalGroups   int           `json:"totalGroups"`   // Total consumer group count
	AvgDiskUsage  int           `json:"avgDiskUsage"`  // Average disk usage percent
	NameServers   []string      `json:"nameServers"`   // NameServer list
	Brokers       []*BrokerNode `json:"brokers"`       // Broker list
}

// ClusterSummary holds cluster status summary for the frontend.
type ClusterSummary struct {
	TotalClusters  int `json:"totalClusters"`  // Cluster count
	TotalBrokers   int `json:"totalBrokers"`   // Total Broker count
	OnlineBrokers  int `json:"onlineBrokers"`  // Online Broker count
	WarningBrokers int `json:"warningBrokers"` // Warning Broker count
	OfflineBrokers int `json:"offlineBrokers"` // Offline Broker count
	AvgDiskUsage   int `json:"avgDiskUsage"`   // Average disk usage percent
}
