package model

// BrokerCensus is a broker-wide snapshot: how many of each object exists, how
// much is sitting in queues, and how fast messages are moving through.
//
// It is separate from ClusterOverview because the two answer different
// questions. ClusterOverview is the topology - how many nodes, how many are
// up - and every family has one. This is the broker's own running total, which
// only a family with a single endpoint that aggregates the cluster can report;
// RabbitMQ's management API is one, and RocketMQ has no counterpart.
//
// Counts a family does not report carry UnknownMetric rather than zero, so the
// page renders an em dash instead of a measurement that was never taken.
type BrokerCensus struct {
	ClusterName    string `json:"clusterName"`
	Version        string `json:"version"`
	RuntimeVersion string `json:"runtimeVersion"`

	Queues      int `json:"queues"`
	Exchanges   int `json:"exchanges"`
	Connections int `json:"connections"`
	Channels    int `json:"channels"`
	Consumers   int `json:"consumers"`

	// Ready is deliverable now, Unacknowledged is with a consumer that has not
	// acked yet. Total is what the broker holds and is not always their sum:
	// it counts messages in states neither covers.
	Ready          int64 `json:"ready"`
	Unacknowledged int64 `json:"unacknowledged"`
	Total          int64 `json:"total"`

	Rates BrokerRates `json:"rates"`
}

// BrokerRates is messages per second, as the broker computes them over its own
// sampling window rather than as anything measured here.
type BrokerRates struct {
	Publish   float64 `json:"publish"`
	Deliver   float64 `json:"deliver"`
	Ack       float64 `json:"ack"`
	Redeliver float64 `json:"redeliver"`
	// Unroutable is publishes that matched no binding. It has no counterpart
	// in a family that publishes straight to a destination, and it is the
	// first thing worth knowing when messages "disappear" on a topology whose
	// bindings are wrong.
	Unroutable float64 `json:"unroutable"`
}
