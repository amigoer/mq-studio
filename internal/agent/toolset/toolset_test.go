package toolset

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/agent/catalog"
	"github.com/amigoer/mq-studio/internal/app"
	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
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

// envWith runs the tools against one connection, with every tool offered and
// every connection allowed as far as the catalogue goes.
func envWith(conn driver.Conn) *Env {
	return &Env{
		Services:  &app.Services{Conns: func(int) (driver.Conn, error) { return conn, nil }},
		Translate: testPhrases,
		Allow:     func(int) catalog.Blast { return catalog.BlastDestructive },
		Offered:   offered(),
	}
}

// offered names every tool by the operation it performs, as a transport that
// registered them all would.
func offered() map[string]string {
	names := make(map[string]string)
	for _, tool := range All() {
		if tool.Operation != "" {
			names[tool.Operation] = tool.Name
		}
	}
	return names
}

// requestTimeout is the settings the domain services read their bounds from.
type requestTimeout struct{}

func (requestTimeout) GetRequestTimeout() time.Duration { return time.Second }
func (requestTimeout) GetFetchLimit() int               { return 32 }

// testPhrases stands in for the application's translations. The real ones are
// the renderer's locale files, which only the composition root can embed.
//
// What the tools word themselves - the questions put to a person - is read
// from the real English file instead, so a placeholder renamed there fails
// these tests rather than reaching somebody as {{destination}}.
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

func TestEveryToolIsPresentedCompletely(t *testing.T) {
	names := make(map[string]bool)
	for _, tool := range All() {
		if tool.Name == "" || tool.Title == "" || tool.Description == "" {
			t.Errorf("%q is presented incompletely: %#v", tool.Name, tool)
		}
		if names[tool.Name] {
			t.Errorf("%s is defined twice", tool.Name)
		}
		names[tool.Name] = true
		if tool.Operation != "" {
			if _, known := catalog.Find(tool.Operation); !known {
				t.Errorf("%s names %q, which is not a catalogue operation", tool.Name, tool.Operation)
			}
		}
		if found, ok := Lookup(tool.Name); !ok || found.Operation != tool.Operation {
			t.Errorf("%s cannot be looked up by its name", tool.Name)
		}
	}
	for _, name := range []string{"connections_list", "capabilities_describe"} {
		if tool, ok := Lookup(name); !ok || tool.Operation != "" || tool.Blast != catalog.BlastRead {
			t.Errorf("%s is not the read about the installation every caller starts with", name)
		}
	}
}

// A supported capability answers, and carries whatever the endpoint said about
// it. The caveat is the endpoint's own: the same operation has different
// consequences on different families, and inventing one here would be a
// warning nobody made.
func TestCapableCarriesTheEndpointsCaveat(t *testing.T) {
	const key = "mq.rabbitmq.caveat.browseAltersQueue"
	e := envWith(&fakeConn{
		kind: model.KindRabbitMQ,
		capabilities: model.NewCapabilities(model.CapMessageQuery).
			WithCaveat(model.CapMessageQuery, key),
	})

	_, got, err := e.capable(1, model.CapMessageQuery)
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
	degraded := envWith(&fakeConn{
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

	absent := envWith(&fakeConn{
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

// capabilities_describe is the tool a caller is sent to first, so what it says
// has to be the connection's own answer.
func TestDescribeReportsOperationsAndAbsences(t *testing.T) {
	const reason = "a Proxy endpoint is a data plane only"
	e := envWith(&fakeConn{
		kind: model.KindRocketMQ,
		capabilities: model.NewCapabilities(model.CapMessageQuery, model.CapDestinationList).
			WithDegraded(model.CapClusterTopology, reason),
	})

	output, err := e.describeCapabilities(context.Background(), connectionInput{Connection: 1})
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
	// An operation with no tool is a fact about the tools, not about the
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

// A destructive tool is named only to a caller that can put the question it
// needs to a person; to any other it would be a tool that always refuses.
func TestDescribeNamesADestructiveToolOnlyToACallerThatCanConfirm(t *testing.T) {
	e := envWith(&fakeConn{
		kind:         model.KindRabbitMQ,
		capabilities: model.NewCapabilities(model.CapDestinationList, model.CapDestinationDelete),
	})
	toolFor := func(ctx context.Context) string {
		t.Helper()
		output, err := e.describeCapabilities(ctx, connectionInput{Connection: 1})
		if err != nil {
			t.Fatalf("describe: %v", err)
		}
		for _, operation := range output.Operations {
			if operation.ID == "destination.delete" {
				return operation.Tool
			}
		}
		t.Fatal("destination.delete did not come back")
		return ""
	}

	if tool := toolFor(context.Background()); tool != "" {
		t.Errorf("a caller nobody said could confirm was pointed at %s", tool)
	}
	if tool := toolFor(WithCaller(context.Background(), Caller{Confirms: true})); tool != "destination_delete" {
		t.Errorf("a caller that can confirm was pointed at %q", tool)
	}
}

/*
 * A stored profile holds its secrets in memory. The one thing a tool must
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

/*
 * A family setting nobody reads is dropped in silence by the driver, and the
 * call still succeeds. That is the failure this refusal exists to prevent: a
 * caller that asked for a quorum queue and got a classic one has no way to
 * tell afterwards.
 */
func TestUnknownAttributesAreRefusedByName(t *testing.T) {
	e := envWith(&fakeConn{kind: model.KindRabbitMQ})

	err := e.checkAttributes(model.KindRabbitMQ, "destination.create",
		map[string]string{"queueType": "quorum"})
	if err != nil {
		t.Errorf("a declared key was refused: %v", err)
	}

	err = e.checkAttributes(model.KindRabbitMQ, "destination.create",
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
	err = e.checkAttributes(model.KindNATS, "destination.create",
		map[string]string{"anything": "1"})
	if err == nil || !strings.Contains(err.Error(), "takes no settings") {
		t.Errorf("a family with no declared settings did not say so: %v", err)
	}
}

// capabilities_describe is where a caller learns what to put in attributes,
// and it is the only place: the tool's own schema says "a map of strings".
func TestDescribeCarriesTheFamilysWriteSettings(t *testing.T) {
	e := envWith(&fakeConn{
		kind:         model.KindRabbitMQ,
		capabilities: model.NewCapabilities(model.CapDestinationCreate),
	})

	output, err := e.describeCapabilities(context.Background(), connectionInput{Connection: 1})
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

/*
 * Without a transport's own resolver the tools use only what this process has
 * open. That is the window's case: a dial from there would record no status
 * and queue the user's own connects behind it, so a connection the window has
 * not opened is refused with what to do about it.
 */
func TestWithoutAResolverAClosedConnectionIsRefused(t *testing.T) {
	e := &Env{
		Services:  &app.Services{Conns: func(int) (driver.Conn, error) { return nil, driver.ErrNotConnected }},
		Translate: testPhrases,
	}
	_, err := e.describeCapabilities(context.Background(), connectionInput{Connection: 7})
	if err == nil || !strings.Contains(err.Error(), "connected in the window") {
		t.Fatalf("a closed connection answered %v", err)
	}
}

// A caller that reaches only open connections has to be told which those are;
// one that dials on demand is told nothing, since nothing it does depends on it.
func TestConnectionsListSaysWhichAreOpenWhereThatMatters(t *testing.T) {
	directory := t.TempDir()
	stored := `{"connections":[` +
		`{"id":1,"name":"orders","kind":"rocketmq","endpoints":"127.0.0.1:9876"},` +
		`{"id":2,"name":"pipeline","kind":"kafka","endpoints":"127.0.0.1:9092"}]}`
	if err := os.WriteFile(filepath.Join(directory, "connections.json"), []byte(stored), 0o600); err != nil {
		t.Fatal(err)
	}
	services, err := app.NewReadOnlyIn(directory)
	if err != nil {
		t.Fatalf("assemble: %v", err)
	}
	t.Cleanup(services.Close)
	open := &fakeConn{kind: model.KindRocketMQ}
	services.Conns = func(id int) (driver.Conn, error) {
		if id == 1 {
			return open, nil
		}
		return nil, driver.ErrNotConnected
	}

	statuses := func(e *Env) map[string]string {
		t.Helper()
		output, err := e.listConnections(context.Background(), struct{}{})
		if err != nil {
			t.Fatal(err)
		}
		status := make(map[string]string, len(output.Connections))
		for _, summary := range output.Connections {
			status[summary.Name] = summary.Status
			if summary.Allow != string(catalog.BlastRead) {
				t.Errorf("%s: with nobody saying otherwise, allow = %q", summary.Name, summary.Allow)
			}
		}
		return status
	}

	if status := statuses(&Env{Services: services}); status["orders"] != "online" || status["pipeline"] != "offline" {
		t.Errorf("only the open one can be used, and the listing said %v", status)
	}
	dialling := &Env{Services: services, Open: func(int) (driver.Conn, error) { return open, nil }}
	if status := statuses(dialling); status["orders"] != "" || status["pipeline"] != "" {
		t.Errorf("a caller that reaches every connection was told %v", status)
	}
}
