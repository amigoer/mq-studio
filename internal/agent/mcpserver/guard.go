package mcpserver

import (
	"context"
	"encoding/json"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/amigoer/mq-studio/internal/agent/catalog"
	"github.com/amigoer/mq-studio/internal/agent/toolset"
)

/*
 * provide registers a tool, when some connection may go as far as it does.
 *
 * Every tool that writes is recorded in the audit log whatever the allowance,
 * and every destructive one is put to a person first. One that goes further
 * than every connection may is also refused on the others before anything is
 * dialled. The checks read the connection from the very value the tool is
 * run on rather than from the raw arguments, and no refresh lands between the
 * last of them and the tool returning, so what was checked and what is acted
 * on cannot be two readings of one request.
 *
 * The SDK checks the arguments against the tool's schema before the handler
 * sees them, and the schema is closed, so decoding them here is not a second
 * reading that could differ from the first.
 */
func provide(s *server, mcpServer *mcp.Server, tool toolset.Tool) {
	presented, ok := offer(tool, s.grants.widest())
	if !ok {
		return
	}
	handler := direct(s, tool)
	if tool.Blast != catalog.BlastRead {
		confirmed := tool.Blast == catalog.BlastDestructive
		if confirmed {
			presented.Description += " A person is asked to confirm it through your client first, and it is " +
				"refused where the client cannot ask."
		}
		gated := !catalog.Permits(s.grants.everywhere, tool.Blast)
		if gated {
			presented.Description += " Refused on a connection this server was not started to allow it on; " +
				"connections_list says how far each connection may go."
		}
		handler = guarded(s, tool, gated, confirmed)
	}
	mcp.AddTool(mcpServer, presented, handler)
}

// direct runs a tool that only reads.
func direct(s *server, tool toolset.Tool) mcp.ToolHandlerFor[json.RawMessage, any] {
	return func(ctx context.Context, request *mcp.CallToolRequest, arguments json.RawMessage) (*mcp.CallToolResult, any, error) {
		input, err := tool.Decode(arguments)
		if err != nil {
			return nil, nil, err
		}
		output, err := tool.Run(s.caller(ctx, request), s.env, input)
		return nil, output, err
	}
}

// caller tells the tools what they need to know about the client a call came
// from.
func (s *server) caller(ctx context.Context, request *mcp.CallToolRequest) context.Context {
	return toolset.WithCaller(ctx, toolset.Caller{Confirms: canConfirm(request)})
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
func guarded(s *server, tool toolset.Tool, gated, confirmed bool) mcp.ToolHandlerFor[json.RawMessage, any] {
	operation, _ := catalog.Find(tool.Operation)
	return func(ctx context.Context, request *mcp.CallToolRequest, arguments json.RawMessage) (*mcp.CallToolResult, any, error) {
		input, err := tool.Decode(arguments)
		if err != nil {
			return nil, nil, err
		}
		id := input.(toolset.Targeted).Target()

		var agreed *agreement
		call := int64(0)
		if confirmed {
			reply, token, answering := answerOf(request)
			if !answering {
				call = s.journal.Next()
				entry := s.entry(request, tool.Name, operation, id, input, call)
				question, profile, err := s.question(ctx, request, tool, gated, id, input)
				if err == nil {
					err = s.journal.Before(entry.Asked(question))
				}
				if err != nil {
					s.journal.Keep(entry.Refused(err))
					return nil, nil, err
				}
				return s.confirmations.ask(question, agreement{
					tool: tool.Name, arguments: toolset.Canonical(input), profile: profile, call: call,
					expires: time.Now().Add(confirmationTTL),
				}), nil, nil
			}

			asked, err := s.confirmations.take(token, tool.Name, toolset.Canonical(input))
			if call = asked.call; call == 0 {
				call = s.journal.Next()
			}
			if err == nil {
				err = verdict(reply)
			}
			if err != nil {
				s.journal.Keep(s.entry(request, tool.Name, operation, id, input, call).Refused(err))
				return nil, nil, err
			}
			agreed = &asked
		} else {
			call = s.journal.Next()
		}

		if gated || confirmed {
			// Held until the tool returns: see refreshMu.
			s.refreshMu.RLock()
			defer s.refreshMu.RUnlock()
		}
		entry := s.entry(request, tool.Name, operation, id, input, call)
		if gated {
			if err := s.reaches(id, tool.Name, operation.Blast); err != nil {
				s.journal.Keep(entry.Refused(err))
				return nil, nil, err
			}
		}
		if agreed != nil {
			if err := s.env.ChangedSince(id, agreed.profile); err != nil {
				s.journal.Keep(entry.Refused(err))
				return nil, nil, err
			}
		}
		if err := s.journal.Before(entry.Started(agreed != nil)); err != nil {
			return nil, nil, err
		}

		began := time.Now()
		output, err := tool.Run(s.caller(ctx, request), s.env, input)
		s.journal.Keep(entry.Finished(output, err, time.Since(began)))
		return nil, output, err
	}
}
