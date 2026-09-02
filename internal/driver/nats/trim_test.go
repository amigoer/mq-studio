package nats

import (
	"strconv"
	"strings"
	"testing"

	"github.com/amigoer/mq-studio/internal/model"
)

// fill publishes n messages onto one subject of a stream.
func fill(t *testing.T, conn *Conn, subject string, count int) {
	t.Helper()
	ctx := testContext(t)
	for index := range count {
		if _, err := conn.js.Publish(ctx, subject, []byte(strconv.Itoa(index))); err != nil {
			t.Fatalf("publish %d: %v", index, err)
		}
	}
}

func held(t *testing.T, conn *Conn, name string) int64 {
	t.Helper()
	destination, err := conn.DestinationDetail(testContext(t), model.DestinationRef{Name: name})
	if err != nil {
		t.Fatalf("DestinationDetail: %v", err)
	}
	return destination.Depth
}

// Keeping the newest N is the bound an operator reclaiming disk asks for.
func TestTrimKeepsTheNewestMessages(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	fill(t, conn, "orders.created", 100)

	result, err := conn.Trim(testContext(t), model.TrimRequest{
		Ref:      model.DestinationRef{Name: "ORDERS"},
		Strategy: model.TrimMaxLen,
		MaxLen:   30,
	})
	if err != nil {
		t.Fatalf("Trim: %v", err)
	}
	if result.Removed != 70 {
		t.Errorf("removed = %d, want 70", result.Removed)
	}
	if got := held(t, conn, "ORDERS"); got != 30 {
		t.Errorf("stream holds %d, want 30", got)
	}
}

// Keeping none is emptying the stream, and it is the same command rather than
// a separate purge - which is why this driver declares no CapDestinationPurge.
func TestTrimToZeroEmptiesTheStream(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	fill(t, conn, "orders.created", 20)

	result, err := conn.Trim(testContext(t), model.TrimRequest{
		Ref:      model.DestinationRef{Name: "ORDERS"},
		Strategy: model.TrimMaxLen,
		MaxLen:   0,
	})
	if err != nil {
		t.Fatalf("Trim: %v", err)
	}
	if result.Removed != 20 {
		t.Errorf("removed = %d, want 20", result.Removed)
	}
	if got := held(t, conn, "ORDERS"); got != 0 {
		t.Errorf("stream holds %d after emptying, want 0", got)
	}
}

// A minimum sequence keeps a moment and lets everything before it go, however
// many that turns out to be. The message at the sequence survives, which is
// what "the lowest to keep" has to mean.
func TestTrimFromASequenceKeepsThatMessage(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	fill(t, conn, "orders.created", 50)

	result, err := conn.Trim(testContext(t), model.TrimRequest{
		Ref:      model.DestinationRef{Name: "ORDERS"},
		Strategy: model.TrimMinID,
		MinID:    "21",
	})
	if err != nil {
		t.Fatalf("Trim: %v", err)
	}
	if result.Removed != 20 {
		t.Errorf("removed = %d, want 20 - sequences 1 to 20", result.Removed)
	}

	destination, err := conn.DestinationDetail(testContext(t), model.DestinationRef{Name: "ORDERS"})
	if err != nil {
		t.Fatalf("DestinationDetail: %v", err)
	}
	if got := destination.Attributes[AttrFirstSeq]; got != "21" {
		t.Errorf("first sequence = %q, want 21 - the message at the bound must survive", got)
	}
}

// A trim that matched nothing and a stream that was already empty look
// identical on the page unless the count says which happened.
func TestTrimThatMatchesNothingRemovesNothing(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	fill(t, conn, "orders.created", 10)

	result, err := conn.Trim(testContext(t), model.TrimRequest{
		Ref:      model.DestinationRef{Name: "ORDERS"},
		Strategy: model.TrimMaxLen,
		MaxLen:   1000,
	})
	if err != nil {
		t.Fatalf("Trim: %v", err)
	}
	if result.Removed != 0 {
		t.Errorf("removed = %d, want 0 - the bound already held", result.Removed)
	}
	if got := held(t, conn, "ORDERS"); got != 10 {
		t.Errorf("stream holds %d, want its original 10", got)
	}
}

/*
 * Approx means the server may keep a little more than asked and never less.
 * An exact purge satisfies that, so it is accepted rather than refused: a
 * shared control failing against one family for a promise it is already
 * keeping would be the wrong answer.
 */
func TestAnApproximateTrimIsAcceptedAndExact(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	fill(t, conn, "orders.created", 40)

	result, err := conn.Trim(testContext(t), model.TrimRequest{
		Ref:      model.DestinationRef{Name: "ORDERS"},
		Strategy: model.TrimMaxLen,
		MaxLen:   10,
		Approx:   true,
	})
	if err != nil {
		t.Fatalf("Trim: %v", err)
	}
	if result.Removed != 30 {
		t.Errorf("removed = %d, want exactly 30", result.Removed)
	}
}

/*
 * Somebody arriving from Redis will type an entry id - "1699999999999-0" - and
 * the message has to say which shape this family wants, or the mistake is a
 * mystery rather than a typo.
 */
func TestATrimBoundThatIsNotASequenceSaysSo(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})

	_, err := conn.Trim(testContext(t), model.TrimRequest{
		Ref:      model.DestinationRef{Name: "ORDERS"},
		Strategy: model.TrimMinID,
		MinID:    "1699999999999-0",
	})
	if err == nil {
		t.Fatal("a redis-shaped entry id was accepted as a jetstream sequence")
	}
	if !strings.Contains(err.Error(), "sequence") {
		t.Errorf("error %q does not say what shape is wanted", err)
	}
}

func TestDeletingMessagesCountsWhatWasThere(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	fill(t, conn, "orders.created", 10)

	result, err := conn.DeleteEntries(testContext(t),
		model.DestinationRef{Name: "ORDERS"}, []string{"3", "5", "7"})
	if err != nil {
		t.Fatalf("DeleteEntries: %v", err)
	}
	if result.Removed != 3 {
		t.Errorf("removed = %d, want 3", result.Removed)
	}
	if got := held(t, conn, "ORDERS"); got != 7 {
		t.Errorf("stream holds %d, want 7", got)
	}
}

/*
 * A sequence that has already gone is not a failure: the caller asked for it
 * to be absent and it is. Stopping there would leave the rest of the list
 * undeleted for no reason, and the count is what tells them which happened.
 */
func TestDeletingAMessageThatIsAlreadyGoneIsNotAFailure(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	fill(t, conn, "orders.created", 5)

	ctx := testContext(t)
	ref := model.DestinationRef{Name: "ORDERS"}
	if _, err := conn.DeleteEntries(ctx, ref, []string{"2"}); err != nil {
		t.Fatalf("first delete: %v", err)
	}

	result, err := conn.DeleteEntries(ctx, ref, []string{"2", "3"})
	if err != nil {
		t.Fatalf("second delete: %v", err)
	}
	if result.Removed != 1 {
		t.Errorf("removed = %d, want 1 - one had already gone", result.Removed)
	}
}

// Both calls arrive on a connection whose page is still reachable, so both
// have to refuse with the reason the probe found.
func TestTrimCallsOnAServerWithoutJetStreamSayWhy(t *testing.T) {
	conn := open(t, startServer(t, serverOptions{}), false, false)
	ctx := testContext(t)
	ref := model.DestinationRef{Name: "ORDERS"}

	if _, err := conn.Trim(ctx, model.TrimRequest{Ref: ref, Strategy: model.TrimMaxLen}); err == nil {
		t.Error("Trim succeeded against a server that stores nothing")
	} else if err.Error() != jetStreamDisabled {
		t.Errorf("Trim error = %q, want %q", err, jetStreamDisabled)
	}

	if _, err := conn.DeleteEntries(ctx, ref, []string{"1"}); err == nil {
		t.Error("DeleteEntries succeeded against a server that stores nothing")
	} else if err.Error() != jetStreamDisabled {
		t.Errorf("DeleteEntries error = %q, want %q", err, jetStreamDisabled)
	}
}
