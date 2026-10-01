// Package toolset is what an agent can do with the application's connections,
// whatever carries the call.
//
// The MCP server offers these tools to an agent outside the window, and the
// window's own assistant will offer the same ones to a model it calls itself.
// Neither re-implements an operation. Each adapts these to its caller - how a
// call arrives, how far it may go, who is asked before anything is destroyed -
// and everything about the operation itself, from the capability check to the
// words an answer is given in, is decided here once.
package toolset

import (
	"context"
	"fmt"
	"time"

	"github.com/amigoer/mq-studio/internal/agent/catalog"
	"github.com/amigoer/mq-studio/internal/app"
	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

// Env is what the tools run against: the application's services, and the
// choices a transport makes about the connections a call names.
type Env struct {
	Services *app.Services
	// Translate resolves the i18n keys the capability model carries into the
	// language the application is set to. Injected because the translations
	// live with the renderer's, and only the composition root can reach them.
	Translate func(string) string
	// Open resolves the connection a call names. Nil uses only the connections
	// this process already holds, which is what the window needs: a dial from
	// there records no status, and queues the user's own connects behind it.
	// The MCP server dials what its own process has not opened yet.
	Open func(id int) (driver.Conn, error)
	// Allow is how far calls may go on a connection. Nil is read only.
	Allow func(id int) catalog.Blast
	// Offered names the tool that performs each catalogue operation, among the
	// tools the transport registered.
	Offered map[string]string
}

// Caller is who a call comes from, as far as a tool's answer depends on it.
type Caller struct {
	// Confirms is whether the caller can put a question to a person before a
	// destructive call. A tool it cannot use is not one to point it at.
	Confirms bool
}

type callerKey struct{}

// WithCaller returns ctx carrying the caller a transport identified.
func WithCaller(ctx context.Context, caller Caller) context.Context {
	return context.WithValue(ctx, callerKey{}, caller)
}

func callerOf(ctx context.Context) Caller {
	caller, _ := ctx.Value(callerKey{}).(Caller)
	return caller
}

// conn resolves a connection id the way the transport chose to.
func (e *Env) conn(id int) (driver.Conn, error) {
	if e.Open != nil {
		return e.Open(id)
	}
	conn, err := e.Services.Conns(id)
	if err != nil {
		return nil, fmt.Errorf("connection %d: %w; it has to be connected in the window first", id, err)
	}
	return conn, nil
}

func (e *Env) allow(id int) catalog.Blast {
	if e.Allow == nil {
		return catalog.BlastRead
	}
	return e.Allow(id)
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
func (e *Env) capable(id int, capability model.Capability) (driver.Conn, string, error) {
	conn, err := e.conn(id)
	if err != nil {
		return nil, "", err
	}
	capabilities := conn.Capabilities()
	if capabilities.Has(capability) {
		caveat, _ := capabilities.Caveat(capability)
		return conn, e.say(caveat), nil
	}
	if reason, degraded := capabilities.DegradedReason(capability); degraded {
		return nil, "", fmt.Errorf(
			"this %s endpoint cannot do %s: %s", conn.Kind(), capability, e.say(reason))
	}
	return nil, "", fmt.Errorf(
		"%s has no concept of %s, so there is nothing to ask it for", conn.Kind(), capability)
}

/*
 * say resolves what a driver declared into something a caller can read.
 *
 * Every caveat and every degraded reason in this application is an i18n key,
 * because the window has to show them in the reader's language. A caller with
 * no window would otherwise be handed mq.rabbitmq.caveat.browseAltersQueue and
 * have no way to find out that it means the browse alters the queue.
 */
func (e *Env) say(key string) string {
	if key == "" || e.Translate == nil {
		return key
	}
	return e.Translate(key)
}

// withTimeout bounds one tool call the way the application bounds one page
// load: the user's own request timeout, read fresh so a change in the window
// reaches a process that has been running for days.
func (e *Env) withTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	milliseconds := e.Services.Settings.GetSettings().RequestTimeoutMs
	if milliseconds <= 0 {
		milliseconds = int(defaultRequestTimeout / time.Millisecond)
	}
	return context.WithTimeout(ctx, time.Duration(milliseconds)*time.Millisecond)
}

// defaultRequestTimeout applies only when the stored settings carry none,
// which normalisation should prevent.
const defaultRequestTimeout = 30 * time.Second

// limit falls back to the page size the application itself reads with, so a
// caller that does not care gets the same amount a person would see.
func (e *Env) limit(requested int) int {
	if requested > 0 {
		return requested
	}
	return e.Services.Messages.FetchLimit()
}
