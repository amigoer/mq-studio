package redisstream

import (
	"context"
	"encoding/json"
	"strconv"
	"testing"

	"github.com/redis/go-redis/v9"

	"github.com/amigoer/mq-studio/internal/model"
)

func TestMessageOf(t *testing.T) {
	got := messageOf("orders:events", redis.XMessage{
		ID: "1756454646018-3",
		Values: map[string]any{
			"order": "A-1001",
			"total": "42.50",
		},
	})

	if got.Topic != "orders:events" || got.MessageID != "1756454646018-3" {
		t.Errorf("topic/id = %q/%q", got.Topic, got.MessageID)
	}
	// The timestamp is not derived: Redis generates the id from the clock, so
	// the id is when the entry was added.
	if got.StoreTimestamp != 1756454646018 {
		t.Errorf("store timestamp = %d, want the id's milliseconds", got.StoreTimestamp)
	}
	if got.StoreTime == "" {
		t.Error("no formatted store time")
	}
	// A stream is one log. A queue id or an offset here would be a partition
	// this family does not have; the position is the id.
	if got.QueueID != 0 || got.QueueOffset != 0 {
		t.Errorf("queue = %d/%d, want zero: a stream has no partitions", got.QueueID, got.QueueOffset)
	}
	if got.Properties["order"] != "A-1001" || got.Properties["total"] != "42.50" {
		t.Errorf("properties = %v", got.Properties)
	}
}

/*
 * The body is a rendering of the whole entry, not one of its fields.
 *
 * Picking a field and calling it the payload would be guessing at a convention
 * Redis does not have - there is no "data" field, only whatever the producer
 * chose. Leaving it empty would give the copy control and every generic viewer
 * nothing at all.
 */
func TestMessageBodyCarriesTheWholeEntry(t *testing.T) {
	got := messageOf("orders:events", redis.XMessage{
		ID:     "1-0",
		Values: map[string]any{"b": "second", "a": "first"},
	})

	var decoded map[string]string
	if err := json.Unmarshal([]byte(got.Body), &decoded); err != nil {
		t.Fatalf("body is not json: %q (%v)", got.Body, err)
	}
	if decoded["a"] != "first" || decoded["b"] != "second" {
		t.Errorf("body = %q", got.Body)
	}
	// Sorted, because go-redis hands the fields back as a map and the order
	// they were written in is already gone. Stable beats arbitrary.
	if got.Body != `{"a":"first","b":"second"}` {
		t.Errorf("body = %q, want the fields in name order", got.Body)
	}
}

func TestMessageOfAnEntryWithNoFields(t *testing.T) {
	got := messageOf("orders:events", redis.XMessage{ID: "1-0"})
	if got.Body != "{}" {
		t.Errorf("body = %q, want an empty object", got.Body)
	}
	if len(got.Properties) != 0 {
		t.Errorf("properties = %v", got.Properties)
	}
}

// A malformed id must not take the read down: what came back is still an entry
// with contents worth showing, it simply has no readable timestamp.
func TestMessageOfAnUnparseableID(t *testing.T) {
	got := messageOf("orders:events", redis.XMessage{ID: "not-an-id"})
	if got.MessageID != "not-an-id" {
		t.Errorf("id = %q, want it passed through", got.MessageID)
	}
	if got.StoreTimestamp != 0 {
		t.Errorf("store timestamp = %d, want 0", got.StoreTimestamp)
	}
}

/*
 * The range is where the canonical shape fits Redis exactly, and the sequence
 * bounds are the part that is easy to get wrong.
 *
 * A window ending at <ms>-0 would drop every entry after the first in that
 * millisecond, which on a busy stream is most of them - and the loss would be
 * invisible, because the page would simply show fewer rows.
 */
func TestRangeOf(t *testing.T) {
	cases := []struct {
		name               string
		params             model.MessageQueryParams
		wantStart, wantEnd string
	}{
		{
			name:      "no window is redis's own open range",
			params:    model.MessageQueryParams{},
			wantStart: "-",
			wantEnd:   "+",
		},
		{
			name:      "a start includes everything stamped with that millisecond",
			params:    model.MessageQueryParams{StartTime: 1756454646018},
			wantStart: "1756454646018-0",
			wantEnd:   "+",
		},
		{
			name:      "an end includes them too, not just the first",
			params:    model.MessageQueryParams{EndTime: 1756454646018},
			wantStart: "-",
			wantEnd:   "1756454646018-18446744073709551615",
		},
		{
			name:      "a zero is an unfilled form, not the epoch",
			params:    model.MessageQueryParams{StartTime: 0, EndTime: 0},
			wantStart: "-",
			wantEnd:   "+",
		},
	}
	for _, tc := range cases {
		start, end := rangeOf(tc.params)
		if start != tc.wantStart || end != tc.wantEnd {
			t.Errorf("%s: range = %s..%s, want %s..%s", tc.name, start, end, tc.wantStart, tc.wantEnd)
		}
	}
}

func TestMatches(t *testing.T) {
	entry := redis.XMessage{
		ID:     "1-0",
		Values: map[string]any{"order": "A-1001", "region": "eu-west"},
	}
	cases := []struct {
		name            string
		field, contains string
		want            bool
	}{
		{name: "no filter matches everything", want: true},
		{name: "a field that is present", field: "order", want: true},
		{name: "a field that is not", field: "customer", want: false},
		{name: "a value substring", contains: "1001", want: true},
		{name: "case insensitively", contains: "EU-WEST", want: true},
		{name: "a field name counts too", contains: "region", want: true},
		{name: "a substring of neither", contains: "nothing", want: false},
		{name: "both filters, both matching", field: "order", contains: "A-10", want: true},
		{name: "both filters, one failing", field: "customer", contains: "A-10", want: false},
	}
	for _, tc := range cases {
		if got := matches(entry, tc.field, tc.contains); got != tc.want {
			t.Errorf("%s: matches = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestQueryMessagesNewestFirst(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()
	seedStream(t, conn, "orders:events", 12)
	ids := entryIDs(t, conn, "orders:events")

	items, err := conn.QueryMessages(ctx, model.MessageQueryParams{
		Topic:      "orders:events",
		MaxResults: 5,
	})
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if len(items) != 5 {
		t.Fatalf("returned %d entries, want 5", len(items))
	}
	// A console is opened to see what just happened far more often than what
	// happened first.
	if items[0].MessageID != ids[11] {
		t.Errorf("first row = %s, want the newest entry %s", items[0].MessageID, ids[11])
	}
	if items[4].MessageID != ids[7] {
		t.Errorf("last row = %s, want %s", items[4].MessageID, ids[7])
	}
}

func TestQueryMessagesFilters(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()
	for i := range 6 {
		values := map[string]any{"seq": strconv.Itoa(i)}
		if i%2 == 0 {
			values["region"] = "eu-west"
		}
		if err := conn.client.XAdd(ctx, &redis.XAddArgs{
			Stream: "orders:events",
			Values: values,
		}).Err(); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	byField, err := conn.QueryMessages(ctx, model.MessageQueryParams{
		Topic:   "orders:events",
		Filters: map[string]string{FilterField: "region"},
	})
	if err != nil {
		t.Fatalf("query by field: %v", err)
	}
	if len(byField) != 3 {
		t.Errorf("field filter returned %d entries, want the 3 carrying it", len(byField))
	}

	byValue, err := conn.QueryMessages(ctx, model.MessageQueryParams{
		Topic:   "orders:events",
		Filters: map[string]string{FilterContains: "eu-west"},
	})
	if err != nil {
		t.Fatalf("query by value: %v", err)
	}
	if len(byValue) != 3 {
		t.Errorf("value filter returned %d entries, want 3", len(byValue))
	}
}

func TestQueryMessagesByID(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()
	seedStream(t, conn, "orders:events", 4)
	ids := entryIDs(t, conn, "orders:events")

	// An id given to the query is a lookup rather than a range: answering it
	// by scanning would look for something already addressable.
	items, err := conn.QueryMessages(ctx, model.MessageQueryParams{
		Topic:     "orders:events",
		MessageID: ids[2],
	})
	if err != nil {
		t.Fatalf("query by id: %v", err)
	}
	if len(items) != 1 || items[0].MessageID != ids[2] {
		t.Errorf("query by id returned %+v", items)
	}
}

func TestMessageByID(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()
	seedStream(t, conn, "orders:events", 3)
	ids := entryIDs(t, conn, "orders:events")

	item, err := conn.MessageByID(ctx, "orders:events", ids[1])
	if err != nil {
		t.Fatalf("by id: %v", err)
	}
	if item.MessageID != ids[1] {
		t.Errorf("id = %q, want %q", item.MessageID, ids[1])
	}

	if _, err := conn.MessageByID(ctx, "orders:events", "1-0"); err == nil {
		t.Error("looking up an entry that does not exist succeeded")
	}
	if _, err := conn.MessageByID(ctx, "orders:events", "yesterday"); err == nil {
		t.Error("looking up something that is not an entry id succeeded")
	}
	if _, err := conn.MessageByID(ctx, "", ids[0]); err == nil {
		t.Error("looking up an entry with no stream succeeded")
	}
}

func TestQueryMessagesNeedsAStream(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	if _, err := conn.QueryMessages(context.Background(), model.MessageQueryParams{}); err == nil {
		t.Fatal("a query with no stream succeeded")
	}
}
