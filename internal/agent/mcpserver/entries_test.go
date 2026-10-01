package mcpserver

import (
	"context"
	"encoding/json"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/amigoer/mq-studio/internal/agent/catalog"
	"github.com/amigoer/mq-studio/internal/app"
	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/storage/layout"
)

// streamConn writes entries by remembering them, and assigns ids the way a
// server does: one per copy, in order.
type streamConn struct {
	fakeConn
	mu      sync.Mutex
	written []model.StreamAddRequest
}

func (c *streamConn) AddEntry(_ context.Context, request model.StreamAddRequest) (*model.StreamAddResult, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.written = append(c.written, request)
	count := max(request.Count, 1)
	ids := make([]string, 0, count)
	for sequence := range count {
		ids = append(ids, "1727740800000-"+strconv.Itoa(sequence))
	}
	return &model.StreamAddResult{IDs: ids}, nil
}

func streamSession(t *testing.T, conn *streamConn) (*mcp.ClientSession, layout.Layout) {
	t.Helper()
	directory := t.TempDir()
	services, err := app.NewReadOnlyIn(directory)
	if err != nil {
		t.Fatalf("assemble: %v", err)
	}
	t.Cleanup(services.Close)
	services.Conns = func(int) (driver.Conn, error) { return conn, nil }
	return session(t, services, catalog.BlastMutate), layout.In(directory)
}

/*
 * An entry is named values, in order, and every copy gets an id of its own -
 * the only handle on it afterwards, so every one of them comes back.
 */
func TestAStreamEntryIsWrittenAsItsFieldsAndAnsweredWithItsIDs(t *testing.T) {
	conn := &streamConn{fakeConn: fakeConn{kind: model.KindRedisStream,
		capabilities: model.NewCapabilities(model.CapEntryPublish)}}
	clientSession, paths := streamSession(t, conn)

	result, err := clientSession.CallTool(t.Context(), &mcp.CallToolParams{
		Name: "message_add_entry",
		Arguments: map[string]any{"connection": 1, "destination": "orders", "count": 2, "fields": []any{
			map[string]any{"name": "order", "value": "42"}, map[string]any{"name": "total", "value": "9.90"}}},
	})
	if err != nil || result.IsError {
		t.Fatalf("append: %v %+v", err, result)
	}
	var answer addEntryOutput
	encoded, _ := json.Marshal(result.StructuredContent)
	if err := json.Unmarshal(encoded, &answer); err != nil {
		t.Fatal(err)
	}
	if len(answer.IDs) != 2 || !strings.Contains(answer.Effect.Changed, "appended 2 entries to orders") {
		t.Errorf("answered %+v", answer)
	}

	if len(conn.written) != 1 {
		t.Fatalf("wrote %d requests", len(conn.written))
	}
	request := conn.written[0]
	want := []model.StreamField{{Name: "order", Value: "42"}, {Name: "total", Value: "9.90"}}
	if request.Ref.Name != "orders" || request.Count != 2 || !slices.Equal(request.Fields, want) {
		t.Errorf("the stream was handed %+v", request)
	}

	// The values are somebody's data; the log keeps their names and a digest.
	records := audited(t, paths.AgentAuditFile)
	if len(records) != 2 || records[1].Reference != strings.Join(answer.IDs, " ") {
		t.Fatalf("recorded %+v", records)
	}
	if kept := string(records[0].Arguments); strings.Contains(kept, "9.90") ||
		!strings.Contains(kept, `"fieldNames":["order","total"]`) {
		t.Errorf("the log kept %s", kept)
	}
}

// The driver skips a field with no name, which suits a form's blank row and
// would be a value dropped in silence for a caller that meant to write it.
func TestAFieldWithNoNameIsRefusedRatherThanDropped(t *testing.T) {
	conn := &streamConn{fakeConn: fakeConn{kind: model.KindRedisStream,
		capabilities: model.NewCapabilities(model.CapEntryPublish)}}
	clientSession, _ := streamSession(t, conn)

	result, err := clientSession.CallTool(t.Context(), &mcp.CallToolParams{
		Name: "message_add_entry",
		Arguments: map[string]any{"connection": 1, "destination": "orders", "fields": []any{
			map[string]any{"name": "order", "value": "42"}, map[string]any{"name": " ", "value": "lost"}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.IsError || len(conn.written) != 0 {
		t.Fatalf("a nameless field reached the stream: %+v, wrote %v", result.Content, conn.written)
	}
}
