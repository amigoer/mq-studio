package mcpserver

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/amigoer/mq-studio/internal/agent/catalog"
	"github.com/amigoer/mq-studio/internal/agent/toolset"
	"github.com/amigoer/mq-studio/internal/app"
	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/connection"
)

// fakeConn declares capabilities and connects to nothing. What a tool does
// before it reaches a broker - resolving the connection, refusing a capability
// the endpoint lacks, carrying a caveat out - is all decided here.
type fakeConn struct {
	kind         model.MQKind
	capabilities model.Capabilities
}

func (c *fakeConn) Kind() model.MQKind               { return c.kind }
func (c *fakeConn) Ping(context.Context) error       { return nil }
func (c *fakeConn) Capabilities() model.Capabilities { return c.capabilities }
func (c *fakeConn) Close() error                     { return nil }

// testPhrases stands in for the application's translations. The real ones are
// the renderer's locale files, which only the composition root can embed.
//
// What the server words itself - the questions put to a person - is read from
// the real English file instead, so a placeholder renamed there fails these
// tests rather than reaching somebody as {{destination}}.
func testPhrases(key string) string {
	if text, ok := map[string]string{
		"mq.rabbitmq.caveat.browseAltersQueue": "browsing requeues the message flagged redelivered",
		"mq.rocketmq.degraded.proxy":           "a Proxy endpoint is a data plane only",
		"mq.test.caveat.deleteTakesBindings":   "the bindings to it go with it",
	}[key]; ok {
		return text
	}
	if strings.HasPrefix(key, "mcp.") {
		var node any = englishLocale()
		for segment := range strings.SplitSeq(key, ".") {
			object, _ := node.(map[string]any)
			node = object[segment]
		}
		if text, ok := node.(string); ok {
			return text
		}
	}
	return key
}

var englishLocale = sync.OnceValue(func() map[string]any {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "frontend", "src", "i18n", "locales", "en.json"))
	if err != nil {
		panic(err)
	}
	var table map[string]any
	if err := json.Unmarshal(data, &table); err != nil {
		panic(err)
	}
	return table
})

// The connection service is real, over a temporary store with nothing in it.
// A stub would answer the one question this exercises - what happens to a
// connection id nothing knows - with whatever the stub was told to say.
type stubSettings struct{}

func (stubSettings) GetConnectTimeout() time.Duration          { return time.Second }
func (stubSettings) GetAutoConnectLast() bool                  { return false }
func (stubSettings) GetGlobalACLCredentials() (string, string) { return "", "" }

type stubRuntime struct{}

func (stubRuntime) Connect(model.ConnectionProfile) error { return nil }
func (stubRuntime) HasClient(int) bool                    { return false }
func (stubRuntime) Remove(int)                            {}
func (stubRuntime) Test(model.ConnectionProfile) error    { return nil }
func (stubRuntime) CloseAll()                             {}

type stubEndpoints struct{}

func (stubEndpoints) RequiresEndpoints(model.MQKind) bool { return true }

func emptyConnections(t *testing.T) *connection.Service {
	t.Helper()
	return connection.New(
		filepath.Join(t.TempDir(), "connections.json"),
		stubSettings{}, stubRuntime{}, stubEndpoints{})
}

// session runs a real client against a real server over the in-memory
// transport. It is the protocol itself rather than a stand-in, so what the
// test sees is what a client sees.
func session(t *testing.T, services *app.Services, allow catalog.Blast) *mcp.ClientSession {
	t.Helper()
	return grantedSession(t, services, Grants{everywhere: allow})
}

// grantedSession is session for a server started with connections named.
func grantedSession(t *testing.T, services *app.Services, grants Grants) *mcp.ClientSession {
	t.Helper()
	return connect(t, services, grants, clientSetup{})
}

// clientSetup is how a test client presents itself.
type clientSetup struct {
	// answer, when set, makes the client one that can put a question to a
	// person; the test answers in the person's place.
	answer func(*mcp.ElicitRequest) *mcp.ElicitResult
	// manual leaves input requests to the test instead of answering them and
	// calling again, so it can send an answer the client never would.
	manual bool
	// protocol pins the version the client asks for; empty is the SDK's latest.
	protocol string
}

// accept is a person who says yes to everything.
func accept(*mcp.ElicitRequest) *mcp.ElicitResult { return &mcp.ElicitResult{Action: "accept"} }

func connect(t *testing.T, services *app.Services, grants Grants, setup clientSetup) *mcp.ClientSession {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)

	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	server := New(services, "test", grants, testPhrases)
	go func() {
		if err := server.Run(ctx, serverTransport); err != nil && ctx.Err() == nil {
			t.Errorf("server stopped: %v", err)
		}
	}()

	options := &mcp.ClientOptions{}
	if setup.answer != nil {
		options.ElicitationHandler = func(_ context.Context, request *mcp.ElicitRequest) (*mcp.ElicitResult, error) {
			return setup.answer(request), nil
		}
	}
	if setup.manual {
		options.MultiRoundTrip = &mcp.MultiRoundTripOptions{Disabled: true}
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "test"}, options)
	clientSession, err := client.Connect(ctx, clientTransport, &mcp.ClientSessionOptions{ProtocolVersion: setup.protocol})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { _ = clientSession.Close() })
	return clientSession
}

/*
 * Every tool this server offers is read only, and the annotation is how a
 * client knows without asking.
 *
 * This is the whole of the promise the package doc makes, and it is the one
 * thing a later commit could break by copying a tool from elsewhere: a write
 * tool would work perfectly and nothing else would notice.
 */
func TestEveryToolIsAnnotatedReadOnly(t *testing.T) {
	tools := struct{ Tools []*mcp.Tool }{}
	for _, tool := range listed(t, catalog.BlastRead) {
		tools.Tools = append(tools.Tools, tool)
	}
	if len(tools.Tools) == 0 {
		t.Fatal("the server registered no tools")
	}
	for _, tool := range tools.Tools {
		if tool.Annotations == nil || !tool.Annotations.ReadOnlyHint {
			t.Errorf("%s is not annotated read-only", tool.Name)
		}
		if tool.Description == "" {
			t.Errorf("%s has no description, so a caller has only its name to go on", tool.Name)
		}
	}
}

// The handshake carries the one thing a tool list cannot say: what a
// connection can do is the endpoint's property, not its family's.
func TestInstructionsPointAtTheCapabilityTool(t *testing.T) {
	if !strings.Contains(instructions, "capabilities_describe") {
		t.Error("the instructions do not tell a client to ask what a connection can do")
	}
	if !strings.Contains(instructions, "connections_list") {
		t.Error("the instructions do not say where to start")
	}
}

// listed is the tool names a server offers at an allowance, read through the
// protocol rather than off the table that built it.
func listed(t *testing.T, allow catalog.Blast) map[string]*mcp.Tool {
	t.Helper()
	clientSession := session(t, &app.Services{}, allow)
	result, err := clientSession.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatalf("list tools: %v", err)
	}
	byName := make(map[string]*mcp.Tool, len(result.Tools))
	for _, tool := range result.Tools {
		byName[tool.Name] = tool
	}
	return byName
}

/*
 * The allowance is the whole of M3, and this is what it means.
 *
 * A tool that is absent from the list cannot be called by a model that was
 * never told it exists, which is a stronger guarantee than refusing at call
 * time - there is nothing to be talked out of. So the assertion is about the
 * list, not about what a handler does when reached.
 */
func TestAllowanceDecidesWhatIsOffered(t *testing.T) {
	expected := func(allow catalog.Blast) map[string]bool {
		names := map[string]bool{}
		for _, tool := range toolset.All() {
			if tool.Operation == "" || catalog.Permits(allow, tool.Blast) {
				names[tool.Name] = true
			}
		}
		return names
	}

	for _, allow := range []catalog.Blast{catalog.BlastRead, catalog.BlastMutate, catalog.BlastDestructive} {
		offered := listed(t, allow)
		want := expected(allow)
		for name := range want {
			if offered[name] == nil {
				t.Errorf("at %q, %s is missing", allow, name)
			}
		}
		for name := range offered {
			if !want[name] {
				t.Errorf("at %q, %s is offered and should not be", allow, name)
			}
		}
	}
}

// The three tools the criterion names, spelled out rather than derived, so
// that a change to the derivation above cannot quietly agree with itself.
func TestTheDefaultOffersNothingThatWrites(t *testing.T) {
	offered := listed(t, catalog.BlastRead)
	for _, name := range []string{
		"destination_purge", "destination_delete", "subscription_reset_offset",
		"destination_create", "message_publish", "message_resend",
	} {
		if offered[name] != nil {
			t.Errorf("%s is offered by a server nobody gave an allowance to", name)
		}
	}
	for _, name := range []string{"connections_list", "destinations_list", "messages_browse"} {
		if offered[name] == nil {
			t.Errorf("%s is missing from the default server", name)
		}
	}
}

// An unrecognised allowance must not widen anything. A typo in a flag is the
// one way this could go wrong without anybody noticing.
func TestAnUnknownAllowanceOffersNoBrokerTools(t *testing.T) {
	offered := listed(t, catalog.Blast("everything"))
	if offered["destinations_list"] != nil {
		t.Error("an unrecognised allowance offered a broker tool")
	}
	if offered["connections_list"] == nil {
		t.Error("an unrecognised allowance dropped the tools that are always offered")
	}
}

/*
 * The annotations are the protocol's way of saying what the catalogue says
 * with a blast radius, and a client decides how much to trust a tool by
 * reading them. They are derived for exactly that reason, and this is what
 * holds the derivation honest.
 */
func TestAnnotationsMatchTheCatalogue(t *testing.T) {
	offered := listed(t, catalog.BlastDestructive)
	for _, defined := range toolset.All() {
		operation, known := catalog.Find(defined.Operation)
		if !known {
			continue
		}
		tool := offered[defined.Name]
		if tool == nil {
			t.Errorf("%s is not offered even at the widest allowance", defined.Name)
			continue
		}
		if tool.Annotations == nil {
			t.Errorf("%s carries no annotations", defined.Name)
			continue
		}
		if want := operation.Blast == catalog.BlastRead; tool.Annotations.ReadOnlyHint != want {
			t.Errorf("%s: readOnlyHint = %v, but the catalogue calls it %s",
				defined.Name, tool.Annotations.ReadOnlyHint, operation.Blast)
		}
		destructive := tool.Annotations.DestructiveHint
		if destructive == nil {
			t.Errorf("%s does not say whether it is destructive", defined.Name)
			continue
		}
		if want := operation.Blast == catalog.BlastDestructive; *destructive != want {
			t.Errorf("%s: destructiveHint = %v, but the catalogue calls it %s",
				defined.Name, *destructive, operation.Blast)
		}
	}
}

// The tools have to answer a client, not just a Go caller: an input schema the
// SDK cannot infer, or an output it cannot marshal, fails at the protocol
// rather than in the handler.
func TestToolsRefuseAnUnknownConnectionThroughTheProtocol(t *testing.T) {
	clientSession := session(t, &app.Services{
		Conns:       func(int) (driver.Conn, error) { return nil, driver.ErrNotConnected },
		Connections: emptyConnections(t),
	}, catalog.BlastRead)

	arguments, err := json.Marshal(map[string]any{"connection": 404})
	if err != nil {
		t.Fatal(err)
	}
	result, err := clientSession.CallTool(context.Background(), &mcp.CallToolParams{
		Name:      "capabilities_describe",
		Arguments: json.RawMessage(arguments),
	})
	if err != nil {
		t.Fatalf("call tool: %v", err)
	}
	if !result.IsError {
		t.Error("an unopenable connection answered as though it were open")
	}
}
