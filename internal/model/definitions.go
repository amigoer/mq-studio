package model

// The kinds of object a definitions document carries, as keys in its count
// map. They are stable identifiers the renderer labels rather than sentences.
const (
	DefinitionVhosts      = "vhosts"
	DefinitionUsers       = "users"
	DefinitionPermissions = "permissions"
	DefinitionQueues      = "queues"
	DefinitionExchanges   = "exchanges"
	DefinitionBindings    = "bindings"
	DefinitionPolicies    = "policies"
	DefinitionParameters  = "parameters"
)

// Definitions is a broker's whole topology, minus the messages.
//
// It is the only backup RabbitMQ offers of anything but message data, and it
// is what a cluster is rebuilt from: virtual hosts, users and permissions,
// queues, exchanges, bindings, policies and parameters in one document.
type Definitions struct {
	// Namespace is set when the export was scoped to one virtual host, and
	// empty for a whole-broker export.
	Namespace string `json:"namespace"`
	// Document is the JSON itself, laid out for reading.
	Document string `json:"document"`
	// Counts is what it contains, by kind. It is what makes an otherwise
	// opaque file reviewable before it is applied somewhere else.
	Counts map[string]int `json:"counts"`
}
