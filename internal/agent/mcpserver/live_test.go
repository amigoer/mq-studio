package mcpserver_test

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

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
func mcpSession(t *testing.T, services *app.Services) *mcp.ClientSession {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	t.Cleanup(cancel)

	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	go func() {
		if err := mcpserver.New(services, "test").Run(ctx, serverTransport); err != nil && ctx.Err() == nil {
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
	session := mcpSession(t, services)

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
	session := mcpSession(t, services)

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

	session := mcpSession(t, services)
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
