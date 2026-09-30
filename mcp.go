package main

import (
	"context"
	"flag"
	"fmt"
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
 * allowance reads how far the server may go from the command line, and only
 * from there.
 *
 * Not a setting in the application. The person who decides an agent may empty
 * a queue is the person starting it, at the moment they start it, with the
 * task in front of them - not whoever clicked a switch some weeks ago and has
 * since forgotten it is on. It is also why the default is the narrowest one:
 * a flag nobody passed cannot have meant anything.
 *
 * Anything left over after the flags is refused rather than ignored:
 * "--allow destructive scratch" reads like a grant on scratch, and would
 * otherwise have been one on every connection.
 */
func allowance(arguments []string) (mcpserver.Allowance, error) {
	flags := flag.NewFlagSet(mcpCommand, flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	var values []string
	flags.Func("allow",
		"how far the tools may go: read, mutate or destructive on every connection, "+
			"or <connection>=<tier> on one; repeat it to name more",
		func(value string) error {
			values = append(values, value)
			return nil
		})
	if err := flags.Parse(arguments); err != nil {
		return mcpserver.Allowance{}, err
	}
	if flags.NArg() > 0 {
		return mcpserver.Allowance{}, fmt.Errorf(
			"%q is not a flag; a connection is allowed further as --allow <name>=<tier>", flags.Arg(0))
	}
	return mcpserver.ParseAllowance(values)
}

/*
 * runMCP serves the tools over stdin and stdout.
 *
 * No window, no tray, no updater: none of them has anything to do here, and
 * the tray in particular would put an icon on screen for a process the user
 * started in a terminal.
 *
 * The services are the read-only assembly. This process does not own the
 * stored files - the window does, and it rewrites them whole - so nothing here
 * samples on a timer or dials the default profile on startup.
 */
func runMCP(arguments []string) error {
	allow, err := allowance(arguments)
	if err != nil {
		return err
	}

	// The protocol owns stdout: anything written there that is not a JSON-RPC
	// message ends the session. Go's logger already writes to stderr; saying
	// so here means a later change to it cannot quietly corrupt a session.
	log.SetOutput(os.Stderr)

	services, err := app.NewReadOnly()
	if err != nil {
		return err
	}
	defer services.Close()

	// Names are pinned to the connections stored now, not looked up again on
	// every call: see Allowance.Grant.
	grants, err := allow.Grant(services.Connections.GetConnections())
	if err != nil {
		return err
	}

	// A client that goes away closes stdin, which ends Run on its own. The
	// signals are for the other way out, and both paths reach the deferred
	// Close - connections this process opened are its own to shut.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Said on stderr, where it reaches the person who started this and not the
	// protocol. A server that quietly went further than its operator meant is
	// the failure this whole tier exists to prevent.
	log.Printf("[mcp] serving with tools up to %s", grants)

	// The application's own language, so the consequences read the way they do
	// on screen rather than in whatever the server happened to default to.
	translate := livePhrasebook(func() string { return services.Settings.GetSettings().Language })

	return mcpserver.New(services, version, grants, translate).Run(ctx, &mcp.StdioTransport{})
}
