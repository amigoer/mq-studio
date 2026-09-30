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
 * Every tool that writes is recorded in the audit log whatever the allowance,
 * and every destructive one is put to a person first. One that goes further
 * than every connection may is also refused on the others before anything is
 * dialled. The checks read the connection from the very value the handler is
 * given rather than from the raw arguments, and no refresh lands between the
 * last of them and the handler returning, so what was checked and what is
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
		// Registration runs at startup and in every test that lists the tools.
		var input In
		if _, names := any(input).(targeted); !names {
			panic(fmt.Sprintf("%s writes, and its input names no connection to check or record", tool.Name))
		}
		confirmed := operation.Blast == catalog.BlastDestructive
		if confirmed {
			if _, names := any(input).(confirmable); !names || questions[operationID] == "" {
				panic(fmt.Sprintf("%s destroys, and there is no question to put to a person first", tool.Name))
			}
			tool.Description += " A person is asked to confirm it through your client first, and it is " +
				"refused where the client cannot ask."
		}
		gated := !catalog.Permits(s.grants.everywhere, operation.Blast)
		if gated {
			tool.Description += " Refused on a connection this server was not started to allow it on; " +
				"connections_list says how far each connection may go."
		}
		handler = guarded(s, tool.Name, operation, gated, confirmed, handler)
	}
	addTool(mcpServer, tool, handler)
}

/*
 * guarded is every check a write passes before it is made, and the records
 * either side of it.
 *
 * A destructive call runs twice. The first time it is checked as far as it
 * can be without a person, and then asks one while holding nothing: an answer
 * can take minutes, and the lock below would stall every other call for as
 * long. The second time, carrying the answer, it takes the lock and checks
 * again - the allowance, and that the connection is still the one the person
 * was shown - because either may have moved while they read.
 */
func guarded[In, Out any](
	s *server, name string, operation catalog.Operation, gated, confirmed bool,
	handler mcp.ToolHandlerFor[In, Out],
) mcp.ToolHandlerFor[In, Out] {
	return func(ctx context.Context, request *mcp.CallToolRequest, input In) (*mcp.CallToolResult, Out, error) {
		var nothing Out
		id := any(input).(targeted).target()

		var agreed *agreement
		call := int64(0)
		if confirmed {
			reply, token, answering := answerOf(request)
			if !answering {
				call = s.journal.next()
				entry := s.entry(request, name, operation, id, input, call)
				question, profile, err := s.question(ctx, request, name, operation, gated, id, input)
				if err == nil {
					err = s.journal.before(entry.asked(question))
				}
				if err != nil {
					s.journal.keep(entry.refused(err))
					return nil, nothing, err
				}
				return s.confirmations.ask(question, agreement{
					tool: name, arguments: canonical(input), profile: profile, call: call,
					expires: time.Now().Add(confirmationTTL),
				}), nothing, nil
			}

			asked, err := s.confirmations.take(token, name, canonical(input))
			if call = asked.call; call == 0 {
				call = s.journal.next()
			}
			if err == nil {
				err = verdict(reply)
			}
			if err != nil {
				s.journal.keep(s.entry(request, name, operation, id, input, call).refused(err))
				return nil, nothing, err
			}
			agreed = &asked
		} else {
			call = s.journal.next()
		}

		if gated || confirmed {
			// Held until the handler returns: see refreshMu.
			s.refreshMu.RLock()
			defer s.refreshMu.RUnlock()
		}
		entry := s.entry(request, name, operation, id, input, call)
		if gated {
			if err := s.reaches(id, name, operation.Blast); err != nil {
				s.journal.keep(entry.refused(err))
				return nil, nothing, err
			}
		}
		if agreed != nil {
			if err := s.changedSince(id, agreed.profile); err != nil {
				s.journal.keep(entry.refused(err))
				return nil, nothing, err
			}
		}
		if err := s.journal.before(entry.started(agreed != nil)); err != nil {
			return nil, nothing, err
		}

		began := time.Now()
		result, output, err := handler(ctx, request, input)
		s.journal.keep(entry.finished(output, err, time.Since(began)))
		return result, output, err
	}
}
