package model

// Namespace is one isolated world inside a broker.
//
// A RabbitMQ virtual host is not a label: queues, exchanges, bindings, policies
// and permissions all live inside one and nothing crosses between them, so two
// vhosts can hold a queue of the same name that have nothing to do with each
// other. That is why it is a page rather than a filter.
//
// The word is Namespace because the canonical vocabulary already uses it - a
// destination's Ref carries one - and RabbitMQ is the only family so far whose
// namespaces are objects you can create.
type Namespace struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	// Tags are free labels the operator sets, not the broker.
	Tags []string `json:"tags"`
	// DefaultQueueType is what a queue declared here without a type becomes.
	// Setting it to quorum is how a cluster stops accumulating classic queues
	// by accident.
	DefaultQueueType string `json:"defaultQueueType"`
	// Tracing writes every message through this vhost to a log exchange. It is
	// expensive and is meant to be switched on for minutes, not left on.
	Tracing bool `json:"tracing"`

	// Messages is what its queues are collectively holding, split the same way
	// a queue's depth is.
	Messages       int64 `json:"messages"`
	Ready          int64 `json:"ready"`
	Unacknowledged int64 `json:"unacknowledged"`

	// Limits caps the vhost as a whole - max-connections, max-queues. Absent
	// means uncapped, which is the default and is worth distinguishing from a
	// limit of zero.
	Limits map[string]int `json:"limits"`

	// Attributes carries family-specific detail, the same way Node and
	// Destination do. A NATS account is an isolation boundary with none of a
	// vhost's furniture: no queue type to default, nothing to trace, and
	// instead a system-account flag, a JetStream footprint and a note of how
	// many servers the figures came from.
	Attributes map[string]string `json:"attributes"`
}

// NamespaceSpec creates or updates a namespace.
type NamespaceSpec struct {
	Name             string   `json:"name"`
	Description      string   `json:"description"`
	Tags             []string `json:"tags"`
	DefaultQueueType string   `json:"defaultQueueType"`
	Tracing          bool     `json:"tracing"`
}
