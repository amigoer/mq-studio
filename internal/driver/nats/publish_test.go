package nats

import (
	"context"
	"strings"
	"testing"
	"time"

	natsclient "github.com/nats-io/nats.go"

	"github.com/amigoer/mq-studio/internal/model"
)

func TestAPersistedPublishNamesWhereItLanded(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})

	result, err := conn.Publish(testContext(t), PublishRequest{
		Subject: "orders.created",
		Payload: "one",
		Persist: true,
	})
	if err != nil {
		t.Fatalf("Publish: %v", err)
	}
	if !result.Acknowledged {
		t.Error("a persisted publish reported no acknowledgement")
	}
	if result.Stream != "ORDERS" || result.Sequence != 1 {
		t.Errorf("landed at %s/%d, want ORDERS/1", result.Stream, result.Sequence)
	}
}

/*
 * Core NATS acknowledges nothing, by design. Reporting that as a failed send
 * would call the protocol broken; reporting it as acknowledged would claim
 * something nobody said. The result carries which kind of send it was.
 */
func TestACorePublishIsSentAndNotAcknowledged(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})

	result, err := conn.Publish(testContext(t), PublishRequest{
		Subject: "orders.created",
		Payload: "one",
	})
	if err != nil {
		t.Fatalf("Publish: %v", err)
	}
	if result.Sent != 1 {
		t.Errorf("sent = %d, want 1", result.Sent)
	}
	if result.Acknowledged {
		t.Error("a core publish reported an acknowledgement it cannot have")
	}
	if result.Stream != "" || result.Sequence != 0 {
		t.Errorf("a core publish named %s/%d, and it lands nowhere in particular",
			result.Stream, result.Sequence)
	}
}

/*
 * A wildcard subscribes; it does not publish. The server accepts one, matches
 * nothing with it, and reports success - so a message sent to "orders.*" goes
 * to nobody and is stored by no stream, and nothing on screen would say so.
 */
func TestPublishingToAPatternIsRefused(t *testing.T) {
	conn := jetStreamConn(t)
	ctx := testContext(t)

	for _, subject := range []string{"orders.*", "orders.>", "*"} {
		_, err := conn.Publish(ctx, PublishRequest{Subject: subject, Payload: "x"})
		if err == nil {
			t.Errorf("publishing to %q was accepted", subject)
			continue
		}
		if !strings.Contains(err.Error(), "pattern") {
			t.Errorf("error for %q = %q, which does not say why", subject, err)
		}
	}
}

/*
 * A subject nothing captures is a configuration mistake, and the library's own
 * "no responders" reads as a network problem instead.
 */
func TestAPersistedPublishNothingCapturesSaysSo(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})

	_, err := conn.Publish(testContext(t), PublishRequest{
		Subject: "payments.created",
		Payload: "x",
		Persist: true,
	})
	if err == nil {
		t.Fatal("a persisted publish to an uncaptured subject succeeded")
	}
	if !strings.Contains(err.Error(), "no stream captures") {
		t.Errorf("error = %q, which does not say what is wrong", err)
	}
}

// The guard against a subject typo landing somewhere else.
func TestExpectingAStreamRefusesTheWrongOne(t *testing.T) {
	conn := jetStreamConn(t)
	ctx := testContext(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	declare(t, conn, "EVENTS", map[string]string{AttrSubjects: "events.>"})

	_, err := conn.Publish(ctx, PublishRequest{
		Subject:      "orders.created",
		Payload:      "x",
		Persist:      true,
		ExpectStream: "EVENTS",
	})
	if err == nil {
		t.Fatal("a publish expecting the wrong stream succeeded")
	}

	result, err := conn.Publish(ctx, PublishRequest{
		Subject:      "orders.created",
		Payload:      "x",
		Persist:      true,
		ExpectStream: "ORDERS",
	})
	if err != nil {
		t.Fatalf("a publish expecting the right stream failed: %v", err)
	}
	if result.Stream != "ORDERS" {
		t.Errorf("landed in %s, want ORDERS", result.Stream)
	}
}

/*
 * A duplicate is a success and has to be reported as one. The message is not
 * stored twice - and it is also not stored once more, which is what somebody
 * pressing send again needs to know before they press it a third time.
 */
func TestADuplicateIsReportedRatherThanHidden(t *testing.T) {
	conn := jetStreamConn(t)
	ctx := testContext(t)
	declare(t, conn, "ORDERS", map[string]string{
		AttrSubjects: "orders.>", AttrDuplicates: "5m",
	})

	request := PublishRequest{
		Subject:         "orders.created",
		Payload:         "x",
		Persist:         true,
		DeduplicationID: "order-42",
	}
	if _, err := conn.Publish(ctx, request); err != nil {
		t.Fatalf("first publish: %v", err)
	}
	result, err := conn.Publish(ctx, request)
	if err != nil {
		t.Fatalf("second publish: %v", err)
	}
	if !result.Duplicate {
		t.Error("the second publish was not reported as a duplicate")
	}

	destination, err := conn.DestinationDetail(ctx, model.DestinationRef{Name: "ORDERS"})
	if err != nil {
		t.Fatalf("DestinationDetail: %v", err)
	}
	if destination.Depth != 1 {
		t.Errorf("stream holds %d messages, want 1", destination.Depth)
	}
}

func TestHeadersTravelWithTheMessage(t *testing.T) {
	conn := jetStreamConn(t)
	ctx := testContext(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})

	if _, err := conn.Publish(ctx, PublishRequest{
		Subject: "orders.created",
		Payload: "x",
		Persist: true,
		Headers: map[string]string{"Region": "eu"},
	}); err != nil {
		t.Fatalf("Publish: %v", err)
	}

	items, err := conn.QueryMessages(ctx, model.MessageQueryParams{Topic: "ORDERS"})
	if err != nil {
		t.Fatalf("QueryMessages: %v", err)
	}
	if items[0].Properties["Region"] != "eu" {
		t.Errorf("properties = %v, want the header", items[0].Properties)
	}
}

func TestTheRepeatCountIsBounded(t *testing.T) {
	conn := jetStreamConn(t)
	_, err := conn.Publish(testContext(t), PublishRequest{
		Subject: "orders.created",
		Payload: "x",
		Count:   maxPublishCount + 1,
	})
	if err == nil {
		t.Fatal("an unbounded repeat count was accepted")
	}
}

/*
 * Nobody listening and nobody answering in time are different diagnoses of the
 * same blank box, and they are fixed in different places.
 */
func TestARequestTellsSilenceApartFromAnEmptyRoom(t *testing.T) {
	conn := jetStreamConn(t)
	ctx := testContext(t)

	_, err := conn.Publish(ctx, PublishRequest{
		Subject:        "nobody.here",
		Payload:        "x",
		ReplyTimeoutMs: 500,
	})
	if err == nil {
		t.Fatal("a request to a subject with no subscriber succeeded")
	}
	if !strings.Contains(err.Error(), "listening") {
		t.Errorf("error = %q, want it to say nothing is listening", err)
	}

	// Somebody is there and says nothing, which is the other diagnosis.
	subscription, err := conn.nc.Subscribe("silent.here", func(*natsclient.Msg) {})
	if err != nil {
		t.Fatalf("Subscribe: %v", err)
	}
	defer func() { _ = subscription.Unsubscribe() }()
	if err := conn.nc.Flush(); err != nil {
		t.Fatalf("Flush: %v", err)
	}

	_, err = conn.Publish(ctx, PublishRequest{
		Subject:        "silent.here",
		Payload:        "x",
		ReplyTimeoutMs: 300,
	})
	if err == nil {
		t.Fatal("a request nobody answered succeeded")
	}
	if !strings.Contains(err.Error(), "within") {
		t.Errorf("error = %q, want it to say nothing answered in time", err)
	}
}

func TestARequestReturnsWhatAnswered(t *testing.T) {
	conn := jetStreamConn(t)
	subscription, err := conn.nc.Subscribe("echo.here", func(message *natsclient.Msg) {
		_ = message.Respond([]byte("pong"))
	})
	if err != nil {
		t.Fatalf("Subscribe: %v", err)
	}
	defer func() { _ = subscription.Unsubscribe() }()
	if err := conn.nc.Flush(); err != nil {
		t.Fatalf("Flush: %v", err)
	}

	result, err := conn.Publish(testContext(t), PublishRequest{
		Subject:        "echo.here",
		Payload:        "ping",
		ReplyTimeoutMs: 2000,
	})
	if err != nil {
		t.Fatalf("Publish: %v", err)
	}
	if !result.Answered || result.Reply != "pong" {
		t.Errorf("reply = %q answered=%v, want pong", result.Reply, result.Answered)
	}
}

// An empty reply and no reply are different facts about the same blank box.
func TestAnEmptyReplyIsStillAnAnswer(t *testing.T) {
	conn := jetStreamConn(t)
	subscription, err := conn.nc.Subscribe("quiet.here", func(message *natsclient.Msg) {
		_ = message.Respond(nil)
	})
	if err != nil {
		t.Fatalf("Subscribe: %v", err)
	}
	defer func() { _ = subscription.Unsubscribe() }()
	if err := conn.nc.Flush(); err != nil {
		t.Fatalf("Flush: %v", err)
	}

	result, err := conn.Publish(testContext(t), PublishRequest{
		Subject:        "quiet.here",
		Payload:        "ping",
		ReplyTimeoutMs: 2000,
	})
	if err != nil {
		t.Fatalf("Publish: %v", err)
	}
	if !result.Answered {
		t.Error("an empty reply was reported as no reply")
	}
	if result.Reply != "" {
		t.Errorf("reply = %q, want empty", result.Reply)
	}
}

// A request expects one answer, so a repeat count has no meaning.
func TestARequestCannotBeRepeated(t *testing.T) {
	conn := jetStreamConn(t)
	_, err := conn.Publish(testContext(t), PublishRequest{
		Subject:        "echo.here",
		Payload:        "x",
		Count:          5,
		ReplyTimeoutMs: 100,
	})
	if err == nil {
		t.Fatal("a repeated request was accepted")
	}
}

/*
 * The canonical signature is RocketMQ's. Two of its arguments have no NATS
 * meaning and one names a mechanism NATS does not have, and each is refused
 * rather than dropped: a message that arrived without the tag somebody set
 * would be reported as sent correctly.
 */
func TestTheCanonicalPublishRefusesWhatItCannotCarry(t *testing.T) {
	conn := jetStreamConn(t)
	ctx := testContext(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})

	cases := []struct {
		name       string
		tags       string
		keys       string
		delayLevel int
		mention    string
	}{
		{name: "a tag", tags: "urgent", mention: "tags"},
		{name: "a key", keys: "order-42", mention: "keys"},
		{name: "a delay level", delayLevel: 3, mention: "delayed"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			_, err := conn.SendMessage(ctx, "orders.created", test.tags, test.keys, "body", test.delayLevel)
			if err == nil {
				t.Fatal("accepted")
			}
			if !strings.Contains(err.Error(), test.mention) {
				t.Errorf("error = %q, does not mention %q", err, test.mention)
			}
		})
	}
}

// The canonical publish persists where a stream captures the subject, so the
// message is still there to look at afterwards.
func TestTheCanonicalPublishStoresWhereItCan(t *testing.T) {
	conn := jetStreamConn(t)
	ctx := testContext(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})

	id, err := conn.SendMessage(ctx, "orders.created", "", "", "body", 0)
	if err != nil {
		t.Fatalf("SendMessage: %v", err)
	}
	if id != "1" {
		t.Errorf("returned %q, want the sequence it was stored at", id)
	}
}

/*
 * And falls back to core where nothing captures it. A subject with no stream
 * is not an error - it is what most NATS subjects are - so the message goes to
 * whoever is listening and the subject comes back, there being no identifier.
 */
func TestTheCanonicalPublishFallsBackToCore(t *testing.T) {
	conn := jetStreamConn(t)
	id, err := conn.SendMessage(testContext(t), "nothing.captures.this", "", "", "body", 0)
	if err != nil {
		t.Fatalf("SendMessage: %v", err)
	}
	if id != "nothing.captures.this" {
		t.Errorf("returned %q, want the subject - a core publish has no identifier", id)
	}
}

// A publish is the protocol, so it works on a server that stores nothing.
func TestPublishingWorksWithoutJetStream(t *testing.T) {
	conn := open(t, startServer(t, serverOptions{}), false, false)

	result, err := conn.Publish(testContext(t), PublishRequest{Subject: "a.b", Payload: "x"})
	if err != nil {
		t.Fatalf("Publish: %v", err)
	}
	if result.Sent != 1 {
		t.Errorf("sent = %d, want 1", result.Sent)
	}

	// Asking for persistence there is the one thing that cannot work, and it
	// says which tier is missing rather than failing generically.
	_, err = conn.Publish(testContext(t), PublishRequest{Subject: "a.b", Payload: "x", Persist: true})
	if err == nil {
		t.Fatal("a persisted publish succeeded on a server without jetstream")
	}
	if err.Error() != jetStreamDisabled {
		t.Errorf("error = %q, want %q", err, jetStreamDisabled)
	}
}

// A closed connection reports that rather than a network error.
func TestPublishingOnAClosedConnectionSaysSo(t *testing.T) {
	conn := open(t, startServer(t, serverOptions{}), false, false)
	_ = conn.Close()

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, err := conn.Publish(ctx, PublishRequest{Subject: "a.b", Payload: "x"}); err == nil {
		t.Fatal("publishing on a closed connection succeeded")
	}
}
