package mcpserver

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strconv"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/amigoer/mq-studio/internal/agent/catalog"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/connection"
)

/*
 * Allowance is how far a server may go, as its command line put it: a ceiling
 * on every connection, and a higher one on the connections it names.
 *
 * One ceiling was too coarse for the case it matters most in. Emptying a
 * scratch queue took --allow destructive, and that let the same session empty
 * every queue on every other connection as well - production included, since
 * nothing in a profile says which cluster that is. Naming the connection is
 * the person starting the server saying which one they meant.
 */
type Allowance struct {
	// Everywhere is the ceiling on every connection, read unless raised.
	Everywhere catalog.Blast
	// Named raises it on connections named as the window shows them.
	Named map[string]catalog.Blast
}

// ParseAllowance reads every --allow value, in the order given.
//
// A bare tier is the ceiling on every connection, and says so once. A
// connection's name, an equals sign and a tier raises the ceiling on that
// connection alone. The name is everything before the last equals sign: a tier
// never contains one, and a name the window accepted might.
func ParseAllowance(values []string) (Allowance, error) {
	allowance := Allowance{Everywhere: catalog.BlastRead, Named: map[string]catalog.Blast{}}
	everywhere := ""
	for _, value := range values {
		separator := strings.LastIndexByte(value, '=')
		if separator < 0 {
			blast, err := parseTier(value)
			if err != nil {
				return Allowance{}, fmt.Errorf("--allow %q: %w", value, err)
			}
			if everywhere != "" {
				return Allowance{}, fmt.Errorf(
					"--allow %q and --allow %q both say how far every connection may go", everywhere, value)
			}
			everywhere, allowance.Everywhere = value, blast
			continue
		}

		name := strings.TrimSpace(value[:separator])
		blast, err := parseTier(value[separator+1:])
		if err != nil {
			return Allowance{}, fmt.Errorf(
				"--allow %q: %w; a connection is allowed further as <name>=<tier>", value, err)
		}
		if name == "" {
			return Allowance{}, fmt.Errorf("--allow %q names no connection", value)
		}
		if _, named := allowance.Named[name]; named {
			return Allowance{}, fmt.Errorf("--allow names %q twice; say once how far it may go", name)
		}
		allowance.Named[name] = blast
	}
	return allowance, nil
}

func parseTier(value string) (catalog.Blast, error) {
	blast := catalog.Blast(strings.TrimSpace(value))
	switch blast {
	case catalog.BlastRead, catalog.BlastMutate, catalog.BlastDestructive:
		return blast, nil
	}
	return "", fmt.Errorf("%q is not one of read, mutate or destructive", string(blast))
}

/*
 * Grant pins an allowance to the connections stored now.
 *
 * A name is resolved here, once, into the connection it named when the server
 * started - the one the person starting it was looking at. A connection saved
 * later under the same name is not covered by it, and one later pointed at
 * another broker stops being covered; a name looked up again on every call
 * could tell neither of those from a new remark.
 *
 * Every name has to resolve, to exactly one connection, and to more than every
 * connection already has. A name that does not is a command line that cannot
 * mean what it says, so every such name is reported at once and nothing is
 * served.
 */
func (a Allowance) Grant(stored []*model.ConnectionProfile) (Grants, error) {
	grants := Grants{everywhere: a.Everywhere, named: make(map[int]grant, len(a.Named))}
	var problems []error
	for _, name := range slices.Sorted(maps.Keys(a.Named)) {
		blast := a.Named[name]
		flag := strconv.Quote(name + "=" + string(blast))
		if catalog.Permits(a.Everywhere, blast) {
			problems = append(problems, fmt.Errorf(
				"--allow %s changes nothing: every connection may already go as far as %s", flag, a.Everywhere))
			continue
		}

		var matches []*model.ConnectionProfile
		for _, profile := range stored {
			if profile != nil && profile.Name == name {
				matches = append(matches, profile)
			}
		}
		switch len(matches) {
		case 1:
			grants.named[matches[0].ID] = grant{name: name, blast: blast, profile: *matches[0].Clone()}
		case 0:
			problems = append(problems, fmt.Errorf(
				"--allow %s names no stored connection; %s", flag, storedNames(stored)))
		default:
			ids := make([]int, 0, len(matches))
			for _, profile := range matches {
				ids = append(ids, profile.ID)
			}
			problems = append(problems, fmt.Errorf(
				"--allow %s could mean any of connections %v, which share that name; "+
					"rename one in the window so a grant can tell them apart", flag, ids))
		}
	}
	if len(problems) > 0 {
		return Grants{}, errors.Join(problems...)
	}
	return grants, nil
}

// storedNames lists what a grant could have named, so a misspelt one can be
// put right without opening the window.
func storedNames(stored []*model.ConnectionProfile) string {
	names := make([]string, 0, len(stored))
	for _, profile := range stored {
		if profile != nil {
			names = append(names, strconv.Quote(profile.Name))
		}
	}
	if len(names) == 0 {
		return "no connection is stored yet"
	}
	slices.Sort(names)
	return "the stored ones are " + strings.Join(slices.Compact(names), ", ")
}

// Grants is an allowance pinned to the connections stored when the server
// started. The zero value grants nothing, reading included.
type Grants struct {
	everywhere catalog.Blast
	named      map[int]grant
}

// grant is one connection allowed further than every connection is.
type grant struct {
	name  string
	blast catalog.Blast
	// profile is the connection as it was stored when the grant was made. The
	// grant covers what that reached, not whatever the id reaches now.
	profile model.ConnectionProfile
}

// widest is the furthest any connection may go, which is what decides the
// tool list: a tool is offered when some connection may use it.
func (g Grants) widest() catalog.Blast {
	widest := g.everywhere
	for _, granted := range g.named {
		if !catalog.Permits(widest, granted.blast) {
			widest = granted.blast
		}
	}
	return widest
}

// String says how far the server goes, for the line it writes on stderr.
func (g Grants) String() string {
	var text strings.Builder
	fmt.Fprintf(&text, "%q on every connection", g.everywhere)
	for _, id := range slices.Sorted(maps.Keys(g.named)) {
		granted := g.named[id]
		fmt.Fprintf(&text, ", %q on %q (connection %d)", granted.blast, granted.name, id)
	}
	return text.String()
}

// ceiling is how far a call on a connection may go now. When a grant made at
// startup no longer holds, the error says why.
func (s *server) ceiling(id int) (catalog.Blast, error) {
	granted, named := s.grants.named[id]
	if !named {
		return s.grants.everywhere, nil
	}
	current, err := s.services.Connections.GetConnection(id)
	if err != nil {
		return s.grants.everywhere, fmt.Errorf(
			"it was allowed %s as %q when this server started, and is no longer stored",
			granted.blast, granted.name)
	}
	if connection.Repointed(granted.profile, *current) {
		return s.grants.everywhere, fmt.Errorf(
			"it was allowed %s as %q when this server started, and has since been pointed at "+
				"another broker or given other credentials in the window, so that no longer holds",
			granted.blast, granted.name)
	}
	return granted.blast, nil
}

/*
 * reaches refuses a call that goes further than its connection may.
 *
 * It is not a judgement, and the refusal says so. The ceiling was set when the
 * server started by whoever started it, so nothing a caller says here can move
 * it, and a model that took the refusal for a negotiation would only ask again.
 */
func (s *server) reaches(id int, tool string, blast catalog.Blast) error {
	ceiling, lapsed := s.ceiling(id)
	if catalog.Permits(ceiling, blast) {
		return nil
	}
	if lapsed != nil {
		return fmt.Errorf("%s is %s, and connection %d may go no further than %s: %w",
			tool, blast, id, ceiling, lapsed)
	}
	return fmt.Errorf("%s is %s, and connection %d may go no further than %s. How far each connection "+
		"may go was decided when this server was started, and asking will not change it; "+
		"connections_list says which ones go further", tool, blast, id, ceiling)
}

// targeted is a tool input that names the connection it acts on.
type targeted interface{ target() int }

/*
 * provide registers the tool for a catalogue operation, when some connection
 * may go as far as it does.
 *
 * One that goes further than every connection may is refused on the others
 * before anything is dialled. The check reads the connection from the very
 * value the handler is given rather than from the raw arguments, and no
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
	if !catalog.Permits(s.grants.everywhere, operation.Blast) {
		var input In
		if _, names := any(input).(targeted); !names {
			// Registration runs at startup and in every test that lists the tools.
			panic(fmt.Sprintf("%s goes further than every connection may, and its input names "+
				"no connection to check", tool.Name))
		}
		tool.Description += " Refused on a connection this server was not started to allow it on; " +
			"connections_list says how far each connection may go."
		handler = gated(s, tool.Name, operation.Blast, handler)
	}
	addTool(mcpServer, tool, handler)
}

func gated[In, Out any](
	s *server, name string, blast catalog.Blast, handler mcp.ToolHandlerFor[In, Out],
) mcp.ToolHandlerFor[In, Out] {
	return func(ctx context.Context, request *mcp.CallToolRequest, input In) (*mcp.CallToolResult, Out, error) {
		s.refreshMu.RLock()
		defer s.refreshMu.RUnlock()
		if err := s.reaches(any(input).(targeted).target(), name, blast); err != nil {
			var nothing Out
			return nil, nothing, err
		}
		return handler(ctx, request, input)
	}
}
