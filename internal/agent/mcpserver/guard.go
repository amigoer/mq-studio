package mcpserver

import (
	"context"
	"fmt"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/amigoer/mq-studio/internal/agent/catalog"
)

// targeted is a tool input that names the connection it acts on.
type targeted interface{ target() int }

/*
 * provide registers the tool for a catalogue operation, when some connection
 * may go as far as it does.
 *
 * Every tool that writes is recorded in the audit log, whatever the allowance.
 * One that goes further than every connection may is also refused on the
 * others before anything is dialled. The check reads the connection from the
 * very value the handler is given rather than from the raw arguments, and no
 * refresh lands until the handler returns, so what was checked and what is
 * acted on cannot be two readings of one request.
 */
func provide[In, Out any](
	s *server, mcpServer *mcp.Server, operationID string, handler mcp.ToolHandlerFor[In, Out],
) {
	tool, ok := offer(operationID, s.grants.widest())
	if !ok {
		return
	}
	operation, _ := catalog.Find(operationID)
	if operation.Blast != catalog.BlastRead {
		var input In
		if _, names := any(input).(targeted); !names {
			// Registration runs at startup and in every test that lists the tools.
			panic(fmt.Sprintf("%s writes, and its input names no connection to check or record", tool.Name))
		}
		gated := !catalog.Permits(s.grants.everywhere, operation.Blast)
		if gated {
			tool.Description += " Refused on a connection this server was not started to allow it on; " +
				"connections_list says how far each connection may go."
		}
		handler = guarded(s, tool.Name, operation, gated, handler)
	}
	addTool(mcpServer, tool, handler)
}

// guarded records a write in the audit log before and after making it, and
// where gated first refuses it on a connection whose ceiling is too low.
func guarded[In, Out any](
	s *server, name string, operation catalog.Operation, gated bool, handler mcp.ToolHandlerFor[In, Out],
) mcp.ToolHandlerFor[In, Out] {
	return func(ctx context.Context, request *mcp.CallToolRequest, input In) (*mcp.CallToolResult, Out, error) {
		var nothing Out
		if gated {
			// Held until the handler returns: see refreshMu.
			s.refreshMu.RLock()
			defer s.refreshMu.RUnlock()
		}
		id := any(input).(targeted).target()
		entry := s.entry(request, name, operation, id, input)
		if gated {
			if err := s.reaches(id, name, operation.Blast); err != nil {
				s.journal.keep(entry.refused(err))
				return nil, nothing, err
			}
		}
		if err := s.journal.append(entry.started()); err != nil {
			return nil, nothing, fmt.Errorf(
				"not done: every write is recorded before it is made, and the audit log %s could not be written: %w",
				s.journal.path, err)
		}

		began := time.Now()
		result, output, err := handler(ctx, request, input)
		s.journal.keep(entry.finished(output, err, time.Since(began)))
		return result, output, err
	}
}
