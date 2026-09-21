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

	"github.com/amigoer/mq-studio/internal/agent/catalog"
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
/*
 * allowance reads how far the server may go from the command line, and only
 * from there.
 *
 * Not a setting in the application. The person who decides an agent may empty
 * a queue is the person starting it, at the moment they start it, with the
 * task in front of them - not whoever clicked a switch some weeks ago and has
 * since forgotten it is on. It is also why the default is the narrowest one:
 * a flag nobody passed cannot have meant anything.
 */
func allowance(arguments []string) (catalog.Blast, error) {
	flags := flag.NewFlagSet(mcpCommand, flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	allow := flags.String("allow", string(catalog.BlastRead),
		"how far the tools may go: read, mutate or destructive")
	if err := flags.Parse(arguments); err != nil {
		return "", err
	}

	blast := catalog.Blast(*allow)
	switch blast {
	case catalog.BlastRead, catalog.BlastMutate, catalog.BlastDestructive:
		return blast, nil
	default:
		return "", fmt.Errorf(
			"--allow %q is not one of read, mutate or destructive", *allow)
	}
}

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

	// A client that goes away closes stdin, which ends Run on its own. The
	// signals are for the other way out, and both paths reach the deferred
	// Close - connections this process opened are its own to shut.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// Said on stderr, where it reaches the person who started this and not the
	// protocol. A server that quietly went further than its operator meant is
	// the failure this whole tier exists to prevent.
	log.Printf("[mcp] serving with tools up to %q", allow)

	// The application's own language, so the consequences read the way they do
	// on screen rather than in whatever the server happened to default to.
	translate := phrasebook(services.Settings.GetSettings().Language)

	return mcpserver.New(services, version, allow, translate).Run(ctx, &mcp.StdioTransport{})
}
