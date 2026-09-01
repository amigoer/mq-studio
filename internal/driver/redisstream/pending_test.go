package redisstream

import (
	"context"
	"testing"

	"github.com/redis/go-redis/v9"

	"github.com/amigoer/mq-studio/internal/model"
)

// handOut reads entries into a named consumer without acknowledging them,
// which is what leaves a pending list behind.
func handOut(t *testing.T, conn *Conn, stream, group, consumer string, count int) {
	t.Helper()
	err := conn.client.XReadGroup(context.Background(), &redis.XReadGroupArgs{
		Group:    group,
		Consumer: consumer,
		Streams:  []string{stream, ">"},
		Count:    int64(count),
	}).Err()
	if err != nil {
		t.Fatalf("hand out to %s: %v", consumer, err)
	}
}

func pendingFixture(t *testing.T) (*Conn, model.SubscriptionRef) {
	t.Helper()
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()
	seedStream(t, conn, "orders:events", 20)
	if err := conn.client.XGroupCreate(ctx, "orders:events", "settle-group", "0").Err(); err != nil {
		t.Fatalf("create group: %v", err)
	}
	handOut(t, conn, "orders:events", "settle-group", "worker-1", 6)
	handOut(t, conn, "orders:events", "settle-group", "worker-2", 3)
	return conn, model.SubscriptionRef{Namespace: "orders:events", Name: "settle-group"}
}

/*
 * The per-consumer breakdown is what makes the page worth opening: one dead
 * consumer holding everything and a group that is generally behind need
 * completely different things done about them, and the total alone cannot tell
 * them apart.
 */
func TestPendingSummary(t *testing.T) {
	conn, ref := pendingFixture(t)

	summary, err := conn.PendingSummary(context.Background(), ref)
	if err != nil {
		t.Fatalf("summary: %v", err)
	}
	if summary.Count != 9 {
		t.Errorf("count = %d, want 9", summary.Count)
	}
	if summary.MinID == "" || summary.MaxID == "" {
		t.Errorf("a non-empty pending list came back with no bounds: %+v", summary)
	}
	if len(summary.PerConsumer) != 2 {
		t.Fatalf("per-consumer = %+v, want two", summary.PerConsumer)
	}
	// Largest share first: the consumer holding the most is the one to look at.
	if summary.PerConsumer[0].Consumer != "worker-1" || summary.PerConsumer[0].Count != 6 {
		t.Errorf("first row = %+v, want worker-1 with 6", summary.PerConsumer[0])
	}
	if summary.PerConsumer[1].Count != 3 {
		t.Errorf("second row = %+v", summary.PerConsumer[1])
	}
}

// An empty pending list answers with 0-0 at both ends rather than omitting
// them. Passing that through would put an entry id on a page for a list that
// has none.
func TestPendingSummaryOfAnEmptyList(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()
	seedStream(t, conn, "orders:events", 5)
	if err := conn.client.XGroupCreate(ctx, "orders:events", "settle-group", "0").Err(); err != nil {
		t.Fatalf("create group: %v", err)
	}

	summary, err := conn.PendingSummary(ctx, model.SubscriptionRef{
		Namespace: "orders:events",
		Name:      "settle-group",
	})
	if err != nil {
		t.Fatalf("summary: %v", err)
	}
	if summary.Count != 0 {
		t.Errorf("count = %d, want 0", summary.Count)
	}
	if summary.MinID != "" || summary.MaxID != "" {
		t.Errorf("bounds = %q..%q, want neither on an empty list", summary.MinID, summary.MaxID)
	}
	if len(summary.PerConsumer) != 0 {
		t.Errorf("per-consumer = %+v, want none", summary.PerConsumer)
	}
}

func TestPendingEntries(t *testing.T) {
	conn, ref := pendingFixture(t)
	ctx := context.Background()

	entries, err := conn.PendingEntries(ctx, model.PendingQuery{Ref: ref})
	if err != nil {
		t.Fatalf("entries: %v", err)
	}
	if len(entries) != 9 {
		t.Fatalf("listed %d entries, want 9", len(entries))
	}
	for _, entry := range entries {
		if entry.Consumer == "" {
			t.Errorf("entry %s has no owner", entry.ID)
		}
		// Every delivery has been made once. Above one means something claimed
		// it or a consumer restarted, which is the column that matters.
		if entry.Deliveries != 1 {
			t.Errorf("entry %s reports %d deliveries, want 1", entry.ID, entry.Deliveries)
		}
		if entry.Ref != ref {
			t.Errorf("entry %s carries ref %+v", entry.ID, entry.Ref)
		}
	}
}

func TestPendingEntriesNarrowedToOneConsumer(t *testing.T) {
	conn, ref := pendingFixture(t)

	entries, err := conn.PendingEntries(context.Background(), model.PendingQuery{
		Ref:      ref,
		Consumer: "worker-2",
	})
	if err != nil {
		t.Fatalf("entries: %v", err)
	}
	if len(entries) != 3 {
		t.Fatalf("listed %d entries for worker-2, want 3", len(entries))
	}
	for _, entry := range entries {
		if entry.Consumer != "worker-2" {
			t.Errorf("entry %s belongs to %s", entry.ID, entry.Consumer)
		}
	}
}

func TestPendingEntriesRespectsTheCount(t *testing.T) {
	conn, ref := pendingFixture(t)

	entries, err := conn.PendingEntries(context.Background(), model.PendingQuery{Ref: ref, Count: 4})
	if err != nil {
		t.Fatalf("entries: %v", err)
	}
	if len(entries) != 4 {
		t.Errorf("listed %d entries, want the 4 asked for", len(entries))
	}
}

func TestGroupConsumers(t *testing.T) {
	conn, ref := pendingFixture(t)

	consumers, err := conn.GroupConsumers(context.Background(), ref)
	if err != nil {
		t.Fatalf("consumers: %v", err)
	}
	if len(consumers) != 2 {
		t.Fatalf("listed %d consumers, want 2", len(consumers))
	}
	if consumers[0].Name != "worker-1" || consumers[1].Name != "worker-2" {
		t.Errorf("consumers = %+v, want them in name order", consumers)
	}
	if consumers[0].Pending != 6 {
		t.Errorf("worker-1 holds %d, want 6", consumers[0].Pending)
	}
}

/*
 * Acknowledging is the quietly destructive one: it removes the entry from the
 * pending list and leaves it in the stream, unread by that group forever.
 * Nothing about the outcome distinguishes that from a job well done, so the
 * count is what the caller gets - how many were actually owed, not how many
 * were named.
 */
func TestAckEntries(t *testing.T) {
	conn, ref := pendingFixture(t)
	ctx := context.Background()

	entries, err := conn.PendingEntries(ctx, model.PendingQuery{Ref: ref})
	if err != nil {
		t.Fatalf("entries: %v", err)
	}
	ids := []string{entries[0].ID, entries[1].ID}

	result, err := conn.AckEntries(ctx, ref, ids)
	if err != nil {
		t.Fatalf("ack: %v", err)
	}
	if result.Acknowledged != 2 {
		t.Errorf("acknowledged = %d, want 2", result.Acknowledged)
	}

	summary, err := conn.PendingSummary(ctx, ref)
	if err != nil {
		t.Fatalf("summary: %v", err)
	}
	if summary.Count != 7 {
		t.Errorf("pending = %d after acknowledging two, want 7", summary.Count)
	}

	// Acknowledging the same ids again settles nothing. Reporting the request
	// count would call that a second success.
	repeat, err := conn.AckEntries(ctx, ref, ids)
	if err != nil {
		t.Fatalf("repeat ack: %v", err)
	}
	if repeat.Acknowledged != 0 {
		t.Errorf("a repeat acknowledgement settled %d entries, want 0", repeat.Acknowledged)
	}

	// And the entries are still in the stream: acknowledging does not delete.
	length, err := conn.client.XLen(ctx, "orders:events").Result()
	if err != nil {
		t.Fatalf("xlen: %v", err)
	}
	if length != 20 {
		t.Errorf("the stream holds %d entries after an acknowledgement, want 20", length)
	}
}

func TestClaimEntries(t *testing.T) {
	conn, ref := pendingFixture(t)
	ctx := context.Background()

	entries, err := conn.PendingEntries(ctx, model.PendingQuery{Ref: ref, Consumer: "worker-1"})
	if err != nil {
		t.Fatalf("entries: %v", err)
	}
	ids := []string{entries[0].ID, entries[1].ID}

	// The new consumer does not exist yet. Claiming creates it, which is how a
	// replacement takes over from a dead worker without being started first.
	result, err := conn.ClaimEntries(ctx, model.ClaimRequest{
		Ref:      ref,
		Consumer: "worker-3",
		IDs:      ids,
	})
	if err != nil {
		t.Fatalf("claim: %v", err)
	}
	if len(result.Claimed) != 2 {
		t.Fatalf("claimed %v, want two entries", result.Claimed)
	}

	moved, err := conn.PendingEntries(ctx, model.PendingQuery{Ref: ref, Consumer: "worker-3"})
	if err != nil {
		t.Fatalf("entries after the claim: %v", err)
	}
	if len(moved) != 2 {
		t.Errorf("worker-3 holds %d entries, want 2", len(moved))
	}
	// A claim is a redelivery, so the count goes up. It is what tells an
	// operator an entry has been round more than once.
	for _, entry := range moved {
		if entry.Deliveries < 2 {
			t.Errorf("entry %s reports %d deliveries after a claim", entry.ID, entry.Deliveries)
		}
	}
}

func TestPendingOperationsValidateTheirInput(t *testing.T) {
	conn, ref := pendingFixture(t)
	ctx := context.Background()
	empty := model.SubscriptionRef{}

	if _, err := conn.PendingSummary(ctx, empty); err == nil {
		t.Error("a summary with no reference succeeded")
	}
	if _, err := conn.PendingEntries(ctx, model.PendingQuery{Ref: empty}); err == nil {
		t.Error("a listing with no reference succeeded")
	}
	if _, err := conn.GroupConsumers(ctx, empty); err == nil {
		t.Error("a consumer listing with no reference succeeded")
	}
	if _, err := conn.AckEntries(ctx, ref, nil); err == nil {
		t.Error("acknowledging nothing succeeded")
	}
	if _, err := conn.AckEntries(ctx, ref, []string{"  ", ""}); err == nil {
		t.Error("acknowledging blank ids succeeded")
	}
	if _, err := conn.ClaimEntries(ctx, model.ClaimRequest{Ref: ref, IDs: []string{"1-0"}}); err == nil {
		t.Error("claiming with no consumer succeeded")
	}
	if _, err := conn.ClaimEntries(ctx, model.ClaimRequest{Ref: ref, Consumer: "worker-3"}); err == nil {
		t.Error("claiming no ids succeeded")
	}
	if _, err := conn.AutoClaim(ctx, model.AutoClaimRequest{Ref: ref}); err == nil {
		t.Error("auto-claiming with no consumer succeeded")
	}
}

/*
 * The XAUTOCLAIM reply, parsed by hand because go-redis's typed helper drops
 * the third element - the ids that were in the pending list and are no longer
 * in the stream. Those are work that was lost rather than moved, and this is
 * the only moment anything says so.
 */
func TestParseAutoClaim(t *testing.T) {
	full := []any{
		"1756454646018-0",
		[]any{"1756454640000-0", "1756454641000-0"},
		[]any{"1756454630000-0"},
	}
	result, err := parseAutoClaim(full)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if result.NextStart != "1756454646018-0" {
		t.Errorf("next start = %q", result.NextStart)
	}
	if len(result.Claimed) != 2 || len(result.Deleted) != 1 {
		t.Errorf("claimed %v, deleted %v", result.Claimed, result.Deleted)
	}

	// Redis before 7.0 answers with two elements. The absent third is "not
	// reported" rather than "none deleted", and an empty list is the closest
	// this shape gets to saying so - what must not happen is a parse failure
	// that takes the whole claim down.
	older, err := parseAutoClaim([]any{"0-0", []any{"1-0"}})
	if err != nil {
		t.Fatalf("parse an older reply: %v", err)
	}
	if len(older.Claimed) != 1 || len(older.Deleted) != 0 {
		t.Errorf("older reply: claimed %v, deleted %v", older.Claimed, older.Deleted)
	}

	for _, bad := range []any{nil, "not a list", []any{}, []any{42, []any{}}} {
		if _, err := parseAutoClaim(bad); err == nil {
			t.Errorf("parsing %v succeeded", bad)
		}
	}
}
