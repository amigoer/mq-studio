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

	// Replicas is how far each follower of this node trails it, where the
	// family replicates. Empty on a follower, and on a leader with none.
	//
	// Canonical rather than an attribute because every replicating family has
	// the question - RocketMQ slaves, Kafka ISR, RabbitMQ quorum members - and
	// "is a replica falling behind" is the one thing a cluster page is opened
	// to answer during an incident.
	//
	// Filled only by NodeDetail: it costs a request per node, which a list
	// should not pay.
	Replicas []ReplicaStatus `json:"replicas"`

	// Attributes carries family-specific detail the canonical page renders
	// through the driver's own column set: RocketMQ master/slave role and
	// CommitLog usage, Kafka controller and ISR, RabbitMQ disc/ram node type.
	Attributes map[string]string `json:"attributes"`
}

// ReplicaStatus is one follower's replication state.
type ReplicaStatus struct {
	Address string `json:"address"`

	// BehindBytes is how far this replica trails the leader's log. Zero means
	// caught up; UnknownMetric means the family reports no such figure.
	BehindBytes int64 `json:"behindBytes"`

	// InSync is the family's own verdict, which is not simply BehindBytes == 0:
	// a replica can be a little behind and still count as in sync.
	InSync bool `json:"inSync"`
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
