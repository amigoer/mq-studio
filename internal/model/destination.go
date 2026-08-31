package model

// UnknownMetric marks a numeric field no broker reported, so the UI renders
// "—" instead of an invented zero. A destination that genuinely has no
// partitions and one whose partition count failed to load are different
// things and must not look alike.
const UnknownMetric = -1

// DestinationRef identifies a destination across families.
//
// Flat families leave Namespace empty; Pulsar fills tenant/namespace and
// RabbitMQ fills the vhost. It is a struct rather than a string because
// joining and re-splitting those parts loses information for any name that
// contains the separator.
type DestinationRef struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
}

// Destination is a topic, queue or stream as the canonical pages see it.
//
// Attributes carries whatever the family has and the canonical model does not:
// RocketMQ permissions and queue counts, RabbitMQ durability and queue type,
// Kafka replication factor. Its keys are a contract between one driver's Go
// side and that driver's frontend module, not part of the shared vocabulary.
type Destination struct {
	ID  int            `json:"id"` // list key for the renderer, not broker data
	Ref DestinationRef `json:"ref"`

	Partitions  int   `json:"partitions"`  // UnknownMetric where the family has none
	Subscribers int   `json:"subscribers"` // consumer groups, subscriptions or consumers
	Depth       int64 `json:"depth"`       // messages held; UnknownMetric when not reported
	RateIn      int   `json:"rateIn"`      // messages per second in
	RateOut     int   `json:"rateOut"`     // messages per second out

	LastUpdated string            `json:"lastUpdated"`
	Attributes  map[string]string `json:"attributes"`
}

// Attribute returns a driver-specific field.
func (d *Destination) Attribute(key string) string {
	return d.Attributes[key]
}

// DestinationSpec is a create or update request.
type DestinationSpec struct {
	Ref        DestinationRef    `json:"ref"`
	Partitions int               `json:"partitions"` // ignored where unsupported
	Attributes map[string]string `json:"attributes"`
}

// DestinationFilter narrows a destination listing.
//
// IncludeInternal covers the objects every family hides by default and names
// differently: RocketMQ system topics, RabbitMQ amq.* exchanges, Kafka's
// __consumer_offsets.
type DestinationFilter struct {
	Namespace       string `json:"namespace"`
	IncludeInternal bool   `json:"includeInternal"`
}

// MoveRequest drains one queue into an exchange.
//
// The target is an exchange and a routing key rather than a queue, because
// that is how a message enters RabbitMQ at all: publishing straight to a queue
// means publishing to the default exchange with the queue's name as the key,
// which the caller can ask for explicitly.
type MoveRequest struct {
	Namespace string `json:"namespace"`
	From      string `json:"from"`
	// ToExchange may be empty, which is the default exchange - it routes by
	// queue name, so an empty exchange with a routing key sends straight to
	// the queue of that name.
	ToExchange string `json:"toExchange"`
	// ToRoutingKey empty means each message keeps its own, which is what sends
	// a batch back through the topology it originally took.
	ToRoutingKey string `json:"toRoutingKey"`
	// Limit caps one run. Moving is one round trip per message, so a page
	// asks for a batch rather than for a whole backlog.
	Limit int `json:"limit"`
}
