// Package driver defines the port every broker family implements.
//
// A Driver describes a family and opens connections to it. A Conn is one live
// connection. Everything beyond ping and close is optional and discovered by
// type assertion against the interfaces in ports.go, so a family that cannot
// enumerate destinations simply does not implement DestinationAdmin.
//
// The rule that keeps the two halves honest: what a Conn declares in
// Capabilities must match the interfaces it implements. CheckConformance
// asserts that, and every driver's tests call it.
package driver

import (
	"context"

	"github.com/amigoer/mq-studio/internal/model"
)

// Driver is one broker family.
type Driver interface {
	Kind() model.MQKind

	// Descriptor is static: the connection form and the family's best-case
	// capabilities. It must be available with no connection open, because the
	// connection form is drawn from it before anything is dialled.
	Descriptor() model.DriverDescriptor

	// Open dials the endpoint in profile and returns a live connection.
	Open(ctx context.Context, profile model.ConnectionProfile) (Conn, error)
}

// Conn is one live connection to one broker.
//
// Implementations must be safe for concurrent use: the renderer fires
// independent page refreshes, and the background collector samples on its own
// timer.
type Conn interface {
	Kind() model.MQKind

	// Ping reports whether the endpoint is still answering.
	Ping(ctx context.Context) error

	// Capabilities is what this endpoint can do, which may be narrower than
	// the descriptor. A RocketMQ Proxy endpoint answers far less than a
	// NameServer one, and the difference is only knowable once connected.
	Capabilities() model.Capabilities

	// Close releases the underlying client. It must tolerate being called
	// more than once.
	Close() error
}
