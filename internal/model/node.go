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

	// Attributes carries family-specific detail the canonical header has no
	// field for, the same way Node and Destination do. Kafka's health is
	// counted in partitions - under-replicated, offline, leaderless - which no
	// other family has and which is the whole reason its overview exists.
	Attributes map[string]string `json:"attributes"`
}

// Attribute returns a driver-specific field.
func (o *ClusterOverview) Attribute(key string) string {
	return o.Attributes[key]
}

// MaintenanceTask is a housekeeping job a node can be asked to run now.
//
// The set is closed rather than a free-form command string: these reclaim disk
// and cannot be undone, so what the UI can trigger has to be enumerable and
// reviewable, not whatever a caller types.
type MaintenanceTask string

const (
	// TaskCleanExpiredQueues drops consume queues whose messages have already
	// aged out of the log. Safe: it removes only what is already unreadable.
	TaskCleanExpiredQueues MaintenanceTask = "cleanExpiredQueues"

	// TaskCleanUnusedTopics drops queue files for topics no longer in the
	// route table. A topic deleted moments ago may still be in use by a
	// producer that has not refreshed its route.
	TaskCleanUnusedTopics MaintenanceTask = "cleanUnusedTopics"

	// TaskDeleteExpiredLogs forces the commit log retention sweep to run now
	// instead of at its scheduled hour. This is the destructive one: it
	// deletes message data that is past retention but may still be within
	// what someone expected to be able to replay.
	TaskDeleteExpiredLogs MaintenanceTask = "deleteExpiredLogs"
)

// Destructive reports whether a task removes message data rather than only
// reclaiming what is already unreachable. The UI confirms those differently.
func (t MaintenanceTask) Destructive() bool {
	return t == TaskDeleteExpiredLogs
}

// KnownMaintenanceTasks lists every task, for a UI that offers them.
func KnownMaintenanceTasks() []MaintenanceTask {
	return []MaintenanceTask{
		TaskCleanExpiredQueues,
		TaskCleanUnusedTopics,
		TaskDeleteExpiredLogs,
	}
}
