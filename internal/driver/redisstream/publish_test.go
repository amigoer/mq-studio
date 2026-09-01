package redisstream

import (
	"context"
	"testing"

	"github.com/amigoer/mq-studio/internal/model"
)

func addRequest(stream string, fields ...model.StreamField) model.StreamAddRequest {
	return model.StreamAddRequest{
		Ref:    model.DestinationRef{Name: stream},
		Fields: fields,
	}
}

func TestAddEntry(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()
	seedStream(t, conn, "orders:events", 1)

	result, err := conn.AddEntry(ctx, addRequest("orders:events",
		model.StreamField{Name: "order", Value: "A-1001"},
		model.StreamField{Name: "total", Value: "42.50"},
	))
	if err != nil {
		t.Fatalf("add: %v", err)
	}
	if len(result.IDs) != 1 {
		t.Fatalf("assigned %d ids, want 1", len(result.IDs))
	}

	// The id is the only handle on an entry, so it has to come back usable.
	item, err := conn.MessageByID(ctx, "orders:events", result.IDs[0])
	if err != nil {
		t.Fatalf("read back the entry that was just written: %v", err)
	}
	if item.Properties["order"] != "A-1001" || item.Properties["total"] != "42.50" {
		t.Errorf("fields = %v", item.Properties)
	}
}

/*
 * NOMKSTREAM. A mistyped key must not quietly become a new stream holding one
 * test message: the operator would go back to a list wondering where their
 * entry went, and there would be a stream nobody meant to make.
 */
func TestAddEntryDoesNotCreateTheStream(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()

	_, err := conn.AddEntry(ctx, addRequest("orders:typo",
		model.StreamField{Name: "order", Value: "A-1001"},
	))
	if err == nil {
		t.Fatal("writing to a stream that does not exist succeeded")
	}
	listed, err := conn.ListDestinations(ctx, model.DestinationFilter{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 0 {
		t.Errorf("a stream was created as a side effect: %+v", listed)
	}
}

func TestAddEntryCount(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()
	seedStream(t, conn, "orders:events", 1)

	request := addRequest("orders:events", model.StreamField{Name: "order", Value: "A-1001"})
	request.Count = 5
	result, err := conn.AddEntry(ctx, request)
	if err != nil {
		t.Fatalf("add: %v", err)
	}
	if len(result.IDs) != 5 {
		t.Fatalf("assigned %d ids, want 5", len(result.IDs))
	}
	// Each copy is its own entry with its own id.
	seen := map[string]bool{}
	for _, id := range result.IDs {
		if seen[id] {
			t.Errorf("id %s was assigned twice", id)
		}
		seen[id] = true
	}
	length, err := conn.client.XLen(ctx, "orders:events").Result()
	if err != nil {
		t.Fatalf("xlen: %v", err)
	}
	if length != 6 {
		t.Errorf("the stream holds %d entries, want the seeded one plus five", length)
	}
}

func TestAddEntryWithAnExplicitID(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()
	seedStream(t, conn, "orders:events", 1)

	request := addRequest("orders:events", model.StreamField{Name: "order", Value: "A-1001"})
	request.ID = "9999999999999-0"
	result, err := conn.AddEntry(ctx, request)
	if err != nil {
		t.Fatalf("add with an id: %v", err)
	}
	if result.IDs[0] != "9999999999999-0" {
		t.Errorf("id = %q, want the one asked for", result.IDs[0])
	}
}

/*
 * An explicit id can only be used once, so a count above one would fail on the
 * second copy having already written the first. Refusing up front leaves the
 * stream exactly as it was, which a half-done send does not.
 */
func TestAddEntryRefusesAnExplicitIDWithACount(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()
	seedStream(t, conn, "orders:events", 1)

	request := addRequest("orders:events", model.StreamField{Name: "order", Value: "A-1001"})
	request.ID = "9999999999999-0"
	request.Count = 3
	if _, err := conn.AddEntry(ctx, request); err == nil {
		t.Fatal("an explicit id with a count succeeded")
	}
	length, err := conn.client.XLen(ctx, "orders:events").Result()
	if err != nil {
		t.Fatalf("xlen: %v", err)
	}
	if length != 1 {
		t.Errorf("the stream holds %d entries; the refused send wrote some anyway", length)
	}
}

func TestAddEntryValidation(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()
	seedStream(t, conn, "orders:events", 1)

	field := model.StreamField{Name: "order", Value: "A-1001"}
	cases := map[string]model.StreamAddRequest{
		"no stream key": {Fields: []model.StreamField{field}},
		"no fields":     addRequest("orders:events"),
		"only blank field names": addRequest("orders:events",
			model.StreamField{Name: "  ", Value: "x"}),
	}
	for name, request := range cases {
		if _, err := conn.AddEntry(ctx, request); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}

	overCount := addRequest("orders:events", field)
	overCount.Count = maxAddCount + 1
	if _, err := conn.AddEntry(ctx, overCount); err == nil {
		t.Error("a count over the cap was accepted")
	}

	badID := addRequest("orders:events", field)
	badID.ID = "yesterday"
	if _, err := conn.AddEntry(ctx, badID); err == nil {
		t.Error("an id that is not an entry id was accepted")
	}
}

// A field with a blank name is dropped rather than refused, so a form row
// someone started and abandoned does not block the send. What is refused is an
// entry left with nothing at all.
func TestAddEntrySkipsBlankFieldNames(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()
	seedStream(t, conn, "orders:events", 1)

	result, err := conn.AddEntry(ctx, addRequest("orders:events",
		model.StreamField{Name: "order", Value: "A-1001"},
		model.StreamField{Name: "   ", Value: "abandoned"},
	))
	if err != nil {
		t.Fatalf("add: %v", err)
	}
	item, err := conn.MessageByID(ctx, "orders:events", result.IDs[0])
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if len(item.Properties) != 1 {
		t.Errorf("the entry carries %d fields, want only the named one: %v", len(item.Properties), item.Properties)
	}
}
