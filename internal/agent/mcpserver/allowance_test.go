package mcpserver

import (
	"context"
	"encoding/json"
	"maps"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/amigoer/mq-studio/internal/agent/catalog"
	"github.com/amigoer/mq-studio/internal/app"
	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/destination"
	"github.com/amigoer/mq-studio/internal/storage/layout"
)

func TestParseAllowanceReadsEachForm(t *testing.T) {
	cases := []struct {
		values     []string
		everywhere catalog.Blast
		named      map[string]catalog.Blast
	}{
		{nil, catalog.BlastRead, map[string]catalog.Blast{}},
		{[]string{"mutate"}, catalog.BlastMutate, map[string]catalog.Blast{}},
		{[]string{"scratch=destructive"}, catalog.BlastRead,
			map[string]catalog.Blast{"scratch": catalog.BlastDestructive}},
		{[]string{"mutate", " local rabbit = destructive "}, catalog.BlastMutate,
			map[string]catalog.Blast{"local rabbit": catalog.BlastDestructive}},
		// A tier never holds an equals sign, so a name that does keeps it.
		{[]string{"a=b=mutate"}, catalog.BlastRead, map[string]catalog.Blast{"a=b": catalog.BlastMutate}},
	}
	for _, c := range cases {
		allowance, err := ParseAllowance(c.values)
		if err != nil {
			t.Errorf("%q: %v", c.values, err)
			continue
		}
		if allowance.Everywhere != c.everywhere || !maps.Equal(allowance.Named, c.named) {
			t.Errorf("%q read as %+v", c.values, allowance)
		}
	}
}

// Each of these could only have been meant some other way, and a server that
// guessed which would be deciding on the operator's behalf.
func TestParseAllowanceRefusesWhatCannotMeanOneThing(t *testing.T) {
	cases := map[string][]string{
		"not one of read":     {"everything"},
		"<name>=<tier>":       {"destructive=scratch"},
		"names no connection": {"=destructive"},
		"both say how far":    {"read", "mutate"},
		"twice":               {"scratch=mutate", "scratch=destructive"},
	}
	for want, values := range cases {
		if _, err := ParseAllowance(values); err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%q: got %v, want an error saying %q", values, err, want)
		}
	}
}

func stored(profiles ...model.ConnectionProfile) []*model.ConnectionProfile {
	pointers := make([]*model.ConnectionProfile, 0, len(profiles))
	for index := range profiles {
		pointers = append(pointers, &profiles[index])
	}
	return pointers
}

func TestGrantPinsANameToTheConnectionStoredUnderIt(t *testing.T) {
	grants, err := Allowance{
		Everywhere: catalog.BlastRead,
		Named:      map[string]catalog.Blast{"scratch": catalog.BlastDestructive},
	}.Grant(stored(
		model.ConnectionProfile{ID: 3, Name: "production"},
		model.ConnectionProfile{ID: 7, Name: "scratch"},
	))
	if err != nil {
		t.Fatal(err)
	}
	if granted := grants.named[7]; granted.blast != catalog.BlastDestructive || len(grants.named) != 1 {
		t.Fatalf("pinned %+v", grants.named)
	}
	if grants.widest() != catalog.BlastDestructive {
		t.Errorf("widest = %q", grants.widest())
	}
	// The line on stderr is the one place the operator sees what was granted.
	const want = `"read" on every connection, "destructive" on "scratch" (connection 7)`
	if grants.String() != want {
		t.Errorf("described as %s, want %s", grants.String(), want)
	}
}

// Every one of these is a grant that would not do what it says, so the server
// must not start - and all of them are reported, so fixing one does not only
// reveal the next.
func TestGrantRefusesANameItCannotPin(t *testing.T) {
	_, err := Allowance{
		Everywhere: catalog.BlastMutate,
		Named: map[string]catalog.Blast{
			"scrach":  catalog.BlastDestructive,
			"twin":    catalog.BlastDestructive,
			"scratch": catalog.BlastMutate,
		},
	}.Grant(stored(
		model.ConnectionProfile{ID: 1, Name: "scratch"},
		model.ConnectionProfile{ID: 2, Name: "twin"},
		model.ConnectionProfile{ID: 3, Name: "twin"},
	))
	if err == nil {
		t.Fatal("a misspelt, an ambiguous and an idle grant were all accepted")
	}
	for _, want := range []string{
		`"scrach=destructive" names no stored connection; the stored ones are "scratch", "twin"`,
		"could mean any of connections [2 3]",
		`"scratch=mutate" changes nothing`,
	} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("the refusal does not say %q:\n%v", want, err)
		}
	}

	if _, err := (Allowance{
		Everywhere: catalog.BlastRead,
		Named:      map[string]catalog.Blast{"scratch": catalog.BlastMutate},
	}).Grant(nil); err == nil || !strings.Contains(err.Error(), "no connection is stored yet") {
		t.Errorf("a grant against an empty store: %v", err)
	}
}

// grantedWorld is a server whose store holds two RabbitMQ connections,
// scratch and production, beside a window that can edit them. Every dial
// reaches one fake connection and is counted, so a refusal can be shown to
// have come before any.
type grantedWorld struct {
	server, window *app.Services
	paths          layout.Layout
	ids            map[string]int
	conn           *namespacedConn
	dials          *atomic.Int32
}

func newGrantedWorld(t *testing.T) grantedWorld {
	t.Helper()
	server, window, paths := serverAndWindow(t)
	world := grantedWorld{
		server: server, window: window, paths: paths, ids: map[string]int{},
		conn: &namespacedConn{fakeConn: fakeConn{
			kind: model.KindRabbitMQ,
			capabilities: model.NewCapabilities(
				model.CapDestinationList, model.CapDestinationCreate, model.CapDestinationDelete,
				model.CapDestinationPurge),
		}},
		dials: &atomic.Int32{},
	}
	for _, name := range []string{"scratch", "production"} {
		saved, err := window.Connections.AddConnection(rabbitProfile(name, "http://"+name+".invalid:15672"))
		if err != nil {
			t.Fatalf("save %s in the window: %v", name, err)
		}
		world.ids[name] = saved.ID
	}
	// What the server would have read when it started.
	if err := server.RefreshReadOnly(); err != nil {
		t.Fatal(err)
	}

	world.dialTo(world.conn)
	return world
}

// dialTo makes every dial the server makes reach conn, and counts it.
func (w grantedWorld) dialTo(conn driver.Conn) {
	conns := func(int) (driver.Conn, error) {
		w.dials.Add(1)
		return conn, nil
	}
	w.server.Conns = conns
	w.server.Topics = destination.New(conns, requestTimeout{})
}

func rabbitProfile(name, endpoints string) model.ConnectionProfile {
	profile := model.ConnectionProfile{
		Name: name, Kind: model.KindRabbitMQ, Endpoints: endpoints, TimeoutSec: 5,
		Auth: model.AuthConfig{Mechanism: model.AuthPlain},
	}
	profile.SetSecret("username", "guest")
	profile.SetSecret("password", "guest")
	return profile
}

// session starts a server that allows destructive on scratch alone, for a
// client that cannot ask a person anything.
func (w grantedWorld) session(t *testing.T) *mcp.ClientSession {
	t.Helper()
	return connect(t, w.server, w.grants(t), clientSetup{})
}

// confirming is session for a client whose person says yes to everything.
func (w grantedWorld) confirming(t *testing.T) *mcp.ClientSession {
	t.Helper()
	return connect(t, w.server, w.grants(t), clientSetup{answer: accept})
}

func (w grantedWorld) grants(t *testing.T) Grants {
	t.Helper()
	grants, err := Allowance{
		Everywhere: catalog.BlastRead,
		Named:      map[string]catalog.Blast{"scratch": catalog.BlastDestructive},
	}.Grant(w.server.Connections.GetConnections())
	if err != nil {
		t.Fatal(err)
	}
	return grants
}

func callTool(t *testing.T, clientSession *mcp.ClientSession, name string, arguments map[string]any) (bool, string) {
	t.Helper()
	encoded, err := json.Marshal(arguments)
	if err != nil {
		t.Fatal(err)
	}
	result, err := clientSession.CallTool(t.Context(), &mcp.CallToolParams{
		Name: name, Arguments: json.RawMessage(encoded)})
	if err != nil {
		t.Fatalf("call %s: %v", name, err)
	}
	var text strings.Builder
	for _, content := range result.Content {
		if part, ok := content.(*mcp.TextContent); ok {
			text.WriteString(part.Text)
		}
	}
	return result.IsError, text.String()
}

func allowedOn(t *testing.T, clientSession *mcp.ClientSession) map[string]string {
	t.Helper()
	_, output := listConnections(t, clientSession)
	allowed := make(map[string]string, len(output.Connections))
	for _, summary := range output.Connections {
		allowed[summary.Name] = summary.Allow
	}
	return allowed
}

/*
 * The case the named form exists for: destructive, to empty a scratch queue,
 * must not reach production in the same session.
 *
 * The tool is listed, because some connection may use it, and it is refused
 * on the one that may not before anything is dialled - so there is nothing
 * the broker could have done by the time the refusal arrives.
 */
func TestAGrantReachesOnlyTheConnectionItNames(t *testing.T) {
	world := newGrantedWorld(t)
	clientSession := world.confirming(t)

	tools, err := clientSession.ListTools(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	listed := false
	for _, tool := range tools.Tools {
		if tool.Name == "destination_delete" {
			listed = true
			if !strings.Contains(tool.Description, "connections_list says how far") {
				t.Errorf("a tool not every connection may use does not say so: %q", tool.Description)
			}
		}
		if tool.Name == "messages_browse" && strings.Contains(tool.Description, "Refused on") {
			t.Error("a read every connection may do claims to be refused somewhere")
		}
	}
	if !listed {
		t.Fatal("destination_delete is not listed although scratch may use it")
	}

	allowed := allowedOn(t, clientSession)
	if allowed["scratch"] != "destructive" || allowed["production"] != "read" {
		t.Errorf("connections_list says %v", allowed)
	}

	refused, text := callTool(t, clientSession, "destination_delete",
		map[string]any{"connection": world.ids["production"], "name": "orders"})
	if !refused || !strings.Contains(text, "may go no further than read") {
		t.Fatalf("production was not refused: %q", text)
	}
	if !strings.Contains(text, "asking will not change it") {
		t.Errorf("the refusal reads as though it could be argued with: %q", text)
	}
	if world.dials.Load() != 0 || len(world.conn.removed) != 0 {
		t.Fatalf("dialled %d times and removed %v before refusing", world.dials.Load(), world.conn.removed)
	}

	if refused, text := callTool(t, clientSession, "destination_delete",
		map[string]any{"connection": world.ids["scratch"], "name": "orders"}); refused {
		t.Fatalf("scratch was refused: %q", text)
	}
	if len(world.conn.removed) != 1 {
		t.Fatalf("removed %v, want orders once", world.conn.removed)
	}
}

// capabilities_describe is where a caller learns what it can do here, so an
// operation this connection was not allowed must not name a tool for it.
func TestDescribeNamesOnlyTheToolsThisConnectionMayUse(t *testing.T) {
	world := newGrantedWorld(t)
	clientSession := world.confirming(t)

	for name, want := range map[string]string{"scratch": "destination_delete", "production": ""} {
		result, err := clientSession.CallTool(t.Context(), &mcp.CallToolParams{
			Name:      "capabilities_describe",
			Arguments: map[string]any{"connection": world.ids[name]},
		})
		if err != nil || result.IsError {
			t.Fatalf("describe %s: %v %v", name, err, result)
		}
		var output describeOutput
		encoded, _ := json.Marshal(result.StructuredContent)
		if err := json.Unmarshal(encoded, &output); err != nil {
			t.Fatal(err)
		}
		for _, operation := range output.Operations {
			if operation.ID == "destination.delete" && operation.Tool != want {
				t.Errorf("%s: destination.delete names tool %q, want %q", name, operation.Tool, want)
			}
			if operation.ID == "destination.list" && operation.Tool != "destinations_list" {
				t.Errorf("%s: a read lost its tool", name)
			}
		}
		if wantAllow := map[string]string{"scratch": "destructive", "production": "read"}[name]; output.Allow != wantAllow {
			t.Errorf("%s: allow = %q, want %q", name, output.Allow, wantAllow)
		}
	}
}

/*
 * A grant covers the broker the connection reached when it was made.
 *
 * Renaming it, or giving it another timeout, leaves it reaching the same one;
 * pointing it at another broker in the window does not, and the grant must
 * not follow it there - a scratch connection re-pointed at production is the
 * very thing the grant was for keeping away from.
 */
func TestAGrantLapsesWhenItsConnectionIsPointedElsewhere(t *testing.T) {
	world := newGrantedWorld(t)
	clientSession := world.confirming(t)
	id := world.ids["scratch"]

	relabelled := rabbitProfile("scratch, renamed", "http://scratch.invalid:15672")
	relabelled.TimeoutSec = 30
	if _, err := world.window.Connections.UpdateConnection(id, relabelled); err != nil {
		t.Fatal(err)
	}
	if refused, text := callTool(t, clientSession, "destination_delete",
		map[string]any{"connection": id, "name": "orders"}); refused {
		t.Fatalf("a rename and a new timeout lost the grant: %q", text)
	}

	repointed := rabbitProfile("scratch, renamed", "http://production.invalid:15672")
	if _, err := world.window.Connections.UpdateConnection(id, repointed); err != nil {
		t.Fatal(err)
	}
	dials := world.dials.Load()
	refused, text := callTool(t, clientSession, "destination_delete",
		map[string]any{"connection": id, "name": "orders"})
	if !refused || !strings.Contains(text, "pointed at another broker") {
		t.Fatalf("the grant followed the connection to another broker: %q", text)
	}
	if world.dials.Load() != dials || len(world.conn.removed) != 1 {
		t.Fatalf("dialled or removed after the grant lapsed: %v", world.conn.removed)
	}
	if allowed := allowedOn(t, clientSession); allowed["scratch, renamed"] != "read" {
		t.Errorf("connections_list still says %v", allowed)
	}
}

// requiredArguments fills a tool's required arguments from its input schema,
// with the connection given. The values are nonsense beyond passing the
// schema, which is all a call needs to reach the check in front of a handler.
func requiredArguments(t *testing.T, tool *mcp.Tool, connection int) map[string]any {
	t.Helper()
	var schema struct {
		Required   []string `json:"required"`
		Properties map[string]struct {
			Type any `json:"type"`
		} `json:"properties"`
	}
	encoded, err := json.Marshal(tool.InputSchema)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(encoded, &schema); err != nil {
		t.Fatal(err)
	}
	arguments := map[string]any{"connection": connection}
	for _, name := range schema.Required {
		if name == "connection" {
			continue
		}
		switch schema.Properties[name].Type {
		case "integer", "number":
			arguments[name] = 1
		case "boolean":
			arguments[name] = false
		default:
			arguments[name] = "x"
		}
	}
	return arguments
}

/*
 * Every tool that goes further than every connection may checks the
 * connection it was handed, whichever tool it is.
 *
 * Walked from the tool list rather than written out, so a write tool added
 * later is held to this without anybody remembering to add it here - which is
 * the one way the check could go missing and every other test still pass.
 */
func TestEveryToolAboveTheCeilingChecksItsConnection(t *testing.T) {
	world := newGrantedWorld(t)
	clientSession := world.session(t)

	tools, err := clientSession.ListTools(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	checked := 0
	for _, tool := range tools.Tools {
		if tool.Annotations == nil || tool.Annotations.ReadOnlyHint {
			continue
		}
		checked++
		dials := world.dials.Load()
		refused, text := callTool(t, clientSession, tool.Name,
			requiredArguments(t, tool, world.ids["production"]))
		if !refused || !strings.Contains(text, "may go no further than read") {
			t.Errorf("%s on production: %q", tool.Name, text)
		}
		if world.dials.Load() != dials {
			t.Errorf("%s dialled production before refusing it", tool.Name)
		}
		_, text = callTool(t, clientSession, tool.Name, requiredArguments(t, tool, world.ids["scratch"]))
		if strings.Contains(text, "may go no further") {
			t.Errorf("%s on scratch was refused by the allowance: %q", tool.Name, text)
		}
	}
	if checked < 6 {
		t.Fatalf("checked %d tools that write, and the server has at least six", checked)
	}
}

// heldConn holds a delete open until it is released, so a test can act while
// a write is in flight.
type heldConn struct {
	*namespacedConn
	entered chan struct{}
	release chan struct{}
}

func (c *heldConn) RemoveDestination(ctx context.Context, ref model.DestinationRef) error {
	c.entered <- struct{}{}
	<-c.release
	return c.namespacedConn.RemoveDestination(ctx, ref)
}

/*
 * No refresh lands while a call a grant was checked for is running.
 *
 * Calls run at once, and the check reads the stored profile before the
 * handler dials by id. Another call's refresh landing in between could swap in
 * a profile the window had just pointed at production, and the dial would go
 * there on the strength of a check made against scratch. The race is too
 * narrow to catch in the act, so this pins what closes it: while a delete is
 * in flight, the next call does not get as far as reading the store.
 */
func TestARefreshWaitsForAWriteInFlight(t *testing.T) {
	world := newGrantedWorld(t)
	held := &heldConn{namespacedConn: world.conn, entered: make(chan struct{}), release: make(chan struct{})}
	world.dialTo(held)
	clientSession := world.confirming(t)
	release := sync.OnceFunc(func() { close(held.release) })
	t.Cleanup(release)
	id := world.ids["scratch"]

	deleted := make(chan *mcp.CallToolResult, 1)
	go func() {
		result, _ := clientSession.CallTool(context.Background(), &mcp.CallToolParams{
			Name: "destination_delete", Arguments: map[string]any{"connection": id, "name": "orders"}})
		deleted <- result
	}()
	<-held.entered

	if _, err := world.window.Connections.UpdateConnection(
		id, rabbitProfile("scratch", "http://production.invalid:15672")); err != nil {
		t.Fatal(err)
	}
	listed := make(chan *mcp.CallToolResult, 1)
	go func() {
		result, _ := clientSession.CallTool(context.Background(), &mcp.CallToolParams{
			Name: "connections_list", Arguments: map[string]any{}})
		listed <- result
	}()
	select {
	case <-listed:
		t.Fatal("a refresh landed while a delete was in flight")
	case <-time.After(200 * time.Millisecond):
	}

	release()
	if result := <-deleted; result == nil || result.IsError {
		t.Fatalf("the delete in flight did not finish: %+v", result)
	}
	if result := <-listed; result == nil || result.IsError {
		t.Fatalf("the listing waiting on it did not finish: %+v", result)
	}
	if allowed := allowedOn(t, clientSession); allowed["scratch"] != "read" {
		t.Errorf("once the delete finished, the refresh did not see scratch re-pointed: %v", allowed)
	}
}
