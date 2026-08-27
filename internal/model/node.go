package model

// Node is one broker, RabbitMQ node or Kafka broker as the canonical Cluster
// page sees it.
//
// It is deliberately thinner than BrokerNode: the TPS history arrays there are
// filled by the cluster service from local samples, not by any broker, so they
// stay out of what a driver has to produce.
type Node struct {
	ID      int    `json:"id"` // list key for the renderer, not broker data
	Name    string `json:"name"`
	Address string `json:"address"`
	Cluster string `json:"cluster"` // grouping label; empty where the family has none
	Version string `json:"version"`

	Status    NodeStatus `json:"status"`
	RateIn    int        `json:"rateIn"`    // messages per second in
	RateOut   int        `json:"rateOut"`   // messages per second out
	DiskUsage int        `json:"diskUsage"` // percent; UnknownMetric when not reported

	LastSeen string `json:"lastSeen"`

	// TPS history is sampled locally by the collector, not reported by any
	// broker, which is why a driver never fills these.
	TpsHistoryTimestamps []int64 `json:"tpsHistoryTimestamps"` // Unix seconds
	TpsInHistory         []int   `json:"tpsInHistory"`
	TpsOutHistory        []int   `json:"tpsOutHistory"`

	// Attributes carries family-specific detail the canonical page renders
	// through the driver's own column set: RocketMQ master/slave role and
	// CommitLog usage, Kafka controller and ISR, RabbitMQ disc/ram node type.
	Attributes map[string]string `json:"attributes"`
}

// Attribute returns a driver-specific field.
func (n *Node) Attribute(key string) string {
	return n.Attributes[key]
}

// ClusterOverview is the aggregate the Cluster page header shows.
type ClusterOverview struct {
	Name          string `json:"name"`
	TotalNodes    int    `json:"totalNodes"`
	OnlineNodes   int    `json:"onlineNodes"`
	Destinations  int    `json:"destinations"` // UnknownMetric when not enumerable
	Subscriptions int    `json:"subscriptions"`
	AvgDiskUsage  int    `json:"avgDiskUsage"` // percent; UnknownMetric when not reported
}
