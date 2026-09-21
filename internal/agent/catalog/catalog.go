// Package catalog describes the operations a connection can be asked to
// perform, in a form something other than the renderer can read.
//
// The capability model answers whether an endpoint can do a thing. That is
// what the UI gates on, and it is not enough for a caller that has to compose
// the call itself: it says nothing about what the operation takes, how much
// damage it can do, or which family-specific keys travel inside the attribute
// map. This package adds exactly those three columns and nothing else.
//
// What it deliberately does not do is restate the request and result shapes.
// Those are declared once in internal/model, with the json tags they already
// cross the bridge under, so an operation names the type rather than copying
// its fields - a second copy is a second thing to keep in step, and family
// lists in this repository have gone stale that way before.
//
// The catalogue is not a tool list. It does not know about transports, and
// nothing here decides which operations a caller is allowed to see; that is
// the server's job, and it filters on Blast.
package catalog

import (
	"fmt"
	"reflect"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

// Blast is how much an operation can destroy, which is the one thing a caller
// composing a call from a description cannot infer from the description.
//
// The three values are separated by what they cost to get wrong, not by HTTP
// verb. Reading a queue can still have a consequence - a RabbitMQ browse goes
// through basic.get and alters queue state - but the consequence is recorded
// as a caveat on the capability, not as a higher blast radius: nothing is
// lost, and a caller that refused every operation with a caveat could not
// read a RabbitMQ queue at all.
type Blast string

const (
	// BlastRead changes nothing the broker will still be holding afterwards.
	BlastRead Blast = "read"
	// BlastMutate changes configuration or position. It can be put back,
	// given knowledge of what it was.
	BlastMutate Blast = "mutate"
	// BlastDestructive discards messages, deletes an object, or evicts a
	// client. There is no undo, and the data is not somewhere else.
	BlastDestructive Blast = "destructive"
)

// Param is one loose argument of a port method that takes no request struct.
//
// Where a method does take one, the operation names that type in Request
// instead: a struct in internal/model already carries the field names and the
// json tags, and restating them here would be the copy this package exists to
// avoid.
type Param struct {
	Name     string
	Type     reflect.Type
	Required bool
	Summary  string
}

// Operation is one thing a connection can be asked to do.
type Operation struct {
	// ID is stable and dotted, and it is what a caller names. It is not the
	// method name: several ports answer the same noun.
	ID string

	// Capability is what gates it, and it is one of the constants in
	// internal/model. The UI hides, disables or renders a control on the same
	// value, which is what keeps this package from offering more than the
	// application does.
	Capability model.Capability

	// Port is the interface in internal/driver that carries Method, and
	// Method is the method itself. Together they are checked against the
	// table CheckConformance enforces, so an operation cannot claim a
	// capability whose interface does not carry it.
	Port   string
	Method string

	Blast   Blast
	Summary string

	// Exactly one of Params and Request is set, unless the method takes
	// nothing but a context.
	Params  []Param
	Request reflect.Type

	// Result is nil when the method returns only an error.
	Result reflect.Type

	// CarriesAttributes marks a Request with a family escape hatch in it -
	// DestinationSpec.Attributes and its kin. What may go in there is declared
	// per family in attributes.go, because it is the one part of a request
	// that is not family-neutral.
	CarriesAttributes bool
}

// Resolved is an operation as it stands on one live connection.
type Resolved struct {
	Operation

	// Caveat is what the connection said about this capability: a consequence
	// that survives the operation succeeding. It is read from the connection
	// rather than written here, because the same operation carries different
	// consequences on different endpoints.
	Caveat string
}

// For returns the operations a connection supports, with its own caveats
// attached.
//
// It selects on the declared capability alone - the same gate the UI uses -
// and not on a type assertion against the port. The two agree because
// CheckConformance makes a disagreement a test failure; asserting here as
// well would be a second copy of that rule, and the wrong one to trust.
func For(conn driver.Conn) []Resolved {
	capabilities := conn.Capabilities()
	resolved := make([]Resolved, 0, len(Operations))
	for _, operation := range Operations {
		if !capabilities.Has(operation.Capability) {
			continue
		}
		caveat, _ := capabilities.Caveat(operation.Capability)
		resolved = append(resolved, Resolved{Operation: operation, Caveat: caveat})
	}
	return resolved
}

// CheckCoverage reports every way the catalogue and a connection disagree.
// An empty result means they match.
//
// The failure it exists to catch is a capability a driver declares and this
// package has no operation for: the page is in the sidebar, the user can work
// it, and a caller reading the catalogue cannot see that the endpoint offers
// it at all. Every driver's conformance test calls this beside
// CheckConformance, so a new port lands with its operations or not at all.
func CheckCoverage(conn driver.Conn) []error {
	covered := make(map[model.Capability]bool, len(Operations))
	for _, operation := range Operations {
		covered[operation.Capability] = true
	}

	capabilities := conn.Capabilities()
	problems := make([]error, 0)
	for _, capability := range capabilities.Supported {
		if !covered[capability] {
			problems = append(problems, fmt.Errorf(
				"%s: declares %s and the catalogue has no operation for it",
				conn.Kind(), capability))
		}
	}

	// A degraded capability must yield nothing. The UI explains its absence
	// where the control would be; a caller with no UI would instead be handed
	// an operation the endpoint answers with an error.
	for _, operation := range For(conn) {
		if _, degraded := capabilities.DegradedReason(operation.Capability); degraded {
			problems = append(problems, fmt.Errorf(
				"%s: %s is degraded but the catalogue still offers %s",
				conn.Kind(), operation.Capability, operation.ID))
		}
	}
	return problems
}

// rank orders the blast radii by what they cost to get wrong, which is the
// order an allowance widens in.
var rank = map[Blast]int{BlastRead: 0, BlastMutate: 1, BlastDestructive: 2}

// Permits reports whether an allowance covers an operation's blast radius.
//
// The allowance is a ceiling rather than a set: somebody who will let an agent
// delete a queue is not thereby refusing it permission to publish, and a
// caller that had to name each tier separately would eventually name them
// wrongly.
//
// An unknown blast radius is permitted by nothing. A new tier must be placed
// deliberately, and until it is, the safe answer is no.
func Permits(allowed, blast Blast) bool {
	ceiling, known := rank[allowed]
	if !known {
		return false
	}
	level, known := rank[blast]
	return known && level <= ceiling
}

// Find returns the operation with an id. It is how a caller that knows the id
// reaches the blast radius and the summary without walking the table.
func Find(id string) (Operation, bool) {
	for _, operation := range Operations {
		if operation.ID == id {
			return operation, true
		}
	}
	return Operation{}, false
}
