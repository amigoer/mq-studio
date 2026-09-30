package mcpserver

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/amigoer/mq-studio/internal/agent/catalog"
	"github.com/amigoer/mq-studio/internal/app"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/storage/layout"
)

// serverAndWindow is two assemblies over one directory: the one this server
// runs on, and one standing in for the window, which is the only writer.
func serverAndWindow(t *testing.T) (*app.Services, *app.Services, layout.Layout) {
	t.Helper()
	directory := t.TempDir()
	server, err := app.NewReadOnlyIn(directory)
	if err != nil {
		t.Fatalf("assemble the server: %v", err)
	}
	t.Cleanup(server.Close)
	window, err := app.NewReadOnlyIn(directory)
	if err != nil {
		t.Fatalf("assemble the window: %v", err)
	}
	t.Cleanup(window.Close)
	return server, window, layout.In(directory)
}

func listConnections(t *testing.T, clientSession *mcp.ClientSession) (*mcp.CallToolResult, connectionsOutput) {
	t.Helper()
	result, err := clientSession.CallTool(context.Background(), &mcp.CallToolParams{
		Name:      "connections_list",
		Arguments: json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatalf("call connections_list: %v", err)
	}
	var output connectionsOutput
	if !result.IsError {
		encoded, err := json.Marshal(result.StructuredContent)
		if err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(encoded, &output); err != nil {
			t.Fatalf("connections_list returned something that does not decode: %v", err)
		}
	}
	return result, output
}

// The advice to an agent that needs a connection is to have the user save one
// in the window. That only works if the server, already running, sees it.
func TestAConnectionSavedInTheWindowIsListedByTheNextCall(t *testing.T) {
	server, window, _ := serverAndWindow(t)
	clientSession := session(t, server, catalog.BlastRead)

	if _, before := listConnections(t, clientSession); len(before.Connections) != 0 {
		t.Fatalf("an empty store listed %v", before.Connections)
	}

	profile := model.ConnectionProfile{
		Name: "saved later", Kind: model.KindRabbitMQ,
		Endpoints: "http://127.0.0.1:15672", TimeoutSec: 5,
		Auth: model.AuthConfig{Mechanism: model.AuthPlain},
	}
	profile.SetSecret("username", "guest")
	profile.SetSecret("password", "guest")
	if _, err := window.Connections.AddConnection(profile); err != nil {
		t.Fatalf("save in the window: %v", err)
	}

	_, after := listConnections(t, clientSession)
	if len(after.Connections) != 1 || after.Connections[0].Name != "saved later" {
		t.Fatalf("after the window saved one, the server listed %v", after.Connections)
	}
}

// An answer from the copy read at startup could name a connection the user
// has since deleted, and nothing in it would say so.
func TestAStoreThatCannotBeReadFailsTheCall(t *testing.T) {
	server, _, paths := serverAndWindow(t)
	clientSession := session(t, server, catalog.BlastRead)

	if err := os.WriteFile(paths.ConnectionsFile, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	result, _ := listConnections(t, clientSession)
	if !result.IsError {
		t.Fatal("an unreadable store answered as though nothing were wrong")
	}
	text := ""
	for _, content := range result.Content {
		if part, ok := content.(*mcp.TextContent); ok {
			text += part.Text
		}
	}
	if !strings.Contains(text, "not called") {
		t.Errorf("the refusal does not say the call was not made: %q", text)
	}
}
