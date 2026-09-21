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
	return &server{
		services:  &app.Services{Conns: func(int) (driver.Conn, error) { return conn, nil }},
		translate: testPhrases,
		offered:   offeredTools(catalog.BlastDestructive),
	}
}

// testPhrases stands in for the application's translations. The real ones are
// the renderer's locale files, which only the composition root can reach.
func testPhrases(key string) string {
	if text, ok := map[string]string{
		"mq.rabbitmq.caveat.browseAltersQueue": "browsing requeues the message flagged redelivered",
		"mq.rocketmq.degraded.proxy":           "a Proxy endpoint is a data plane only",
	}[key]; ok {
		return text
	}
	return key
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
func session(t *testing.T, services *app.Services, allow catalog.Blast) *mcp.ClientSession {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)

	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	server := New(services, "test", allow, testPhrases)
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

func TestToolsTableNamesRealOperations(t *testing.T) {
	for operationID, info := range tools {
		if _, known := catalog.Find(operationID); !known {
			t.Errorf("tools names %q, which is not a catalogue operation", operationID)
		}
		if info.name == "" || info.title == "" || info.description == "" {
			t.Errorf("%s is presented incompletely: %#v", operationID, info)
		}
	}
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
		names := map[string]bool{"connections_list": true, "capabilities_describe": true}
		for operationID, info := range tools {
			operation, _ := catalog.Find(operationID)
			if catalog.Permits(allow, operation.Blast) {
				names[info.name] = true
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
	for operationID, info := range tools {
		operation, known := catalog.Find(operationID)
		if !known {
			continue
		}
		tool := offered[info.name]
		if tool == nil {
			t.Errorf("%s is not offered even at the widest allowance", info.name)
			continue
		}
		if tool.Annotations == nil {
			t.Errorf("%s carries no annotations", info.name)
			continue
		}
		if want := operation.Blast == catalog.BlastRead; tool.Annotations.ReadOnlyHint != want {
			t.Errorf("%s: readOnlyHint = %v, but the catalogue calls it %s",
				info.name, tool.Annotations.ReadOnlyHint, operation.Blast)
		}
		destructive := tool.Annotations.DestructiveHint
		if destructive == nil {
			t.Errorf("%s does not say whether it is destructive", info.name)
			continue
		}
		if want := operation.Blast == catalog.BlastDestructive; *destructive != want {
			t.Errorf("%s: destructiveHint = %v, but the catalogue calls it %s",
				info.name, *destructive, operation.Blast)
		}
	}
}

// A supported capability answers, and carries whatever the endpoint said about
// it. The caveat is the endpoint's own: the same operation has different
// consequences on different families, and inventing one here would be a
// warning nobody made.
func TestCapableCarriesTheEndpointsCaveat(t *testing.T) {
	const key = "mq.rabbitmq.caveat.browseAltersQueue"
	s := serverWith(&fakeConn{
		kind: model.KindRabbitMQ,
		capabilities: model.NewCapabilities(model.CapMessageQuery).
			WithCaveat(model.CapMessageQuery, key),
	})

	got, _, err := func() (string, driver.Conn, error) {
		conn, caveat, err := s.capable(1, model.CapMessageQuery)
		return caveat, conn, err
	}()
	if err != nil {
		t.Fatalf("capable: %v", err)
	}
	// What a driver stores is a key; what a caller with no renderer needs is
	// the sentence behind it.
	if got == key {
		t.Errorf("the caveat came back as the raw key %q", got)
	}
	if got != testPhrases(key) {
		t.Errorf("caveat = %q, want the resolved text", got)
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
	const reasonKey = "mq.rocketmq.degraded.proxy"
	degraded := serverWith(&fakeConn{
		kind: model.KindRocketMQ,
		capabilities: model.NewCapabilities(model.CapDestinationList).
			WithDegraded(model.CapDestinationList, reasonKey),
	})
	_, _, err := degraded.capable(1, model.CapDestinationList)
	if err == nil {
		t.Fatal("a degraded capability answered as though it worked")
	}
	if !strings.Contains(err.Error(), testPhrases(reasonKey)) {
		t.Errorf("the driver's reason did not travel, or travelled as a key: %v", err)
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

/*
 * A family setting nobody reads is dropped in silence by the driver, and the
 * call still succeeds. That is the failure this refusal exists to prevent: a
 * caller that asked for a quorum queue and got a classic one has no way to
 * tell afterwards.
 */
func TestUnknownAttributesAreRefusedByName(t *testing.T) {
	s := serverWith(&fakeConn{kind: model.KindRabbitMQ})

	err := s.checkAttributes(model.KindRabbitMQ, "destination.create",
		map[string]string{"queueType": "quorum"})
	if err != nil {
		t.Errorf("a declared key was refused: %v", err)
	}

	err = s.checkAttributes(model.KindRabbitMQ, "destination.create",
		map[string]string{"replicationFactor": "3"})
	if err == nil {
		t.Fatal("a key this family does not read was accepted and would have been ignored")
	}
	// The refusal has to name what would have worked, or a caller can only
	// guess again.
	if !strings.Contains(err.Error(), "queueType") {
		t.Errorf("the refusal does not say what the family does take: %v", err)
	}

	// A family that reads nothing on an operation says so rather than listing
	// an empty set.
	err = s.checkAttributes(model.KindNATS, "destination.create",
		map[string]string{"anything": "1"})
	if err == nil || !strings.Contains(err.Error(), "takes no settings") {
		t.Errorf("a family with no declared settings did not say so: %v", err)
	}
}

// capabilities_describe is where a caller learns what to put in attributes,
// and it is the only place: the tool's own schema says "a map of strings".
func TestDescribeCarriesTheFamilysWriteSettings(t *testing.T) {
	s := serverWith(&fakeConn{
		kind:         model.KindRabbitMQ,
		capabilities: model.NewCapabilities(model.CapDestinationCreate),
	})

	_, output, err := s.describeCapabilities(context.Background(), nil, connectionInput{Connection: 1})
	if err != nil {
		t.Fatalf("describe: %v", err)
	}
	for _, operation := range output.Operations {
		if operation.ID != "destination.create" {
			continue
		}
		if len(operation.Attributes) == 0 {
			t.Fatal("rabbitmq declares settings for destination.create and none came back")
		}
		for _, attribute := range operation.Attributes {
			if attribute.Key == "" || attribute.Type == "" || attribute.Summary == "" {
				t.Errorf("an attribute came back incomplete: %#v", attribute)
			}
		}
		return
	}
	t.Fatal("destination.create did not come back at all")
}
