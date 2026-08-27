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
}
