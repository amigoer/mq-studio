package nats

import (
	"strconv"
	"strings"
	"testing"
	"time"

	natsclient "github.com/nats-io/nats.go"

	"github.com/amigoer/mq-studio/internal/model"
)

// publishTo sends one message with a subject and optional headers.
func publishTo(t *testing.T, conn *Conn, subject, body string, headers map[string]string) uint64 {
	t.Helper()
	message := natsclient.NewMsg(subject)
	message.Data = []byte(body)
	for name, value := range headers {
		message.Header.Set(name, value)
	}
	ack, err := conn.js.PublishMsg(testContext(t), message)
	if err != nil {
		t.Fatalf("publish %s: %v", subject, err)
	}
	return ack.Sequence
}

func TestBrowsingAStreamReturnsWhatWasPublished(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	publishTo(t, conn, "orders.created", "first", nil)
	publishTo(t, conn, "orders.shipped", "second", nil)

	items, err := conn.QueryMessages(testContext(t), model.MessageQueryParams{
		Topic:      "ORDERS",
		MaxResults: 10,
	})
	if err != nil {
		t.Fatalf("QueryMessages: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("browsed %d messages, want 2", len(items))
	}
	if items[0].Body != "first" || items[1].Body != "second" {
		t.Errorf("bodies = %q, %q - want them in stream order", items[0].Body, items[1].Body)
	}
}

/*
 * The subject is the single most important thing about a NATS message, and the
 * canonical model has no field named for it. It travels in Tags, which is the
 * same idea in RocketMQ's vocabulary - the routing label inside a destination -
 * and leaving that column blank would hide it entirely.
 */
func TestTheSubjectTravelsWhereTheRoutingLabelGoes(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	publishTo(t, conn, "orders.created", "body", nil)

	items, err := conn.QueryMessages(testContext(t), model.MessageQueryParams{Topic: "ORDERS"})
	if err != nil {
		t.Fatalf("QueryMessages: %v", err)
	}
	if items[0].Tags != "orders.created" {
		t.Errorf("subject = %q, want orders.created", items[0].Tags)
	}
	// And the sequence is the address, in both the places a caller looks.
	if items[0].MessageID != "1" || items[0].QueueOffset != 1 {
		t.Errorf("address = %q/%d, want 1/1", items[0].MessageID, items[0].QueueOffset)
	}
	// A stream has no partitions, so a zero here would read as partition zero
	// of several.
	if items[0].QueueID != model.UnknownMetric {
		t.Errorf("queue id = %d, want UnknownMetric - a stream has no partitions", items[0].QueueID)
	}
}

func TestBrowsingCanBeNarrowedToASubject(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	publishTo(t, conn, "orders.created", "a", nil)
	publishTo(t, conn, "orders.shipped", "b", nil)
	publishTo(t, conn, "orders.created", "c", nil)

	items, err := conn.QueryMessages(testContext(t), model.MessageQueryParams{
		Topic:   "ORDERS",
		Filters: map[string]string{FilterSubject: "orders.created"},
	})
	if err != nil {
		t.Fatalf("QueryMessages: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("browsed %d messages, want the 2 on orders.created", len(items))
	}
	for _, item := range items {
		if item.Tags != "orders.created" {
			t.Errorf("subject = %q leaked past the filter", item.Tags)
		}
	}
}

func TestBrowsingCanStartAtASequence(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	fill(t, conn, "orders.created", 10)

	items, err := conn.QueryMessages(testContext(t), model.MessageQueryParams{
		Topic:      "ORDERS",
		Filters:    map[string]string{FilterStartSeq: "8"},
		MaxResults: 10,
	})
	if err != nil {
		t.Fatalf("QueryMessages: %v", err)
	}
	if len(items) != 3 {
		t.Fatalf("browsed %d messages from sequence 8, want 3", len(items))
	}
	if items[0].MessageID != "8" {
		t.Errorf("first message = %q, want 8", items[0].MessageID)
	}
}

/*
 * JetStream filters by subject and by nothing else, so a header filter is
 * applied after the message arrives. What it saves is the reader's attention
 * rather than the network, and the code says so - but it still has to work.
 */
func TestBrowsingCanBeNarrowedToAHeader(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	publishTo(t, conn, "orders.created", "a", map[string]string{"Region": "eu"})
	publishTo(t, conn, "orders.created", "b", map[string]string{"Region": "us"})
	publishTo(t, conn, "orders.created", "c", nil)

	items, err := conn.QueryMessages(testContext(t), model.MessageQueryParams{
		Topic:   "ORDERS",
		Filters: map[string]string{FilterHeaderName: "Region", FilterHeaderValue: "eu"},
	})
	if err != nil {
		t.Fatalf("QueryMessages: %v", err)
	}
	if len(items) != 1 || items[0].Body != "a" {
		t.Fatalf("header filter returned %d messages, want just the eu one", len(items))
	}

	// A name with no value matches anything carrying the header at all, which
	// is the useful question when somebody does not know the values.
	any, err := conn.QueryMessages(testContext(t), model.MessageQueryParams{
		Topic:   "ORDERS",
		Filters: map[string]string{FilterHeaderName: "Region"},
	})
	if err != nil {
		t.Fatalf("QueryMessages: %v", err)
	}
	if len(any) != 2 {
		t.Errorf("matched %d messages carrying the header, want 2", len(any))
	}
}

// Headers reach the properties map, where the detail panel reads them.
func TestHeadersArriveAsProperties(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	publishTo(t, conn, "orders.created", "a", map[string]string{"Region": "eu", "Trace": "abc"})

	items, err := conn.QueryMessages(testContext(t), model.MessageQueryParams{Topic: "ORDERS"})
	if err != nil {
		t.Fatalf("QueryMessages: %v", err)
	}
	if items[0].Properties["Region"] != "eu" || items[0].Properties["Trace"] != "abc" {
		t.Errorf("properties = %v, want both headers", items[0].Properties)
	}
}

/*
 * Nats-Msg-Id is what a publisher sets for deduplication. It is not an address
 * - the server keeps it only for the duplicate window and indexes nothing by
 * it - so it travels as a key rather than as the message id.
 */
func TestADeduplicationIdIsAKeyRatherThanAnAddress(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	publishTo(t, conn, "orders.created", "a", map[string]string{natsclient.MsgIdHdr: "order-42"})

	items, err := conn.QueryMessages(testContext(t), model.MessageQueryParams{Topic: "ORDERS"})
	if err != nil {
		t.Fatalf("QueryMessages: %v", err)
	}
	if items[0].Keys != "order-42" {
		t.Errorf("keys = %q, want the dedup id", items[0].Keys)
	}
	if items[0].MessageID != "1" {
		t.Errorf("message id = %q, want the sequence - the dedup id is not an address", items[0].MessageID)
	}
}

func TestAMessageCanBeReadBackBySequence(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	sequence := publishTo(t, conn, "orders.created", "the one", nil)

	item, err := conn.MessageByID(testContext(t), "ORDERS", strconv.FormatUint(sequence, 10))
	if err != nil {
		t.Fatalf("MessageByID: %v", err)
	}
	if item.Body != "the one" {
		t.Errorf("body = %q, want the one", item.Body)
	}
}

// Somebody arriving from another family will type that family's id shape, and
// the message has to say which shape this one wants.
func TestALookupBySomethingThatIsNotASequenceSaysSo(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})

	_, err := conn.MessageByID(testContext(t), "ORDERS", "0A9A783C0EA1")
	if err == nil {
		t.Fatal("a rocketmq-shaped message id was accepted")
	}
	if !strings.Contains(err.Error(), "sequence") {
		t.Errorf("error %q does not say what shape is wanted", err)
	}
}

// A sequence that was deleted or trimmed away is not there, and the message
// has to name it so the reader can tell they are past the start of the stream.
func TestALookupPastTheStartOfTheStreamNamesTheSequence(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	fill(t, conn, "orders.created", 5)

	_, err := conn.MessageByID(testContext(t), "ORDERS", "99")
	if err == nil {
		t.Fatal("reading a sequence the stream does not hold succeeded")
	}
	if !strings.Contains(err.Error(), "99") {
		t.Errorf("error %q does not name the sequence", err)
	}
}

/*
 * A tail starts at the end. One that began by replaying a million messages
 * would be a browse wearing the wrong name, and the panel that opened it is
 * asking what arrives next.
 */
func TestAFirstTailStartsAtTheEnd(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	fill(t, conn, "orders.created", 50)

	batch, err := conn.TailMessages(testContext(t),
		model.DestinationRef{Name: "ORDERS"}, model.TailCursor{}, 10)
	if err != nil {
		t.Fatalf("TailMessages: %v", err)
	}
	if len(batch.Messages) != 0 {
		t.Errorf("a first tail returned %d messages, want none - it starts at the end",
			len(batch.Messages))
	}
	if batch.Cursor.Positions[0].Offset != 50 {
		t.Errorf("cursor = %d, want 50 - the end of what the stream holds",
			batch.Cursor.Positions[0].Offset)
	}
}

func TestATailReturnsWhatArrivedSinceTheCursor(t *testing.T) {
	conn := jetStreamConn(t)
	ctx := testContext(t)
	ref := model.DestinationRef{Name: "ORDERS"}
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	fill(t, conn, "orders.created", 5)

	first, err := conn.TailMessages(ctx, ref, model.TailCursor{}, 10)
	if err != nil {
		t.Fatalf("first tail: %v", err)
	}

	fill(t, conn, "orders.created", 3)

	second, err := conn.TailMessages(ctx, ref, first.Cursor, 10)
	if err != nil {
		t.Fatalf("second tail: %v", err)
	}
	if len(second.Messages) != 3 {
		t.Fatalf("tail returned %d messages, want the 3 that arrived", len(second.Messages))
	}
	if second.Cursor.Positions[0].Offset != 8 {
		t.Errorf("cursor = %d, want 8", second.Cursor.Positions[0].Offset)
	}

	// A poll with nothing new advances nothing and returns nothing, rather
	// than waiting out the fetch timeout.
	start := time.Now()
	third, err := conn.TailMessages(ctx, ref, second.Cursor, 10)
	if err != nil {
		t.Fatalf("third tail: %v", err)
	}
	if len(third.Messages) != 0 {
		t.Errorf("an idle poll returned %d messages", len(third.Messages))
	}
	if elapsed := time.Since(start); elapsed > browseTimeout {
		t.Errorf("an idle poll took %v, which means it waited for the fetch timeout", elapsed)
	}
}

/*
 * A tail slower than the retention it is watching is losing messages, and the
 * count is the difference between a quiet tail and one that is silently
 * dropping. Nothing else on the page would show it.
 */
func TestATailReportsWhatAgedOutBetweenPolls(t *testing.T) {
	conn := jetStreamConn(t)
	ctx := testContext(t)
	ref := model.DestinationRef{Name: "ORDERS"}
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	fill(t, conn, "orders.created", 10)

	// A cursor left behind at sequence 2, then everything below 6 trimmed away.
	cursor := model.TailCursor{Positions: []model.QueuePosition{{Offset: 2}}}
	if _, err := conn.Trim(ctx, model.TrimRequest{
		Ref: ref, Strategy: model.TrimMinID, MinID: "6",
	}); err != nil {
		t.Fatalf("Trim: %v", err)
	}

	batch, err := conn.TailMessages(ctx, ref, cursor, 10)
	if err != nil {
		t.Fatalf("TailMessages: %v", err)
	}
	// Sequences 3, 4 and 5 went while the tail was not looking.
	if batch.Dropped != 3 {
		t.Errorf("dropped = %d, want 3", batch.Dropped)
	}
	if len(batch.Messages) != 5 {
		t.Errorf("returned %d messages, want the 5 that survived", len(batch.Messages))
	}
}

func TestMessageCallsOnAServerWithoutJetStreamSayWhy(t *testing.T) {
	conn := open(t, startServer(t, serverOptions{}), false, false)
	ctx := testContext(t)

	calls := map[string]func() error{
		"query": func() error {
			_, err := conn.QueryMessages(ctx, model.MessageQueryParams{Topic: "ORDERS"})
			return err
		},
		"byId": func() error {
			_, err := conn.MessageByID(ctx, "ORDERS", "1")
			return err
		},
		"tail": func() error {
			_, err := conn.TailMessages(ctx, model.DestinationRef{Name: "ORDERS"}, model.TailCursor{}, 10)
			return err
		},
	}
	for name, call := range calls {
		t.Run(name, func(t *testing.T) {
			err := call()
			if err == nil {
				t.Fatal("succeeded against a server that stores nothing")
			}
			if err.Error() != jetStreamDisabled {
				t.Errorf("error = %q, want %q", err, jetStreamDisabled)
			}
		})
	}
}

/*
 * A browse must not wait for a timeout it does not need.
 *
 * The first implementation fetched in batches, and Fetch(n) waits until n
 * messages have arrived or its deadline passes - so a page of fifty over a
 * stream holding three took the full two seconds, every time. Filtered
 * browses were worse: the filter is what makes a stream short from the
 * consumer's point of view, so every one of them paid it.
 *
 * The bound is generous on purpose. What this guards is the difference between
 * "returns as soon as the stream is exhausted" and "waits out browseTimeout",
 * which is two orders of magnitude rather than a few milliseconds.
 */
func TestABrowseDoesNotWaitForMessagesTheStreamDoesNotHave(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	publishTo(t, conn, "orders.created", "a", nil)
	publishTo(t, conn, "orders.shipped", "b", nil)

	cases := []struct {
		name   string
		params model.MessageQueryParams
	}{
		{
			name:   "a page larger than the stream",
			params: model.MessageQueryParams{Topic: "ORDERS", MaxResults: 100},
		},
		{
			name: "a filter matching one message",
			params: model.MessageQueryParams{
				Topic:      "ORDERS",
				MaxResults: 100,
				Filters:    map[string]string{FilterSubject: "orders.created"},
			},
		},
		{
			name: "a filter matching nothing",
			params: model.MessageQueryParams{
				Topic:      "ORDERS",
				MaxResults: 100,
				Filters:    map[string]string{FilterSubject: "orders.refunded"},
			},
		},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			start := time.Now()
			if _, err := conn.QueryMessages(testContext(t), test.params); err != nil {
				t.Fatalf("QueryMessages: %v", err)
			}
			if elapsed := time.Since(start); elapsed >= browseTimeout {
				t.Errorf("took %v, which means it waited out browseTimeout (%v)",
					elapsed, browseTimeout)
			}
		})
	}
}

// A stream with nothing in it answers at once and with an empty list, rather
// than opening a consumer that has nothing to deliver.
func TestBrowsingAnEmptyStreamReturnsAtOnce(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "EMPTY", map[string]string{AttrSubjects: "empty.>"})

	start := time.Now()
	items, err := conn.QueryMessages(testContext(t), model.MessageQueryParams{
		Topic: "EMPTY", MaxResults: 50,
	})
	if err != nil {
		t.Fatalf("QueryMessages: %v", err)
	}
	if len(items) != 0 {
		t.Errorf("browsed %d messages from an empty stream", len(items))
	}
	if elapsed := time.Since(start); elapsed >= browseTimeout {
		t.Errorf("took %v, which means it waited out browseTimeout", elapsed)
	}
}
