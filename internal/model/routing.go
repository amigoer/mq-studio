package model

// Binding is a route from an exchange to a queue or another exchange.
//
// Only RabbitMQ has first-class bindings, which is why the canonical page set
// has no counterpart for them and the driver contributes a page of its own.
type Binding struct {
	ID          int    `json:"id"` // list key for the renderer
	Namespace   string `json:"namespace"`
	Source      string `json:"source"`
	Destination string `json:"destination"`
	// DestinationKind separates a queue target from an exchange target; the
	// same source and name can bind to both.
	DestinationKind string            `json:"destinationKind"`
	RoutingKey      string            `json:"routingKey"`
	Arguments       map[string]string `json:"arguments"`

	// PropertiesKey is the broker's own identifier for this binding, and the
	// only way to delete one. A binding has no name, and the same source,
	// destination and routing key can exist more than once with different
	// arguments - so anything a caller made up would delete a different
	// binding or none. It comes back with the listing.
	PropertiesKey string `json:"propertiesKey"`
}

// ExchangeSpec declares an exchange.
//
// Transient rather than Durable, so the zero value is the safe one: an
// exchange that survives a restart. A transient exchange disappears with the
// node and takes its bindings with it.
type ExchangeSpec struct {
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	// Type is direct, fanout, topic or headers, and cannot be changed once
	// declared.
	Type       string `json:"type"`
	Transient  bool   `json:"transient"`
	AutoDelete bool   `json:"autoDelete"`
	// Arguments as JSON, so alternate-exchange and anything a plugin
	// understands arrive with their types intact.
	Arguments string `json:"arguments"`
}
