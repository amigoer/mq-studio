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
// catalogue gives each operation: read by default, higher on the connections
// the person starting it named. Nothing above the widest is offered at all - a
// tool that is not in the list cannot be called by a model that has not been
// told about it, which is a stronger guarantee than one that refuses at call
// time. A tool within it is still refused on a connection whose own ceiling
// is lower, before anything is dialled.
//
// It never writes the profile store. The window owns that file and rewrites it
// whole, so a second process that stamped a status onto it would be racing the
// user's own edits - see connection.Service.OpenReadOnly.
package mcpserver

import (
	"context"
	"fmt"
	"sync"
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
	"topic leaves its offsets counting. A broker with no connection listed is added by the user in " +
	"the MQ Studio window, and can be used here as soon as it is saved there. How far this server " +
	"goes was decided when it was started, connection by connection, and connections_list says " +
	"how far each may go: what is not in the tool list was not permitted anywhere, a tool that " +
	"goes further than its connection may is refused on it, and asking will not change either."

// server holds what the tools need. The domain services do the work; this
// only resolves connections and turns a refusal into something a caller can
// act on.
type server struct {
	services *app.Services
	// translate resolves the i18n keys the capability model carries into the
	// language the application is set to. Injected because the translations
	// live with the renderer's, and only the composition root can reach them.
	translate func(string) string
	// grants is how far each connection may go.
	grants Grants
	// journal is the audit log every write is recorded in.
	journal *journal
	/*
	 * refreshMu is held for writing by the refresh before every call, and for
	 * reading by a call a grant was checked for, until it returns.
	 *
	 * The check reads the stored profile and the handler then dials by id, so
	 * a refresh landing in between - another call's, since calls run at once -
	 * could swap in a profile the window re-pointed, and the dial would go
	 * where the check never looked. Nothing may wait on the client while
	 * holding it: the client's next call would be waiting on this one.
	 */
	refreshMu sync.RWMutex
	// offered maps a catalogue operation to the tool that performs it, for
	// the tools this server actually registered. capabilities_describe reads
	// it, so what it names is what the caller can really call - an operation
	// the allowance kept out is reported as available on the endpoint and
	// reachable by no tool, which is the truth.
	offered map[string]string
}

// New builds the MCP server offering every tool some connection may use.
//
// An unrecognised ceiling offers nothing above reading, because
// catalog.Permits refuses what it does not know: a typo in a flag must not
// widen anything.
func New(
	services *app.Services, version string, grants Grants, translate func(string) string,
) *mcp.Server {
	s := &server{
		services:  services,
		translate: translate,
		grants:    grants,
		journal:   newJournal(auditPath(services)),
		offered:   offeredTools(grants.widest()),
	}
	mcpServer := mcp.NewServer(&mcp.Implementation{
		Name:    Name,
		Title:   "MQ Studio",
		Version: version,
	}, &mcp.ServerOptions{Instructions: instructions})
	s.register(mcpServer)
	mcpServer.AddReceivingMiddleware(s.refreshing)
	return mcpServer
}

/*
 * refreshing re-reads what the window has saved before every tool call.
 *
 * Every call rather than a timer: a connection the user has just saved in the
 * window is usable by the very next call, and a file that reads as it did
 * costs a read and a comparison. A call that cannot catch up fails rather than
 * answering from a copy that may list a connection the user deleted.
 */
func (s *server) refreshing(next mcp.MethodHandler) mcp.MethodHandler {
	return func(ctx context.Context, method string, request mcp.Request) (mcp.Result, error) {
		if method == "tools/call" {
			s.refreshMu.Lock()
			err := s.services.RefreshReadOnly()
			s.refreshMu.Unlock()
			if err != nil {
				result := &mcp.CallToolResult{}
				result.SetError(fmt.Errorf(
					"not called: %w, and answering from the copy read earlier could be wrong", err))
				return result, nil
			}
		}
		return next(ctx, method, request)
	}
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
		return conn, s.say(caveat), nil
	}
	if reason, degraded := capabilities.DegradedReason(capability); degraded {
		return nil, "", fmt.Errorf(
			"this %s endpoint cannot do %s: %s", conn.Kind(), capability, s.say(reason))
	}
	return nil, "", fmt.Errorf(
		"%s has no concept of %s, so there is nothing to read here", conn.Kind(), capability)
}

/*
 * say resolves what a driver declared into something a caller can read.
 *
 * Every caveat and every degraded reason in this application is an i18n key,
 * because the window has to show them in the reader's language. A caller with
 * no window would otherwise be handed mq.rabbitmq.caveat.browseAltersQueue and
 * have no way to find out that it means the browse alters the queue.
 */
func (s *server) say(key string) string {
	if key == "" || s.translate == nil {
		return key
	}
	return s.translate(key)
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
