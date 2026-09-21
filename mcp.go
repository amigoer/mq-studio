package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/amigoer/mq-studio/internal/agent/mcpserver"
	"github.com/amigoer/mq-studio/internal/app"
)

// mcpCommand is the argument that serves the tools instead of opening a
// window. It is a subcommand rather than a second binary so that a release
// ships one thing, and so the server can never be a version behind the
// application whose files it reads.
const mcpCommand = "mcp"

/*
 * runMCP serves the read-only tools over stdin and stdout.
 *
 * No window, no tray, no updater: none of them has anything to do here, and
 * the tray in particular would put an icon on screen for a process the user
 * started in a terminal.
 *
 * The services are the read-only assembly. This process does not own the
 * stored files - the window does, and it rewrites them whole - so nothing here
 * samples on a timer or dials the default profile on startup.
 */
func runMCP() error {
	// The protocol owns stdout: anything written there that is not a JSON-RPC
	// message ends the session. Go's logger already writes to stderr; saying
	// so here means a later change to it cannot quietly corrupt a session.
	log.SetOutput(os.Stderr)

	services, err := app.NewReadOnly()
	if err != nil {
		return err
	}
	defer services.Close()

	// A client that goes away closes stdin, which ends Run on its own. The
	// signals are for the other way out, and both paths reach the deferred
	// Close - connections this process opened are its own to shut.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	return mcpserver.New(services, version).Run(ctx, &mcp.StdioTransport{})
}
