package redisstream

import (
	"context"
	"testing"

	"github.com/amigoer/mq-studio/internal/model"
)

func entryIDs(t *testing.T, conn *Conn, key string) []string {
	t.Helper()
	entries, err := conn.client.XRange(context.Background(), key, "-", "+").Result()
	if err != nil {
		t.Fatalf("xrange %s: %v", key, err)
	}
	ids := make([]string, 0, len(entries))
	for _, entry := range entries {
		ids = append(ids, entry.ID)
	}
	return ids
}

func TestTrimByLengthKeepsTheNewest(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	seedStream(t, conn, "orders:events", 10)
	before := entryIDs(t, conn, "orders:events")

	result, err := conn.Trim(context.Background(), model.TrimRequest{
		Ref:      model.DestinationRef{Name: "orders:events"},
		Strategy: model.TrimMaxLen,
		MaxLen:   4,
	})
	if err != nil {
		t.Fatalf("trim: %v", err)
	}
	if result.Removed != 6 {
		t.Errorf("removed = %d, want 6", result.Removed)
	}

	after := entryIDs(t, conn, "orders:events")
	if len(after) != 4 {
		t.Fatalf("kept %d entries, want 4", len(after))
	}
	// The newest, not the oldest. A trim that kept the head would silently
	// throw away everything anyone was about to read.
	if after[0] != before[6] {
		t.Errorf("kept from %s, want from %s", after[0], before[6])
	}
}

/*
 * A length of zero empties the stream and leaves the key.
 *
 * This is the whole reason the driver declares no separate purge: it is one
 * command with a setting, and a second control named "purge" would be a second
 * name for this call.
 */
func TestTrimToZeroEmptiesTheStreamAndKeepsItsGroups(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()
	seedStream(t, conn, "orders:events", 5)
	if err := conn.client.XGroupCreate(ctx, "orders:events", "settle-group", "0").Err(); err != nil {
		t.Fatalf("create group: %v", err)
	}

	result, err := conn.Trim(ctx, model.TrimRequest{
		Ref:      model.DestinationRef{Name: "orders:events"},
		Strategy: model.TrimMaxLen,
		MaxLen:   0,
	})
	if err != nil {
		t.Fatalf("trim: %v", err)
	}
	if result.Removed != 5 {
		t.Errorf("removed = %d, want 5", result.Removed)
	}

	// The key survives, which is what makes this a purge rather than a delete.
	listed, err := conn.ListDestinations(ctx, model.DestinationFilter{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 1 || listed[0].Depth != 0 {
		t.Fatalf("after emptying: %+v", listed)
	}
	// And so do the groups, with their positions. A trim is not a reset.
	groups, err := conn.client.XInfoGroups(ctx, "orders:events").Result()
	if err != nil {
		t.Fatalf("xinfo groups: %v", err)
	}
	if len(groups) != 1 || groups[0].Name != "settle-group" {
		t.Errorf("groups after emptying: %+v", groups)
	}
}

func TestTrimByPositionDropsEverythingBefore(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	seedStream(t, conn, "orders:events", 8)
	ids := entryIDs(t, conn, "orders:events")

	result, err := conn.Trim(context.Background(), model.TrimRequest{
		Ref:      model.DestinationRef{Name: "orders:events"},
		Strategy: model.TrimMinID,
		MinID:    ids[5],
	})
	if err != nil {
		t.Fatalf("trim: %v", err)
	}
	if result.Removed != 5 {
		t.Errorf("removed = %d, want the five before the cut", result.Removed)
	}
	after := entryIDs(t, conn, "orders:events")
	if len(after) != 3 || after[0] != ids[5] {
		t.Errorf("kept %v, want from %s onwards", after, ids[5])
	}
}

func TestTrimRefusesAnIncompleteRequest(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()
	cases := map[string]model.TrimRequest{
		"no stream key": {Strategy: model.TrimMaxLen, MaxLen: 1},
		"no strategy":   {Ref: model.DestinationRef{Name: "orders:events"}},
		"unknown strategy": {
			Ref:      model.DestinationRef{Name: "orders:events"},
			Strategy: model.TrimStrategy("oldest"),
		},
		"a negative length": {
			Ref:      model.DestinationRef{Name: "orders:events"},
			Strategy: model.TrimMaxLen,
			MaxLen:   -1,
		},
		"a position with no id": {
			Ref:      model.DestinationRef{Name: "orders:events"},
			Strategy: model.TrimMinID,
		},
	}
	for name, request := range cases {
		if _, err := conn.Trim(ctx, request); err == nil {
			t.Errorf("%s was accepted", name)
		}
	}
}

func TestDeleteEntries(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()
	seedStream(t, conn, "orders:events", 5)
	ids := entryIDs(t, conn, "orders:events")

	result, err := conn.DeleteEntries(ctx, model.DestinationRef{Name: "orders:events"}, []string{ids[1], ids[3]})
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	if result.Removed != 2 {
		t.Errorf("removed = %d, want 2", result.Removed)
	}

	after := entryIDs(t, conn, "orders:events")
	if len(after) != 3 {
		t.Fatalf("kept %d entries, want 3", len(after))
	}
	// XDEL leaves the gap rather than renumbering. An id that is gone must not
	// come back attached to a different entry.
	for _, id := range after {
		if id == ids[1] || id == ids[3] {
			t.Errorf("%s is still present after being deleted", id)
		}
	}
}

// Deleting an id twice succeeds and removes nothing. Reporting the count asked
// for rather than the count found would call that a deletion.
func TestDeleteEntriesReportsWhatWasActuallyThere(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()
	seedStream(t, conn, "orders:events", 3)
	ids := entryIDs(t, conn, "orders:events")

	if _, err := conn.DeleteEntries(ctx, model.DestinationRef{Name: "orders:events"}, ids[:1]); err != nil {
		t.Fatalf("first delete: %v", err)
	}
	result, err := conn.DeleteEntries(ctx, model.DestinationRef{Name: "orders:events"}, ids[:1])
	if err != nil {
		t.Fatalf("second delete: %v", err)
	}
	if result.Removed != 0 {
		t.Errorf("removed = %d on a repeat delete, want 0", result.Removed)
	}
}

func TestDeleteEntriesRefusesAnEmptyRequest(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()
	ref := model.DestinationRef{Name: "orders:events"}
	if _, err := conn.DeleteEntries(ctx, ref, nil); err == nil {
		t.Error("deleting no entries succeeded")
	}
	if _, err := conn.DeleteEntries(ctx, ref, []string{"  ", ""}); err == nil {
		t.Error("deleting blank ids succeeded")
	}
	if _, err := conn.DeleteEntries(ctx, model.DestinationRef{}, []string{"1-0"}); err == nil {
		t.Error("deleting from no stream succeeded")
	}
}
