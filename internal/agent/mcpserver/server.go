// Package mcpserver exposes the application's connections to an external agent
// over MCP.
//
// It is a sibling of internal/bridge, not a layer on top of it. Both adapt the
// same *app.Services to a caller that cannot call Go directly; the bridge
// reshapes for the renderer, and this reshapes for a caller that has no screen
// and has to be told what an operation costs.
//
// How far it goes is decided when it is started, not here and not in the
// application's settings. An allowance is a ceiling on the blast radius the
// catalogue gives each operation: read by default, and nothing above it is
// offered at all - a tool that is not in the list cannot be called by a model
// that has not been told about it, which is a stronger guarantee than one that
// refuses at call time.
//
// It never writes the profile store. The window owns that file and rewrites it
// whole, so a second process that stamped a status onto it would be racing the
// user's own edits - see connection.Service.OpenReadOnly.
package mcpserver

import (
	"context"
	"fmt"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/amigoer/mq-studio/internal/agent/catalog"
	"github.com/amigoer/mq-studio/internal/app"
	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

// Name is what the server calls itself in the initialize handshake.
const Name = "mq-studio"

// instructions is what the client is told at handshake, before it has called
// anything.
//
// It says the one thing that cannot be discovered from a tool list: what a
// connection can do is a property of the endpoint, not of its family, and
// asking is cheaper than finding out from a failure.
const instructions = "Work the message brokers this installation has connections for. " +
	"Start with connections_list, then capabilities_describe on the connection you mean to use: " +
	"two endpoints of the same family can answer differently, what one can do is only knowable " +
	"once connected, and for anything you intend to create it also names the settings that " +
	"family accepts. Results carry a caveat when an operation has a consequence that survives " +
	"it succeeding - reading a RabbitMQ queue alters that queue's state, and emptying a Kafka " +
	"topic leaves its offsets counting. How far this server goes was decided when it was " +
	"started: what is not in the tool list was not permitted, and asking for it will not change that."

// server holds what the tools need. The domain services do the work; this
// only resolves connections and turns a refusal into something a caller can
// act on.
type server struct {
	services *app.Services
	// offered maps a catalogue operation to the tool that performs it, for
	// the tools this server actually registered. capabilities_describe reads
	// it, so what it names is what the caller can really call - an operation
	// the allowance kept out is reported as available on the endpoint and
	// reachable by no tool, which is the truth.
	offered map[string]string
}

// New builds the MCP server offering every tool up to the allowance.
//
// An unrecognised allowance offers nothing above reading, because
// catalog.Permits refuses what it does not know: a typo in a flag must not
// widen anything.
func New(services *app.Services, version string, allow catalog.Blast) *mcp.Server {
	s := &server{services: services, offered: offeredTools(allow)}
	mcpServer := mcp.NewServer(&mcp.Implementation{
		Name:    Name,
		Title:   "MQ Studio",
		Version: version,
	}, &mcp.ServerOptions{Instructions: instructions})
	s.register(mcpServer, allow)
	return mcpServer
}

/*
 * annotate turns a blast radius into the protocol's hints.
 *
 * Derived rather than written per tool, because these are the same fact twice
 * and the copy a client reads is this one. A tool whose annotation said read
 * while the catalogue said destructive would be trusted precisely where it
 * should not be.
 *
 * The world is closed everywhere here: a broker this installation has a stored
 * connection for is a named thing, not an open-ended search.
 */
func annotate(title string, blast catalog.Blast) *mcp.ToolAnnotations {
	closedWorld := false
	destructive := blast == catalog.BlastDestructive
	return &mcp.ToolAnnotations{
		Title:           title,
		ReadOnlyHint:    blast == catalog.BlastRead,
		DestructiveHint: &destructive,
		OpenWorldHint:   &closedWorld,
	}
}

// conn resolves a connection id, dialling it if this process has not yet.
//
// A caller names a connection by the id connections_list gave it and should
// not have to open one first: the window's idea of online is about the window,
// and this process has its own connections either way.
func (s *server) conn(id int) (driver.Conn, error) {
	if conn, err := s.services.Conns(id); err == nil {
		return conn, nil
	}
	if err := s.services.Connections.OpenReadOnly(id); err != nil {
		return nil, fmt.Errorf("connection %d could not be opened: %w", id, err)
	}
	conn, err := s.services.Conns(id)
	if err != nil {
		return nil, fmt.Errorf("connection %d opened and then could not be found: %w", id, err)
	}
	return conn, nil
}

/*
 * capable resolves a connection and checks one capability on it.
 *
 * The three states the application draws have to survive the trip out. A
 * supported capability answers. One the endpoint cannot do answers with the
 * driver's own reason, because "this RocketMQ endpoint is a Proxy, which has
 * no topic listing" is something a caller can act on and "unsupported" is not.
 * One the family has no concept of says that instead, so a caller stops
 * looking for it rather than retrying.
 *
 * The caveat comes back beside the connection rather than as an error: it is
 * a consequence of the operation succeeding, and it travels in the result.
 */
func (s *server) capable(id int, capability model.Capability) (driver.Conn, string, error) {
	conn, err := s.conn(id)
	if err != nil {
		return nil, "", err
	}
	capabilities := conn.Capabilities()
	if capabilities.Has(capability) {
		caveat, _ := capabilities.Caveat(capability)
		return conn, caveat, nil
	}
	if reason, degraded := capabilities.DegradedReason(capability); degraded {
		return nil, "", fmt.Errorf(
			"this %s endpoint cannot do %s: %s", conn.Kind(), capability, reason)
	}
	return nil, "", fmt.Errorf(
		"%s has no concept of %s, so there is nothing to read here", conn.Kind(), capability)
}

// withTimeout bounds one tool call the way the application bounds one page
// load: the user's own request timeout, read fresh so a change in the window
// reaches a server that has been running for days.
func (s *server) withTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	milliseconds := s.services.Settings.GetSettings().RequestTimeoutMs
	if milliseconds <= 0 {
		milliseconds = int(defaultRequestTimeout / time.Millisecond)
	}
	return context.WithTimeout(ctx, time.Duration(milliseconds)*time.Millisecond)
}

// defaultRequestTimeout applies only when the stored settings carry none,
// which normalisation should prevent.
const defaultRequestTimeout = 30 * time.Second
