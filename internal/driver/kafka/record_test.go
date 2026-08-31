package kafka

import (
	"testing"
	"time"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kgo"

	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * A Kafka message id is the three coordinates that name a record, and a topic
 * may contain hyphens - so the split is from the right, not the left.
 */
func TestMessageIDRoundTrip(t *testing.T) {
	cases := []struct {
		topic     string
		partition int32
		offset    int64
	}{
		{"orders", 0, 0},
		{"orders.created", 3, 88204771},
		{"orders-created-v2", 12, 5},
	}
	for _, test := range cases {
		id := messageID(test.topic, test.partition, test.offset)
		partition, offset, err := parseMessageID(id)
		if err != nil {
			t.Fatalf("parseMessageID(%q): %v", id, err)
		}
		if partition != test.partition || offset != test.offset {
			t.Errorf("%q parsed to %d/%d, want %d/%d",
				id, partition, offset, test.partition, test.offset)
		}
	}
}

func TestParseMessageIDRefusesNonsense(t *testing.T) {
	for _, id := range []string{"", "orders", "orders-3", "orders-x-5", "orders-3-x", "-3-5"} {
		if _, _, err := parseMessageID(id); err == nil {
			t.Errorf("parseMessageID(%q) was accepted", id)
		}
	}
}

func TestMessageFromRecord(t *testing.T) {
	stamped := time.UnixMilli(1_756_000_000_000)
	item := messageFrom(&kgo.Record{
		Topic:     "orders",
		Partition: 3,
		Offset:    42,
		Key:       []byte("ORD-1"),
		Value:     []byte(`{"id":1}`),
		Timestamp: stamped,
		Headers: []kgo.RecordHeader{
			{Key: "trace-id", Value: []byte("abc")},
			{Key: "source", Value: []byte("checkout")},
		},
	})

	if item.MessageID != "orders-3-42" {
		t.Errorf("id = %q", item.MessageID)
	}
	if item.QueueID != 3 || item.QueueOffset != 42 {
		t.Errorf("coordinates = %d/%d, want 3/42", item.QueueID, item.QueueOffset)
	}
	if item.Keys != "ORD-1" {
		t.Errorf("key = %q", item.Keys)
	}
	if item.Body != `{"id":1}` {
		t.Errorf("body = %q", item.Body)
	}
	if item.StoreTimestamp != stamped.UnixMilli() {
		t.Errorf("timestamp = %d", item.StoreTimestamp)
	}
	if item.Properties["trace-id"] != "abc" || item.Properties["source"] != "checkout" {
		t.Errorf("headers = %v", item.Properties)
	}
}

/*
 * A null key is not an empty key.
 *
 * Kafka picks a partition from the key, and a record with no key at all is
 * spread across partitions while one with an empty key is pinned like any
 * other. Rendering both as "" would hide why two records that look identical
 * went to different partitions.
 */
func TestANullKeyIsNotAnEmptyKey(t *testing.T) {
	none := messageFrom(&kgo.Record{Topic: "orders", Key: nil})
	empty := messageFrom(&kgo.Record{Topic: "orders", Key: []byte("")})

	if none.Keys == empty.Keys {
		t.Error("a record with no key reads the same as one with an empty key")
	}
	if empty.Keys != "" {
		t.Errorf("an empty key = %q, want empty", empty.Keys)
	}
}

func offsetsFor(topic string, values map[int32]int64) kadm.ListedOffsets {
	return listed(topic, values)
}

/*
 * Reading back from the end spends the whole budget, and spends it where the
 * records are.
 *
 * Ninety records asked for across three partitions holding a thousand, five
 * and a hundred: the small one gives up all five and the other two split what
 * is left. An even thirty each would have wasted twenty-five of the budget on
 * a partition that does not have them.
 */
func TestLatestSpendsTheWholeBudget(t *testing.T) {
	conn := newConn(nil, nil, clientConfig{})
	starts := offsetsFor("orders", map[int32]int64{0: 0, 1: 0, 2: 900})
	ends := offsetsFor("orders", map[int32]int64{0: 1000, 1: 5, 2: 1000})

	offsets, err := conn.startOffsets(t.Context(), model.MessageQueryParams{
		Topic: "orders", MaxResults: 90,
	}, 90, starts, ends)
	if err != nil {
		t.Fatalf("startOffsets: %v", err)
	}

	if len(offsets) != 3 {
		t.Fatalf("partitions = %d, want 3", len(offsets))
	}
	// A partition with fewer records than an even share gives up all of them
	// and starts at its own start, never below it.
	if offsets[1] != 0 {
		t.Errorf("partition 1 starts at %d, want 0", offsets[1])
	}
	// The other two take what is left: 85 over two, so 43 and 42.
	read := (1000 - offsets[0]) + (5 - offsets[1]) + (1000 - offsets[2])
	if read != 90 {
		t.Errorf("the window covers %d records, want the whole budget of 90", read)
	}
	// And the one whose retention has moved still starts inside its own log.
	if offsets[2] < 900 {
		t.Errorf("partition 2 starts at %d, before its log does", offsets[2])
	}
}

// The share is rounded up, not incremented. Asking for ten records on a
// single-partition topic has to read exactly the last ten.
func TestTheLatestWindowIsExactlyWhatWasAskedFor(t *testing.T) {
	conn := newConn(nil, nil, clientConfig{})
	offsets, err := conn.startOffsets(t.Context(), model.MessageQueryParams{Topic: "orders"},
		10, offsetsFor("orders", map[int32]int64{0: 0}), offsetsFor("orders", map[int32]int64{0: 50}))
	if err != nil {
		t.Fatalf("startOffsets: %v", err)
	}
	if offsets[0] != 40 {
		t.Errorf("the last ten of fifty start at %d, want 40", offsets[0])
	}
}

// An empty partition has nothing to read, and asking for it would hang a poll
// that can never be satisfied.
func TestAnEmptyPartitionIsNotRead(t *testing.T) {
	conn := newConn(nil, nil, clientConfig{})
	offsets, err := conn.startOffsets(t.Context(), model.MessageQueryParams{Topic: "orders"},
		10, offsetsFor("orders", map[int32]int64{0: 40}), offsetsFor("orders", map[int32]int64{0: 40}))
	if err != nil {
		t.Fatalf("startOffsets: %v", err)
	}
	if len(offsets) != 0 {
		t.Errorf("an empty partition was queued for reading: %v", offsets)
	}
}

// A key search is a scan of the log, so it starts where the log does. Starting
// at the end would make a key written an hour ago invisible for no reason the
// user could see.
func TestAKeySearchScansFromTheStart(t *testing.T) {
	conn := newConn(nil, nil, clientConfig{})
	offsets, err := conn.startOffsets(t.Context(), model.MessageQueryParams{
		Topic:      "orders",
		MessageKey: "ORD-1",
		Filters:    map[string]string{FilterMode: ModeKey},
	}, 10, offsetsFor("orders", map[int32]int64{0: 100}), offsetsFor("orders", map[int32]int64{0: 900}))
	if err != nil {
		t.Fatalf("startOffsets: %v", err)
	}
	if offsets[0] != 100 {
		t.Errorf("a key scan starts at %d, want the start of the log", offsets[0])
	}
}

func TestReadModesAreValidated(t *testing.T) {
	conn := newConn(nil, nil, clientConfig{})
	starts := offsetsFor("orders", map[int32]int64{0: 0})
	ends := offsetsFor("orders", map[int32]int64{0: 100})

	cases := []struct {
		name    string
		filters map[string]string
		start   int64
	}{
		{"an unknown mode", map[string]string{FilterMode: "sideways"}, 0},
		{"an offset that is not a number", map[string]string{FilterMode: ModeOffset, FilterStartOffset: "x"}, 0},
		{"a partition that is not a number", map[string]string{FilterPartition: "x"}, 0},
		{"a partition the topic does not have", map[string]string{FilterPartition: "9"}, 0},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			_, err := conn.startOffsets(t.Context(), model.MessageQueryParams{
				Topic: "orders", Filters: test.filters, StartTime: test.start,
			}, 10, starts, ends)
			if err == nil {
				t.Error("accepted")
			}
		})
	}
}

// Reading from a moment needs a moment; without one the request would silently
// become "from the beginning of time".
func TestReadingFromAMomentNeedsOne(t *testing.T) {
	conn := newConn(nil, nil, clientConfig{})
	_, err := conn.startOffsets(t.Context(), model.MessageQueryParams{
		Topic: "orders", Filters: map[string]string{FilterMode: ModeTime},
	}, 10, offsetsFor("orders", map[int32]int64{0: 0}), offsetsFor("orders", map[int32]int64{0: 100}))
	if err == nil {
		t.Error("a time read with no time was accepted")
	}
}

/*
 * The tail cursor.
 *
 * An empty cursor opens at the end - a tail shows what arrives next, and
 * replaying what is already stored is the message query's job.
 */
func TestATailOpensAtTheEnd(t *testing.T) {
	from, dropped := tailPositions("orders", model.TailCursor{},
		offsetsFor("orders", map[int32]int64{0: 0, 1: 0}),
		offsetsFor("orders", map[int32]int64{0: 500, 1: 800}))

	if from[0] != 500 || from[1] != 800 {
		t.Errorf("a fresh tail starts at %v, want the end of each partition", from)
	}
	if dropped != 0 {
		t.Errorf("a fresh tail reported %d dropped", dropped)
	}
}

func TestATailResumesWhereItLeftOff(t *testing.T) {
	from, dropped := tailPositions("orders", model.TailCursor{Positions: []model.QueuePosition{
		{QueueID: 0, Offset: 120},
	}},
		offsetsFor("orders", map[int32]int64{0: 0, 1: 0}),
		offsetsFor("orders", map[int32]int64{0: 500, 1: 800}))

	if from[0] != 120 {
		t.Errorf("partition 0 resumed at %d, want 120", from[0])
	}
	// A partition the cursor never saw joins at the end rather than replaying
	// itself: it was not being watched a moment ago.
	if from[1] != 800 {
		t.Errorf("a partition new to the cursor started at %d, want 800", from[1])
	}
	if dropped != 0 {
		t.Errorf("dropped = %d, want 0", dropped)
	}
}

/*
 * A tail slower than the retention it watches loses records, and that has to
 * be counted rather than skipped. A tail that is silently losing looks exactly
 * like a quiet one.
 */
func TestATailReportsWhatAgedOutBeneathIt(t *testing.T) {
	from, dropped := tailPositions("orders", model.TailCursor{Positions: []model.QueuePosition{
		{QueueID: 0, Offset: 100},
	}},
		offsetsFor("orders", map[int32]int64{0: 350}),
		offsetsFor("orders", map[int32]int64{0: 500}))

	if dropped != 250 {
		t.Errorf("dropped = %d, want 250", dropped)
	}
	if from[0] != 350 {
		t.Errorf("the tail resumed at %d, want the new start of the log", from[0])
	}
}

func TestCursorFromIsSortedByPartition(t *testing.T) {
	cursor := cursorFrom(map[int32]int64{2: 20, 0: 5, 1: 9})
	if len(cursor.Positions) != 3 {
		t.Fatalf("positions = %d", len(cursor.Positions))
	}
	for index := 1; index < len(cursor.Positions); index++ {
		if cursor.Positions[index-1].QueueID > cursor.Positions[index].QueueID {
			t.Errorf("cursor is not sorted: %v", cursor.Positions)
		}
	}
}

/*
 * RocketMQ's two extra publish arguments are refused rather than ignored.
 *
 * A send console that quietly dropped a delay level would report success for a
 * record delivered immediately, which is the opposite of what was asked for.
 */
func TestTheCanonicalPublishRefusesWhatKafkaLacks(t *testing.T) {
	conn := newConn(nil, nil, clientConfig{})
	if _, err := conn.SendMessage(t.Context(), "orders", "", "k", "v", 3); err == nil {
		t.Error("a delay level was accepted")
	}
	if _, err := conn.SendMessage(t.Context(), "orders", "TagA", "k", "v", 0); err == nil {
		t.Error("a tag was accepted")
	}
}

// Idempotence requires acks=all, so it has to be off below it - forcing acks
// up would give a durability guarantee the operator did not choose.
func TestAcksBelowAllDisableIdempotence(t *testing.T) {
	for _, acks := range []Acks{AcksNone, AcksLeader} {
		if len(acksOption(acks)) != 2 {
			t.Errorf("%s did not disable idempotent writes", acks)
		}
	}
	if len(acksOption(AcksAll)) != 1 {
		t.Error("acks=all should keep idempotent writes on")
	}
}

/*
 * The budget is handed out in rounds rather than divided.
 *
 * An even split under-reads on an uneven topic: ten records over two
 * partitions holding six and four answers "the latest ten" with nine, because
 * the five-record share on the four-record partition wastes one.
 */
func TestTheLatestBudgetIsSpentWhereTheRecordsAre(t *testing.T) {
	shares := latestShares("orders", []int32{0, 1}, 10,
		offsetsFor("orders", map[int32]int64{0: 0, 1: 0}),
		offsetsFor("orders", map[int32]int64{0: 6, 1: 4}))

	if shares[0]+shares[1] != 10 {
		t.Errorf("shares = %v, want ten records in total", shares)
	}
	if shares[0] != 6 || shares[1] != 4 {
		t.Errorf("shares = %v, want everything both partitions hold", shares)
	}
}

// And it stays even when the topic can fill it: a hundred records over two
// partitions asked for ten is five each, not ten from the first.
func TestTheLatestBudgetStaysEvenWhenItCan(t *testing.T) {
	shares := latestShares("orders", []int32{0, 1}, 10,
		offsetsFor("orders", map[int32]int64{0: 0, 1: 0}),
		offsetsFor("orders", map[int32]int64{0: 100, 1: 100}))

	if shares[0] != 5 || shares[1] != 5 {
		t.Errorf("shares = %v, want five each", shares)
	}
}

// A topic with fewer records than the budget gives up all of them and no more.
func TestTheLatestBudgetCannotExceedTheTopic(t *testing.T) {
	shares := latestShares("orders", []int32{0, 1}, 100,
		offsetsFor("orders", map[int32]int64{0: 0, 1: 0}),
		offsetsFor("orders", map[int32]int64{0: 3, 1: 2}))

	if shares[0] != 3 || shares[1] != 2 {
		t.Errorf("shares = %v, want everything and nothing beyond it", shares)
	}
}
