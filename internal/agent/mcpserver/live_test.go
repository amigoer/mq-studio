package mcpserver_test

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/amigoer/mq-studio/internal/agent/catalog"
	"github.com/amigoer/mq-studio/internal/agent/mcpserver"
	"github.com/amigoer/mq-studio/internal/app"
	"github.com/amigoer/mq-studio/internal/driver/rabbitmq"
	"github.com/amigoer/mq-studio/internal/e2e"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/storage/layout"
)

/*
 * The MCP server against a real broker.
 *
 * Two things can only be shown here. The first is that a tool and the pages
 * agree: the server is a second adapter over the same services, and the whole
 * claim is that it answers the same question the same way - a tool that
 * quietly read something else would pass every offline test in this
 * repository.
 *
 * The second is that the server leaves the profile store alone. That is not a
 * style preference: the store is rewritten whole under an in-process lock, so
 * a second process that stamped a status into it would be racing the window
 * for the user's own edits. The file is hashed either side of a whole session.
 */

const liveRabbitEndpoint = "http://127.0.0.1:15672"

func requireLiveRabbit(t *testing.T) {
	t.Helper()
	e2e.Require(t, e2e.Env{
		Name:   "the rabbitmq broker",
		Family: e2e.RabbitMQ,
		Start:  "npm run e2e:rabbitmq:up",
		Probe:  e2e.HTTPGet(liveRabbitEndpoint + "/api/overview"),
	})
}

// liveServices is a whole application over a temporary directory, with one
// connection stored in it.
func liveServices(t *testing.T, profile model.ConnectionProfile) (*app.Services, int, layout.Layout) {
	t.Helper()

	directory := t.TempDir()
	paths := layout.In(directory)
	services, err := app.NewReadOnlyIn(directory)
	if err != nil {
		t.Fatalf("assemble: %v", err)
	}
	t.Cleanup(services.Close)

	stored, err := services.Connections.AddConnection(profile)
	if err != nil {
		t.Fatalf("store the profile: %v", err)
	}
	return services, stored.ID, paths
}

// mcpSession runs a real client against the real server over the in-memory
// transport, so what the test calls is what a client calls.
func mcpSession(t *testing.T, services *app.Services, allow catalog.Blast) *mcp.ClientSession {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	t.Cleanup(cancel)

	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	go func() {
		if err := mcpserver.New(services, "test", allow, livePhrases).Run(ctx, serverTransport); err != nil && ctx.Err() == nil {
			t.Errorf("server stopped: %v", err)
		}
	}()

	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "test"}, nil)
	session, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { _ = session.Close() })
	return session
}

// livePhrases resolves the keys this suite expects to see. The real
// translations are the renderer's locale files, which only package main can
// embed; what matters here is that whatever a driver declared went through a
// phrasebook rather than reaching the caller as a key.
func livePhrases(key string) string {
	if key == "mq.rabbitmq.caveat.browseAltersQueue" {
		return "browsing requeues the message flagged redelivered"
	}
	return key
}

// call runs one tool and decodes its structured result.
func call[T any](t *testing.T, session *mcp.ClientSession, tool string, arguments map[string]any) T {
	t.Helper()

	encoded, err := json.Marshal(arguments)
	if err != nil {
		t.Fatal(err)
	}
	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{
		Name:      tool,
		Arguments: json.RawMessage(encoded),
	})
	if err != nil {
		t.Fatalf("%s: %v", tool, err)
	}
	if result.IsError {
		t.Fatalf("%s refused: %v", tool, result.Content)
	}

	var decoded T
	if err := json.Unmarshal(mustJSON(t, result.StructuredContent), &decoded); err != nil {
		t.Fatalf("%s returned something that does not decode: %v", tool, err)
	}
	return decoded
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func liveRabbitProfile() model.ConnectionProfile {
	profile := model.ConnectionProfile{
		Kind:      model.KindRabbitMQ,
		Name:      "mcp-live",
		Endpoints: liveRabbitEndpoint,
		Auth:      model.AuthConfig{Mechanism: model.AuthPlain},
	}
	profile.SetSecret(rabbitmq.SecretUsername, "mqstudio")
	profile.SetSecret(rabbitmq.SecretPassword, "mqstudio")
	return profile
}

// A tool and the service layer behind the pages have to answer the same
// question with the same list. Comparing names rather than whole records is
// deliberate: the shapes are the same types, so equality there would only
// prove that json.Marshal is a function.
func TestLiveMCPDestinationsMatchTheServiceLayer(t *testing.T) {
	requireLiveRabbit(t)

	services, connID, _ := liveServices(t, liveRabbitProfile())
	session := mcpSession(t, services, catalog.BlastRead)

	type destinationsResult struct {
		Destinations []*model.Destination `json:"destinations"`
		Caveat       string               `json:"caveat"`
	}
	viaTool := call[destinationsResult](t, session, "destinations_list",
		map[string]any{"connection": connID})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	viaServices, err := services.Topics.List(ctx, connID, model.DestinationFilter{})
	if err != nil {
		t.Fatalf("list through the services: %v", err)
	}

	if len(viaTool.Destinations) != len(viaServices) {
		t.Fatalf("the tool returned %d destinations, the services %d",
			len(viaTool.Destinations), len(viaServices))
	}
	expected := make(map[model.DestinationRef]bool, len(viaServices))
	for _, destination := range viaServices {
		expected[destination.Ref] = true
	}
	for _, destination := range viaTool.Destinations {
		if !expected[destination.Ref] {
			t.Errorf("the tool returned %v, which the services did not", destination.Ref)
		}
	}
	if len(viaServices) == 0 {
		t.Log("the broker has no destinations; the comparison held but proved little")
	}
}

// The caveat is the point of the whole capability model reaching this far. A
// RabbitMQ browse goes through basic.get and alters the queue, and a caller
// with no screen has nowhere else to learn that.
func TestLiveMCPCarriesTheBrowseCaveat(t *testing.T) {
	requireLiveRabbit(t)

	services, connID, _ := liveServices(t, liveRabbitProfile())
	session := mcpSession(t, services, catalog.BlastRead)

	type describeResult struct {
		Family     string `json:"family"`
		Operations []struct {
			ID     string `json:"id"`
			Blast  string `json:"blast"`
			Caveat string `json:"caveat"`
		} `json:"operations"`
	}
	described := call[describeResult](t, session, "capabilities_describe",
		map[string]any{"connection": connID})

	if described.Family != string(model.KindRabbitMQ) {
		t.Fatalf("family = %q", described.Family)
	}
	var browse *struct {
		ID     string `json:"id"`
		Blast  string `json:"blast"`
		Caveat string `json:"caveat"`
	}
	for i := range described.Operations {
		if described.Operations[i].ID == "message.query" {
			browse = &described.Operations[i]
		}
	}
	if browse == nil {
		t.Fatal("this connection cannot browse, so there is no caveat to carry")
	}
	if browse.Caveat == "" {
		t.Error("the browse caveat did not reach the tool; a caller would read it as side-effect free")
	}
	// The capability model stores i18n keys. One arriving unresolved is worse
	// than useless: it looks like a warning and cannot be read as one.
	if strings.HasPrefix(browse.Caveat, "mq.") {
		t.Errorf("the caveat arrived as a raw key: %q", browse.Caveat)
	}
	if browse.Blast != "read" {
		t.Errorf("browse blast radius = %q, want read", browse.Blast)
	}
}

/*
 * The read-only claim, asserted rather than asserted-in-a-comment.
 *
 * Connect stamps a status and a check time into the profile store and saves
 * the whole file. The MCP server dials through OpenReadOnly instead, and this
 * is what holds it there: a whole session - opening a connection it had not
 * opened, and reading through it - must leave the bytes on disk identical.
 */
func TestLiveMCPLeavesTheProfileStoreAlone(t *testing.T) {
	requireLiveRabbit(t)

	services, connID, paths := liveServices(t, liveRabbitProfile())
	before := hashFile(t, paths.ConnectionsFile)

	session := mcpSession(t, services, catalog.BlastRead)
	type destinationsResult struct {
		Destinations []*model.Destination `json:"destinations"`
	}
	// Opening the connection is the part that would write, so the tool has to
	// be one that dials rather than one answered from the stored profiles.
	call[destinationsResult](t, session, "destinations_list", map[string]any{"connection": connID})

	if after := hashFile(t, paths.ConnectionsFile); after != before {
		t.Error("the MCP server rewrote the profile store; the window is the only writer")
	}
}

func hashFile(t *testing.T, path string) [32]byte {
	t.Helper()
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return sha256.Sum256(contents)
}

/*
 * The write tools against a real broker.
 *
 * What an offline test cannot show is that the effect a tool reports is true.
 * "emptied the queue" is a sentence either way; only a broker can say whether
 * the queue is empty afterwards, and that is the whole value of the line.
 */
func TestLiveMCPWritesDoWhatTheySay(t *testing.T) {
	requireLiveRabbit(t)

	services, connID, paths := liveServices(t, liveRabbitProfile())
	session := mcpSession(t, services, catalog.BlastDestructive)
	before := hashFile(t, paths.ConnectionsFile)

	name := "mq-studio-mcp-" + strconv.FormatInt(time.Now().UnixNano(), 36)
	ref := model.DestinationRef{Name: name}

	type writeResult struct {
		Effect struct {
			Changed string `json:"changed"`
			Caveat  string `json:"caveat"`
		} `json:"effect"`
		Reference string `json:"reference"`
	}

	created := call[writeResult](t, session, "destination_create", map[string]any{
		"connection": connID,
		"name":       name,
		// Declared for this family by the catalogue, and read by the driver.
		"attributes": map[string]string{"durable": "true", "queueType": "classic"},
	})
	if created.Effect.Changed == "" {
		t.Error("creating a destination reported no effect")
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		_ = services.Topics.Remove(ctx, connID, ref)
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := services.Topics.Detail(ctx, connID, ref); err != nil {
		t.Fatalf("the tool said it created %s and the broker does not have it: %v", name, err)
	}

	published := call[writeResult](t, session, "message_publish", map[string]any{
		"connection":  connID,
		"destination": name,
		"body":        "from the mcp server",
	})
	if published.Effect.Changed == "" {
		t.Error("publishing reported no effect")
	}

	// The broker counts asynchronously, so the depth is read until it shows
	// the message rather than once, immediately. Absence here would otherwise
	// be indistinguishable from a message that simply had not landed yet.
	if depth := awaitDepth(t, services, connID, ref, func(depth int64) bool { return depth > 0 }); depth == 0 {
		t.Fatal("the tool said it published and the queue never showed a message")
	}

	purged := call[writeResult](t, session, "destination_purge", map[string]any{
		"connection": connID,
		"name":       name,
	})
	if purged.Effect.Changed == "" {
		t.Error("emptying reported no effect")
	}
	if depth := awaitDepth(t, services, connID, ref, func(depth int64) bool { return depth == 0 }); depth != 0 {
		t.Errorf("the tool said it emptied %s and the queue still holds %d", name, depth)
	}

	deleted := call[writeResult](t, session, "destination_delete", map[string]any{
		"connection": connID,
		"name":       name,
	})
	if deleted.Effect.Changed == "" {
		t.Error("deleting reported no effect")
	}
	if _, err := services.Topics.Detail(ctx, connID, ref); err == nil {
		t.Errorf("the tool said it deleted %s and the broker still has it", name)
	}

	// Four writes to the broker and still not one to the profile store.
	if after := hashFile(t, paths.ConnectionsFile); after != before {
		t.Error("the MCP server rewrote the profile store")
	}
}

// awaitDepth reads a destination's depth until it satisfies want, or gives up.
func awaitDepth(
	t *testing.T, services *app.Services, connID int,
	ref model.DestinationRef, want func(int64) bool,
) int64 {
	t.Helper()

	deadline := time.Now().Add(20 * time.Second)
	var depth int64
	for time.Now().Before(deadline) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		destination, err := services.Topics.Detail(ctx, connID, ref)
		cancel()
		if err == nil && destination != nil {
			depth = destination.Depth
			if want(depth) {
				return depth
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
	return depth
}

// A setting this family does not read has to be refused rather than dropped.
// The driver would ignore it and the call would succeed, which is the one
// outcome a caller cannot detect.
func TestLiveMCPRefusesASettingTheFamilyIgnores(t *testing.T) {
	requireLiveRabbit(t)

	services, connID, _ := liveServices(t, liveRabbitProfile())
	session := mcpSession(t, services, catalog.BlastDestructive)

	arguments, err := json.Marshal(map[string]any{
		"connection": connID,
		"name":       "mq-studio-mcp-never-created",
		"attributes": map[string]string{"replicationFactor": "3"},
	})
	if err != nil {
		t.Fatal(err)
	}
	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{
		Name:      "destination_create",
		Arguments: json.RawMessage(arguments),
	})
	if err != nil {
		t.Fatalf("call tool: %v", err)
	}
	if !result.IsError {
		t.Fatal("a setting rabbitmq does not read was accepted")
	}
}

// The default server is the one somebody gets by starting it without thinking
// about it, and it must not be able to write at all.
func TestLiveMCPDefaultServerCannotWrite(t *testing.T) {
	requireLiveRabbit(t)

	services, _, _ := liveServices(t, liveRabbitProfile())
	session := mcpSession(t, services, catalog.BlastRead)

	tools, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatalf("list tools: %v", err)
	}
	for _, tool := range tools.Tools {
		if tool.Annotations == nil || !tool.Annotations.ReadOnlyHint {
			t.Errorf("%s is offered by a default server and is not read-only", tool.Name)
		}
	}
}
