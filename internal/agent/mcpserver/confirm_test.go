package mcpserver

import (
	"cmp"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/amigoer/mq-studio/internal/agent/catalog"
	"github.com/amigoer/mq-studio/internal/model"
)

// protocols are the two ways a question travels: on the current one the
// client asks and calls again, and on an older one the SDK asks on the
// client's behalf and calls the handler again itself.
var protocols = []string{"", "2025-06-18"}

// person answers every question the same way and remembers what was asked.
type person struct {
	mu     sync.Mutex
	action string
	asked  []string
	// meanwhile runs while the person reads, before they answer.
	meanwhile func()
}

func (p *person) answer(request *mcp.ElicitRequest) *mcp.ElicitResult {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.asked = append(p.asked, request.Params.Message)
	if p.meanwhile != nil {
		p.meanwhile()
	}
	return &mcp.ElicitResult{Action: p.action}
}

func (p *person) questions() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.asked...)
}

/*
 * Nothing is destroyed until a person says yes, and what they are shown is
 * the target, where it is and what it holds - the window's own question.
 */
func TestADestructiveWriteWaitsForAPersonsYes(t *testing.T) {
	for _, protocol := range protocols {
		t.Run(cmp.Or(protocol, "latest"), func(t *testing.T) {
			world := newGrantedWorld(t)
			world.conn.depth = 1204
			world.conn.capabilities = world.conn.capabilities.
				WithCaveat(model.CapDestinationDelete, "mq.test.caveat.deleteTakesBindings")
			yes := &person{action: "accept"}
			clientSession := connect(t, world.server, world.grants(t),
				clientSetup{answer: yes.answer, protocol: protocol})
			if negotiated := clientSession.InitializeResult().ProtocolVersion; protocol != "" && negotiated != protocol {
				t.Fatalf("negotiated %s, so the older path is not the one under test", negotiated)
			}

			refused, text := callTool(t, clientSession, "destination_delete",
				map[string]any{"connection": world.ids["scratch"], "name": "orders"})
			if refused {
				t.Fatalf("a delete the person agreed to was refused: %q", text)
			}
			if len(world.conn.removed) != 1 || world.conn.removed[0].Name != "orders" {
				t.Fatalf("removed %v, want orders once", world.conn.removed)
			}

			asked := yes.questions()
			if len(asked) != 1 {
				t.Fatalf("the person was asked %d times: %q", len(asked), asked)
			}
			for _, want := range []string{
				"Delete orders on scratch (rabbitmq)?", "Messages it holds now: 1204.",
				"Also: the bindings to it go with it",
			} {
				if !strings.Contains(asked[0], want) {
					t.Errorf("the question does not say %q:\n%s", want, asked[0])
				}
			}

			records := audited(t, world.paths.AgentAuditFile)
			if len(records) != 3 || records[0].Phase != phaseAsked || records[1].Phase != phaseStarted ||
				records[2].Phase != phaseDone || records[0].Call != records[2].Call {
				t.Fatalf("the log does not read as a question, a start and an outcome: %+v", records)
			}
			if records[0].Question != asked[0] || !records[1].Confirmed {
				t.Errorf("the log does not keep what the person saw and that they agreed: %+v", records)
			}
		})
	}
}

// A no is final for that call, and says so in words that keep a model from
// asking again on its own.
func TestADeclinedWriteIsNotMade(t *testing.T) {
	for _, protocol := range protocols {
		t.Run(cmp.Or(protocol, "latest"), func(t *testing.T) {
			world := newGrantedWorld(t)
			no := &person{action: "decline"}
			clientSession := connect(t, world.server, world.grants(t),
				clientSetup{answer: no.answer, protocol: protocol})

			refused, text := callTool(t, clientSession, "destination_purge",
				map[string]any{"connection": world.ids["scratch"], "name": "orders"})
			if !refused || !strings.Contains(text, "declined") || !strings.Contains(text, "not be tried again") {
				t.Fatalf("a declined purge: %q", text)
			}
			if len(world.conn.purged) != 0 {
				t.Fatalf("purged %v after the person said no", world.conn.purged)
			}
			records := audited(t, world.paths.AgentAuditFile)
			if len(records) != 2 || records[0].Phase != phaseAsked || records[1].Phase != phaseRefused ||
				records[0].Call != records[1].Call {
				t.Fatalf("the log does not read as a question and its refusal: %+v", records)
			}
		})
	}
}

/*
 * A client that cannot ask a person is refused, before anything is dialled -
 * and it is told up front, by capabilities_describe naming no tool for the
 * operation, rather than finding out from the refusal.
 */
func TestAClientThatCannotAskIsRefused(t *testing.T) {
	world := newGrantedWorld(t)
	clientSession := world.session(t)

	refused, text := callTool(t, clientSession, "destination_delete",
		map[string]any{"connection": world.ids["scratch"], "name": "orders"})
	if !refused || !strings.Contains(text, "cannot ask one") {
		t.Fatalf("a client that cannot ask was not refused for it: %q", text)
	}
	if world.dials.Load() != 0 || len(world.conn.removed) != 0 {
		t.Fatalf("dialled %d times and removed %v", world.dials.Load(), world.conn.removed)
	}

	result, err := clientSession.CallTool(t.Context(), &mcp.CallToolParams{
		Name: "capabilities_describe", Arguments: map[string]any{"connection": world.ids["scratch"]}})
	if err != nil || result.IsError {
		t.Fatalf("describe: %v %+v", err, result)
	}
	var output describeOutput
	encoded, _ := json.Marshal(result.StructuredContent)
	if err := json.Unmarshal(encoded, &output); err != nil {
		t.Fatal(err)
	}
	for _, operation := range output.Operations {
		if operation.Blast == string(catalog.BlastDestructive) && operation.Tool != "" {
			t.Errorf("%s names %s to a client that cannot confirm it", operation.ID, operation.Tool)
		}
	}
}

// answering is a call that carries an answer, sent by hand: a client of the
// current protocol, with its automatic answering switched off, so the test
// can send what a well-behaved client never would.
func answering(
	t *testing.T, clientSession *mcp.ClientSession, arguments map[string]any, action, token string,
) (bool, string) {
	t.Helper()
	result, err := clientSession.CallTool(t.Context(), &mcp.CallToolParams{
		Name: "destination_delete", Arguments: arguments,
		InputResponses: mcp.InputResponseMap{confirmationKey: &mcp.ElicitResult{Action: action}},
		RequestState:   token,
	})
	if err != nil {
		t.Fatal(err)
	}
	text := ""
	for _, content := range result.Content {
		if part, ok := content.(*mcp.TextContent); ok {
			text += part.Text
		}
	}
	return result.IsError, text
}

// asking is the first half of a destructive call: the question and its token.
func asking(t *testing.T, clientSession *mcp.ClientSession, arguments map[string]any) string {
	t.Helper()
	result, err := clientSession.CallTool(t.Context(), &mcp.CallToolParams{
		Name: "destination_delete", Arguments: arguments})
	if err != nil {
		t.Fatal(err)
	}
	if !result.NeedsInput() || result.InputRequests[confirmationKey] == nil || result.RequestState == "" {
		t.Fatalf("a destructive call did not come back as a question: %+v", result)
	}
	return result.RequestState
}

/*
 * An answer is good for the call it was asked about, once.
 *
 * It comes back with a later call, from the client. Carried over to another
 * target, replayed, or sent unasked, it would be a yes nobody gave - the one
 * thing the question exists to rule out.
 */
func TestAnAnswerIsGoodForItsOwnCallOnce(t *testing.T) {
	world := newGrantedWorld(t)
	clientSession := connect(t, world.server, world.grants(t),
		clientSetup{answer: accept, manual: true})
	orders := map[string]any{"connection": world.ids["scratch"], "name": "orders"}
	payments := map[string]any{"connection": world.ids["scratch"], "name": "payments"}

	token := asking(t, clientSession, orders)
	if refused, text := answering(t, clientSession, payments, "accept", token); !refused ||
		!strings.Contains(text, "different call") {
		t.Errorf("a yes about orders deleted payments: %q", text)
	}
	if refused, text := answering(t, clientSession, orders, "accept", token); !refused ||
		!strings.Contains(text, "already answered") {
		t.Errorf("a token was good twice: %q", text)
	}

	// Sent with no question behind it, an answer is not one: the call asks.
	if result, err := clientSession.CallTool(t.Context(), &mcp.CallToolParams{
		Name: "destination_delete", Arguments: orders,
		InputResponses: mcp.InputResponseMap{confirmationKey: &mcp.ElicitResult{Action: "accept"}},
	}); err != nil || !result.NeedsInput() {
		t.Errorf("an unasked yes was taken: %v %+v", err, result)
	}
	if len(world.conn.removed) != 0 {
		t.Fatalf("removed %v on answers nobody gave", world.conn.removed)
	}

	token = asking(t, clientSession, orders)
	if refused, text := answering(t, clientSession, orders, "accept", token); refused {
		t.Fatalf("the answer to its own question was refused: %q", text)
	}
	if refused, _ := answering(t, clientSession, orders, "accept", token); !refused {
		t.Error("the same yes deleted twice")
	}
	if len(world.conn.removed) != 1 {
		t.Fatalf("removed %v, want orders once", world.conn.removed)
	}
}

/*
 * The person agreed to the broker they were shown. A connection pointed at
 * another one while they read is not it, and nothing is done.
 *
 * Every connection may go as far as destructive here, so no grant is there to
 * lapse and catch it: this is the question's own check.
 */
func TestAConnectionRepointedWhileThePersonReadsIsNotTouched(t *testing.T) {
	world := newGrantedWorld(t)
	id := world.ids["scratch"]
	reader := &person{action: "accept", meanwhile: func() {
		if _, err := world.window.Connections.UpdateConnection(
			id, rabbitProfile("scratch", "http://production.invalid:15672")); err != nil {
			t.Error(err)
		}
	}}
	clientSession := connect(t, world.server, Grants{everywhere: catalog.BlastDestructive},
		clientSetup{answer: reader.answer})

	refused, text := callTool(t, clientSession, "destination_delete",
		map[string]any{"connection": id, "name": "orders"})
	if !refused || !strings.Contains(text, "after the person agreed") {
		t.Fatalf("a delete went ahead on a connection re-pointed after the yes: %q", text)
	}
	if len(world.conn.removed) != 0 {
		t.Fatalf("removed %v", world.conn.removed)
	}
}

func TestAnExpiredQuestionIsNotAnswered(t *testing.T) {
	var pending confirmations
	result := pending.ask("question", agreement{tool: "destination_delete", arguments: "{}",
		expires: time.Now().Add(-time.Second)})
	if _, err := pending.take(result.RequestState, "destination_delete", "{}"); err == nil ||
		!strings.Contains(err.Error(), "expired") {
		t.Fatalf("an answer after the question expired: %v", err)
	}
}

func TestOnlyAClientThatCanShowAFormIsAsked(t *testing.T) {
	declared := func(elicitation *mcp.ElicitationCapabilities) *mcp.InitializeParams {
		return &mcp.InitializeParams{Capabilities: &mcp.ClientCapabilities{Elicitation: elicitation}}
	}
	cases := map[string]struct {
		params *mcp.InitializeParams
		asks   bool
	}{
		"nothing declared": {&mcp.InitializeParams{Capabilities: &mcp.ClientCapabilities{}}, false},
		"no capabilities":  {&mcp.InitializeParams{}, false},
		"no mode named":    {declared(&mcp.ElicitationCapabilities{}), true},
		"forms":            {declared(&mcp.ElicitationCapabilities{Form: &mcp.FormElicitationCapabilities{}}), true},
		"urls only":        {declared(&mcp.ElicitationCapabilities{URL: &mcp.URLElicitationCapabilities{}}), false},
		"both": {declared(&mcp.ElicitationCapabilities{
			Form: &mcp.FormElicitationCapabilities{}, URL: &mcp.URLElicitationCapabilities{}}), true},
	}
	for name, c := range cases {
		if got := asksForms(c.params); got != c.asks {
			t.Errorf("%s: asksForms = %v, want %v", name, got, c.asks)
		}
	}
}
