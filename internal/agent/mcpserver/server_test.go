package mcpserver

import (
	"context"
	"encoding/json"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/amigoer/mq-studio/internal/agent/catalog"
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

func serverWith(conn driver.Conn) *server {
	return &server{services: &app.Services{
		Conns: func(int) (driver.Conn, error) { return conn, nil },
	}}
}

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
func session(t *testing.T, services *app.Services) *mcp.ClientSession {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)

	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	server := New(services, "test")
	go func() {
		if err := server.Run(ctx, serverTransport); err != nil && ctx.Err() == nil {
			t.Errorf("server stopped: %v", err)
		}
	}()

	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "test"}, nil)
	clientSession, err := client.Connect(ctx, clientTransport, nil)
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
	clientSession := session(t, &app.Services{})

	tools, err := clientSession.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatalf("list tools: %v", err)
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

/*
 * toolFor is what capabilities_describe uses to tell a caller the difference
 * between an operation this endpoint cannot do and one it can do that no tool
 * reaches. Both halves have to be true for that to mean anything.
 */
func TestToolForNamesRealOperationsAndRealTools(t *testing.T) {
	operations := make(map[string]catalog.Operation, len(catalog.Operations))
	for _, operation := range catalog.Operations {
		operations[operation.ID] = operation
	}

	clientSession := session(t, &app.Services{})
	tools, err := clientSession.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatalf("list tools: %v", err)
	}
	registered := make(map[string]bool, len(tools.Tools))
	for _, tool := range tools.Tools {
		registered[tool.Name] = true
	}

	for id, tool := range toolFor {
		operation, known := operations[id]
		if !known {
			t.Errorf("toolFor names %q, which is not a catalogue operation", id)
			continue
		}
		// A write operation mapped to a tool here would advertise this server
		// as able to do something it must not.
		if operation.Blast != catalog.BlastRead {
			t.Errorf("toolFor maps %s, whose blast radius is %s, to a tool on a read-only server",
				id, operation.Blast)
		}
		if !registered[tool] {
			t.Errorf("%s is mapped to tool %q, which the server does not register", id, tool)
		}
	}
}

// A supported capability answers, and carries whatever the endpoint said about
// it. The caveat is the endpoint's own: the same operation has different
// consequences on different families, and inventing one here would be a
// warning nobody made.
func TestCapableCarriesTheEndpointsCaveat(t *testing.T) {
	const caveat = "browsing goes through basic.get, which alters queue state"
	s := serverWith(&fakeConn{
		kind: model.KindRabbitMQ,
		capabilities: model.NewCapabilities(model.CapMessageQuery).
			WithCaveat(model.CapMessageQuery, caveat),
	})

	_, got, err := s.capable(1, model.CapMessageQuery)
	if err != nil {
		t.Fatalf("capable: %v", err)
	}
	if got != caveat {
		t.Errorf("caveat = %q, want the endpoint's own", got)
	}
}

/*
 * The two ways an operation can be unavailable have to stay distinguishable
 * out here, because they call for different things from the caller.
 *
 * A degraded capability is the family's, and this endpoint's answer is no - so
 * the driver's reason has to travel, since "this endpoint is a Proxy, which
 * has no topic listing" is actionable and "unsupported" is not. A capability
 * the family has no concept of is not worth another attempt at all.
 */
func TestCapableTellsRefusalsApart(t *testing.T) {
	const reason = "a Proxy endpoint is a data plane only"
	degraded := serverWith(&fakeConn{
		kind: model.KindRocketMQ,
		capabilities: model.NewCapabilities(model.CapDestinationList).
			WithDegraded(model.CapDestinationList, reason),
	})
	_, _, err := degraded.capable(1, model.CapDestinationList)
	if err == nil {
		t.Fatal("a degraded capability answered as though it worked")
	}
	if !strings.Contains(err.Error(), reason) {
		t.Errorf("the driver's reason did not travel: %v", err)
	}

	absent := serverWith(&fakeConn{
		kind:         model.KindKafka,
		capabilities: model.NewCapabilities(model.CapDestinationList),
	})
	_, _, err = absent.capable(1, model.CapRouting)
	if err == nil {
		t.Fatal("a capability the family does not have answered as though it worked")
	}
	if !strings.Contains(err.Error(), "no concept") {
		t.Errorf("a missing concept reads as a failure rather than a fact: %v", err)
	}
}

// capabilities_describe is the tool the instructions send a client to first,
// so what it says has to be the connection's own answer.
func TestDescribeReportsOperationsAndAbsences(t *testing.T) {
	const reason = "a Proxy endpoint is a data plane only"
	s := serverWith(&fakeConn{
		kind: model.KindRocketMQ,
		capabilities: model.NewCapabilities(model.CapMessageQuery, model.CapDestinationList).
			WithDegraded(model.CapClusterTopology, reason),
	})

	_, output, err := s.describeCapabilities(context.Background(), nil, connectionInput{Connection: 1})
	if err != nil {
		t.Fatalf("describe: %v", err)
	}
	if output.Family != string(model.KindRocketMQ) {
		t.Errorf("family = %q", output.Family)
	}

	byID := make(map[string]operationSummary, len(output.Operations))
	for _, operation := range output.Operations {
		byID[operation.ID] = operation
	}
	if byID["destination.list"].Tool != "destinations_list" {
		t.Error("a supported operation does not name the tool that performs it")
	}
	// An operation with no tool is a fact about this server, not about the
	// endpoint, and the two must not be confused.
	if _, present := byID["destination.detail"]; !present {
		t.Error("destination.detail is gated on the same capability and did not come back")
	}
	if len(output.Unavailable) != 1 || output.Unavailable[0].Reason != reason {
		t.Errorf("the degraded capability did not travel: %#v", output.Unavailable)
	}
	for _, operation := range output.Operations {
		if operation.ID == "cluster.nodes" {
			t.Error("a degraded capability produced an operation")
		}
	}
}

/*
 * A stored profile holds its secrets in memory. The one thing this server must
 * never do is put them in an answer, and the guard is that nothing is copied
 * out whole - connectionSummary is built field by field.
 *
 * This asserts the shape rather than a value, because a value test passes
 * until somebody adds a field.
 */
func TestConnectionSummaryCannotCarrySecrets(t *testing.T) {
	summary := reflect.TypeFor[connectionSummary]()
	profile := reflect.TypeFor[model.ConnectionProfile]()

	if _, leaks := summary.FieldByName("Secrets"); leaks {
		t.Error("connectionSummary has a Secrets field")
	}
	if _, leaks := summary.FieldByName("Auth"); leaks {
		t.Error("connectionSummary has an Auth field, which carries the mechanism and its credentials")
	}
	// Anything a profile gained that this happens to share a name with is
	// still copied deliberately, one field at a time, in listConnections.
	if summary.NumField() >= profile.NumField() {
		t.Errorf("connectionSummary has %d fields to the profile's %d, which is no longer a subset chosen by hand",
			summary.NumField(), profile.NumField())
	}

	// The profile itself must keep secrets out of JSON, since that is what
	// stops a future summary from leaking them by embedding one.
	field, ok := profile.FieldByName("Secrets")
	if !ok {
		t.Fatal("ConnectionProfile no longer has a Secrets field; this test needs rewriting")
	}
	if tag := field.Tag.Get("json"); tag != "-" {
		t.Errorf("ConnectionProfile.Secrets marshals as %q, not as omitted", tag)
	}
}

// The tools have to answer a client, not just a Go caller: an input schema the
// SDK cannot infer, or an output it cannot marshal, fails at the protocol
// rather than in the handler.
func TestToolsRefuseAnUnknownConnectionThroughTheProtocol(t *testing.T) {
	clientSession := session(t, &app.Services{
		Conns:       func(int) (driver.Conn, error) { return nil, driver.ErrNotConnected },
		Connections: emptyConnections(t),
	})

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
