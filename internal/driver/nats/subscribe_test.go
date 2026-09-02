package nats

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/model"
)

// sendCore publishes without JetStream.
//
// The subjects in this file have no stream behind them, which is what most
// NATS subjects are. A JetStream publish there waits for an acknowledgement
// that is never coming - which is a real behaviour worth knowing, and not the
// one these tests are about.
func sendCore(t *testing.T, conn *Conn, subject, body string) {
	t.Helper()
	if _, err := conn.Publish(testContext(t), PublishRequest{Subject: subject, Payload: body}); err != nil {
		t.Fatalf("publish %s: %v", subject, err)
	}
}

// subscribeTo starts a live subscription on one subject.
func subscribeTo(t *testing.T, conn *Conn, pattern string) *model.LiveSubscription {
	t.Helper()
	stream, err := conn.StartLiveSubscription(testContext(t), model.LiveSubscriptionSpec{
		Filters: []model.LiveFilter{{Pattern: pattern}},
	})
	if err != nil {
		t.Fatalf("StartLiveSubscription(%s): %v", pattern, err)
	}
	t.Cleanup(func() { _ = conn.StopLiveSubscription(testContext(t), stream.ID) })
	return stream
}

// awaitMessages polls until the stream has delivered at least want, or gives
// up. A subscription is asynchronous: the messages arrive on the client's own
// goroutine, so a single poll would race the delivery.
func awaitMessages(t *testing.T, conn *Conn, id string, want int) *model.LiveBatch {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		batch, err := conn.PollLiveSubscription(testContext(t), id, 0, 1000)
		if err != nil {
			t.Fatalf("PollLiveSubscription: %v", err)
		}
		if len(batch.Messages) >= want || time.Now().After(deadline) {
			return batch
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestALiveSubscriptionBuffersWhatArrives(t *testing.T) {
	conn := jetStreamConn(t)
	stream := subscribeTo(t, conn, "orders.>")

	for index := range 3 {
		sendCore(t, conn, "orders.created", strconv.Itoa(index))
	}

	batch := awaitMessages(t, conn, stream.ID, 3)
	if len(batch.Messages) != 3 {
		t.Fatalf("received %d messages, want 3", len(batch.Messages))
	}
	if !batch.Live {
		t.Error("the stream reported itself as not listening")
	}
	// The subject a wildcard subscription matched cannot be inferred from the
	// filter, so it travels on the message.
	if batch.Messages[0].Destination != "orders.created" {
		t.Errorf("destination = %q, want orders.created", batch.Messages[0].Destination)
	}
	if batch.Messages[0].Filter != "orders.>" {
		t.Errorf("filter = %q, want the pattern that matched", batch.Messages[0].Filter)
	}
}

// The cursor is how a caller asks for what it has not seen. Without it a page
// polling every second would redraw the same messages forever.
func TestPollingResumesFromTheCursor(t *testing.T) {
	conn := jetStreamConn(t)
	ctx := testContext(t)
	stream := subscribeTo(t, conn, "orders.>")

	sendCore(t, conn, "orders.created", "a")
	first := awaitMessages(t, conn, stream.ID, 1)

	sendCore(t, conn, "orders.created", "b")
	deadline := time.Now().Add(5 * time.Second)
	var second *model.LiveBatch
	for {
		batch, err := conn.PollLiveSubscription(ctx, stream.ID, first.Cursor, 100)
		if err != nil {
			t.Fatalf("PollLiveSubscription: %v", err)
		}
		if len(batch.Messages) > 0 || time.Now().After(deadline) {
			second = batch
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	if len(second.Messages) != 1 || second.Messages[0].Body != "b" {
		t.Fatalf("second poll returned %d messages, want just the new one", len(second.Messages))
	}
}

/*
 * A stream that is quietly losing messages and one that is quiet look the same
 * on screen. The dropped count is the only thing that separates them, and it
 * is a running total so a caller that polls irregularly still sees the whole
 * loss.
 */
func TestAFullBufferDropsTheOldestAndSaysSo(t *testing.T) {
	conn := jetStreamConn(t)
	stream, err := conn.StartLiveSubscription(testContext(t), model.LiveSubscriptionSpec{
		Filters: []model.LiveFilter{{Pattern: "orders.>"}},
		Buffer:  5,
	})
	if err != nil {
		t.Fatalf("StartLiveSubscription: %v", err)
	}
	t.Cleanup(func() { _ = conn.StopLiveSubscription(testContext(t), stream.ID) })

	for index := range 20 {
		sendCore(t, conn, "orders.created", strconv.Itoa(index))
	}

	deadline := time.Now().Add(5 * time.Second)
	var batch *model.LiveBatch
	for {
		batch = awaitMessages(t, conn, stream.ID, 5)
		if batch.Received >= 20 || time.Now().After(deadline) {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	if len(batch.Messages) > 5 {
		t.Errorf("buffer held %d messages, want no more than 5", len(batch.Messages))
	}
	if batch.Dropped == 0 {
		t.Error("messages were lost and the stream reported none dropped")
	}
	// The oldest go, not the newest: a live view is for watching what is
	// happening now, so falling behind should cost history rather than the
	// present.
	last := batch.Messages[len(batch.Messages)-1]
	if last.Body != "19" {
		t.Errorf("newest buffered message = %q, want the last one published", last.Body)
	}
}

// A body cut to the limit has to say so, or a shortened payload reads as a
// malformed message.
func TestALongBodyIsTruncatedAndMarked(t *testing.T) {
	conn := jetStreamConn(t)
	stream := subscribeTo(t, conn, "big.>")

	body := make([]byte, maxLiveBody+1000)
	for index := range body {
		body[index] = 'x'
	}
	sendCore(t, conn, "big.one", string(body))

	batch := awaitMessages(t, conn, stream.ID, 1)
	if len(batch.Messages) != 1 {
		t.Fatalf("received %d messages, want 1", len(batch.Messages))
	}
	message := batch.Messages[0]
	if !message.Truncated {
		t.Error("a cut body was not marked truncated")
	}
	if len(message.Body) != maxLiveBody {
		t.Errorf("body length = %d, want %d", len(message.Body), maxLiveBody)
	}
	// The real size travels too, so the page can say how much was cut.
	if message.Attributes[LiveAttrSize] != strconv.Itoa(len(body)) {
		t.Errorf("size = %q, want the full %d", message.Attributes[LiveAttrSize], len(body))
	}
}

/*
 * A message that asked for an answer is a request, and that changes what
 * silence on the page means: nobody is replying, rather than nobody is
 * publishing.
 */
func TestARequestIsMarkedWithWhereItWantsAnAnswer(t *testing.T) {
	conn := jetStreamConn(t)
	stream := subscribeTo(t, conn, "ask.>")

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_, _ = conn.nc.RequestWithContext(ctx, "ask.something", []byte("?"))
	}()

	batch := awaitMessages(t, conn, stream.ID, 1)
	if len(batch.Messages) != 1 {
		t.Fatalf("received %d messages, want 1", len(batch.Messages))
	}
	if batch.Messages[0].Attributes[LiveAttrReplyTo] == "" {
		t.Error("a request was not marked with where it wants an answer")
	}
}

// Several subjects at once, read back apart by which filter matched.
func TestOneSubscriptionCanWatchSeveralSubjects(t *testing.T) {
	conn := jetStreamConn(t)
	stream, err := conn.StartLiveSubscription(testContext(t), model.LiveSubscriptionSpec{
		Filters: []model.LiveFilter{{Pattern: "orders.>"}, {Pattern: "events.>"}},
	})
	if err != nil {
		t.Fatalf("StartLiveSubscription: %v", err)
	}
	t.Cleanup(func() { _ = conn.StopLiveSubscription(testContext(t), stream.ID) })

	sendCore(t, conn, "orders.created", "a")
	sendCore(t, conn, "events.tick", "b")

	batch := awaitMessages(t, conn, stream.ID, 2)
	filters := map[string]bool{}
	for _, message := range batch.Messages {
		filters[message.Filter] = true
	}
	if !filters["orders.>"] || !filters["events.>"] {
		t.Errorf("filters seen = %v, want both", filters)
	}
}

// A > anywhere but the end matches nothing, and the page would sit silent with
// nothing to say why.
func TestASubscriptionRefusesAPatternThatMatchesNothing(t *testing.T) {
	conn := jetStreamConn(t)
	_, err := conn.StartLiveSubscription(testContext(t), model.LiveSubscriptionSpec{
		Filters: []model.LiveFilter{{Pattern: "orders.>.created"}},
	})
	if err == nil {
		t.Fatal("a pattern that matches nothing was accepted")
	}
}

func TestASubscriptionNeedsASubject(t *testing.T) {
	conn := jetStreamConn(t)
	if _, err := conn.StartLiveSubscription(testContext(t), model.LiveSubscriptionSpec{}); err == nil {
		t.Fatal("a subscription with no subject was accepted")
	}
}

// A panel that remounts has to find its own stream again rather than start a
// second one.
func TestRunningSubscriptionsCanBeListed(t *testing.T) {
	conn := jetStreamConn(t)
	ctx := testContext(t)
	first := subscribeTo(t, conn, "orders.>")
	second := subscribeTo(t, conn, "events.>")

	running, err := conn.LiveSubscriptions(ctx)
	if err != nil {
		t.Fatalf("LiveSubscriptions: %v", err)
	}
	ids := map[string]bool{}
	for _, stream := range running {
		ids[stream.ID] = true
	}
	if !ids[first.ID] || !ids[second.ID] {
		t.Errorf("listed %v, want both subscriptions", ids)
	}
}

/*
 * Stopping is not optional cleanup. The subscription lives on the server until
 * it is stopped, so a page that forgot would leave the connection receiving
 * everything on that subject for as long as it stayed open.
 */
func TestStoppingASubscriptionEndsIt(t *testing.T) {
	conn := jetStreamConn(t)
	ctx := testContext(t)
	stream, err := conn.StartLiveSubscription(ctx, model.LiveSubscriptionSpec{
		Filters: []model.LiveFilter{{Pattern: "orders.>"}},
	})
	if err != nil {
		t.Fatalf("StartLiveSubscription: %v", err)
	}

	if err := conn.StopLiveSubscription(ctx, stream.ID); err != nil {
		t.Fatalf("StopLiveSubscription: %v", err)
	}
	if _, err := conn.PollLiveSubscription(ctx, stream.ID, 0, 10); err == nil {
		t.Error("polling a stopped subscription succeeded")
	}
	running, err := conn.LiveSubscriptions(ctx)
	if err != nil {
		t.Fatalf("LiveSubscriptions: %v", err)
	}
	if len(running) != 0 {
		t.Errorf("%d subscriptions are still running after stopping the only one", len(running))
	}
}

// Closing the connection ends every subscription, since the caller cannot.
func TestClosingTheConnectionEndsEverySubscription(t *testing.T) {
	conn := jetStreamConn(t)
	subscribeTo(t, conn, "orders.>")
	subscribeTo(t, conn, "events.>")

	if err := conn.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	running, err := conn.LiveSubscriptions(testContext(t))
	if err != nil {
		t.Fatalf("LiveSubscriptions: %v", err)
	}
	if len(running) != 0 {
		t.Errorf("%d subscriptions survived the connection closing", len(running))
	}
}

// Subscribing is the protocol, so it works on a server that stores nothing.
func TestSubscribingWorksWithoutJetStream(t *testing.T) {
	conn := open(t, startServer(t, serverOptions{}), false, false)
	stream, err := conn.StartLiveSubscription(testContext(t), model.LiveSubscriptionSpec{
		Filters: []model.LiveFilter{{Pattern: "anything.>"}},
	})
	if err != nil {
		t.Fatalf("StartLiveSubscription: %v", err)
	}
	if _, err := conn.PollLiveSubscription(testContext(t), stream.ID, 0, 10); err != nil {
		t.Fatalf("PollLiveSubscription: %v", err)
	}
}
