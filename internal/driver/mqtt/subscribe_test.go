package mqtt

import (
	"context"
	"fmt"
	"testing"
	"time"

	mochi "github.com/mochi-mqtt/server/v2"

	"github.com/amigoer/mq-studio/internal/model"
)

// startStream subscribes and stops the subscription when the test ends.
func startStream(t *testing.T, conn *Conn, filters ...string) *model.LiveSubscription {
	t.Helper()

	spec := model.LiveSubscriptionSpec{}
	for _, filter := range filters {
		spec.Filters = append(spec.Filters, model.LiveFilter{Pattern: filter})
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	subscription, err := conn.StartLiveSubscription(ctx, spec)
	if err != nil {
		t.Fatalf("start live subscription: %v", err)
	}
	t.Cleanup(func() {
		stopCtx, stopCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer stopCancel()
		_ = conn.StopLiveSubscription(stopCtx, subscription.ID)
	})
	return subscription
}

// drain polls until want messages have arrived, or the stream stays empty long
// enough to call it. Delivery is asynchronous, so a single poll would be a
// race that passes on a fast machine.
func drain(t *testing.T, conn *Conn, id string, want int) *model.LiveBatch {
	t.Helper()

	collected := &model.LiveBatch{}
	deadline := time.Now().Add(5 * time.Second)
	cursor := int64(0)
	for time.Now().Before(deadline) {
		batch, err := conn.PollLiveSubscription(context.Background(), id, cursor, 0)
		if err != nil {
			t.Fatalf("poll: %v", err)
		}
		collected.Messages = append(collected.Messages, batch.Messages...)
		collected.Cursor = batch.Cursor
		collected.Dropped = batch.Dropped
		collected.Received = batch.Received
		collected.Live = batch.Live
		cursor = batch.Cursor
		if len(collected.Messages) >= want {
			return collected
		}
		time.Sleep(20 * time.Millisecond)
	}
	if want > 0 {
		t.Fatalf("only %d of %d messages arrived", len(collected.Messages), want)
	}
	return collected
}

// publishFromBroker sends as the broker's own inline client, so the message
// comes from somewhere other than the connection under test - which matters,
// because a 5.0 subscription here sets NoLocal.
func publishFromBroker(t *testing.T, server *mochi.Server, topic, payload string, retain bool) {
	t.Helper()
	if err := server.Publish(topic, []byte(payload), retain, 0); err != nil {
		t.Fatalf("broker publish: %v", err)
	}
}

func TestLiveSubscriptionStreamsWhatArrives(t *testing.T) {
	for _, version := range []string{protocol5, protocol311} {
		t.Run("mqtt"+version, func(t *testing.T) {
			server, address := fakeBrokerServer(t)
			conn := openProfile(t, testProfile(address, version, nil))
			subscription := startStream(t, conn, "sensors/#")

			publishFromBroker(t, server, "sensors/room-1/temperature", "21.5", false)
			publishFromBroker(t, server, "sensors/room-2/temperature", "19.0", false)

			batch := drain(t, conn, subscription.ID, 2)
			if got := batch.Messages[0]; got.Destination != "sensors/room-1/temperature" || got.Body != "21.5" {
				t.Errorf("first message = %+v", got)
			}
			// The filter that matched is carried, because a wildcard
			// subscription cannot be read back apart from the topic alone.
			if batch.Messages[0].Filter != "sensors/#" {
				t.Errorf("filter = %q, want sensors/#", batch.Messages[0].Filter)
			}
			// Sequence orders the stream and is what the caller hands back.
			if batch.Messages[0].Seq != 1 || batch.Messages[1].Seq != 2 {
				t.Errorf("sequences = %d, %d; want 1, 2",
					batch.Messages[0].Seq, batch.Messages[1].Seq)
			}
			if batch.Cursor != 2 {
				t.Errorf("cursor = %d, want 2", batch.Cursor)
			}
			if !batch.Live {
				t.Error("the stream reports itself as not listening")
			}
		})
	}
}

// A message nobody's filter matches must not be attributed to a stream that
// happens to exist. The broker delivers by topic and says nothing about which
// subscription asked.
func TestLiveSubscriptionRoutesByFilter(t *testing.T) {
	server, address := fakeBrokerServer(t)
	conn := openProfile(t, testProfile(address, protocol5, nil))

	sensors := startStream(t, conn, "sensors/#")
	devices := startStream(t, conn, "devices/+/status")

	publishFromBroker(t, server, "sensors/room-1/temperature", "21.5", false)
	publishFromBroker(t, server, "devices/a19f/status", "online", false)

	sensorBatch := drain(t, conn, sensors.ID, 1)
	deviceBatch := drain(t, conn, devices.ID, 1)

	if len(sensorBatch.Messages) != 1 || sensorBatch.Messages[0].Destination != "sensors/room-1/temperature" {
		t.Errorf("the sensors stream saw %+v", sensorBatch.Messages)
	}
	if len(deviceBatch.Messages) != 1 || deviceBatch.Messages[0].Destination != "devices/a19f/status" {
		t.Errorf("the devices stream saw %+v", deviceBatch.Messages)
	}
}

// Two panels watching the same filter are one subscription on the broker and
// both have to see every message, so delivery fans out rather than stopping at
// the first stream that matches.
func TestLiveSubscriptionFansOutToEveryMatchingStream(t *testing.T) {
	server, address := fakeBrokerServer(t)
	conn := openProfile(t, testProfile(address, protocol5, nil))

	first := startStream(t, conn, "sensors/#")
	second := startStream(t, conn, "sensors/room-1/+")

	publishFromBroker(t, server, "sensors/room-1/temperature", "21.5", false)

	if got := drain(t, conn, first.ID, 1); len(got.Messages) != 1 {
		t.Errorf("the first stream saw %d messages", len(got.Messages))
	}
	if got := drain(t, conn, second.ID, 1); len(got.Messages) != 1 {
		t.Errorf("the second stream saw %d messages", len(got.Messages))
	}
}

/*
 * The buffer is bounded, so a stream faster than its reader loses messages.
 *
 * What must not happen is losing them quietly: a stream that is dropping and
 * one that is idle look identical to a panel, and the first is a reason to
 * widen the buffer or narrow the filter.
 */
func TestLiveSubscriptionCountsWhatTheBufferDropped(t *testing.T) {
	server, address := fakeBrokerServer(t)
	conn := openProfile(t, testProfile(address, protocol5, nil))

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	subscription, err := conn.StartLiveSubscription(ctx, model.LiveSubscriptionSpec{
		Filters: []model.LiveFilter{{Pattern: "flood/#"}},
		Buffer:  4,
	})
	if err != nil {
		t.Fatalf("start live subscription: %v", err)
	}
	t.Cleanup(func() { _ = conn.StopLiveSubscription(context.Background(), subscription.ID) })

	for i := range 20 {
		publishFromBroker(t, server, "flood/messages", fmt.Sprintf("%d", i), false)
	}

	deadline := time.Now().Add(5 * time.Second)
	var batch *model.LiveBatch
	for time.Now().Before(deadline) {
		batch, err = conn.PollLiveSubscription(context.Background(), subscription.ID, 0, 0)
		if err != nil {
			t.Fatalf("poll: %v", err)
		}
		if batch.Received == 20 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}

	if batch.Received != 20 {
		t.Fatalf("received = %d, want 20", batch.Received)
	}
	if len(batch.Messages) != 4 {
		t.Errorf("held %d messages, want the buffer's 4", len(batch.Messages))
	}
	if batch.Dropped != 16 {
		t.Errorf("dropped = %d, want 16", batch.Dropped)
	}
	// What is held is the newest, not the oldest: a live view that froze on
	// the first four messages and called itself live would be worse than one
	// that says it lost sixteen.
	if batch.Messages[len(batch.Messages)-1].Body != "19" {
		t.Errorf("last held message = %q, want the newest", batch.Messages[len(batch.Messages)-1].Body)
	}
}

// A retained message is the only stored state MQTT has: it is replayed to
// whoever subscribes next, however long afterwards. Keeping the flag set is
// what lets a panel say a value is the last known one rather than a new one.
func TestLiveSubscriptionReplaysRetainedMessages(t *testing.T) {
	for _, version := range []string{protocol5, protocol311} {
		t.Run("mqtt"+version, func(t *testing.T) {
			server, address := fakeBrokerServer(t)
			publishFromBroker(t, server, "devices/a19f/status", "online", true)

			conn := openProfile(t, testProfile(address, version, nil))
			subscription := startStream(t, conn, "devices/#")

			batch := drain(t, conn, subscription.ID, 1)
			message := batch.Messages[0]
			if message.Body != "online" {
				t.Errorf("body = %q, want online", message.Body)
			}
			if message.Attributes[AttrRetained] != "true" {
				t.Errorf("the retained flag did not survive: %+v", message.Attributes)
			}
		})
	}
}

// Subscribing to everything must not drain the broker's own telemetry tree,
// or the workbench fills with $SYS and the overview reads it twice.
func TestLiveSubscriptionLeavesSysAlone(t *testing.T) {
	server, address := fakeBrokerServer(t)
	conn := openProfile(t, testProfile(address, protocol5, nil))
	subscription := startStream(t, conn, "#")

	publishFromBroker(t, server, "$SYS/broker/uptime", "42", false)
	publishFromBroker(t, server, "sensors/room-1", "21.5", false)

	batch := drain(t, conn, subscription.ID, 1)
	for _, message := range batch.Messages {
		if message.Destination == "$SYS/broker/uptime" {
			t.Error("a subscription to # drained the $SYS tree")
		}
	}
}

func TestStartLiveSubscriptionRefusesWhatABrokerWould(t *testing.T) {
	address := fakeBroker(t)
	conn := openProfile(t, testProfile(address, protocol5, nil))

	tests := []struct {
		name string
		spec model.LiveSubscriptionSpec
	}{
		{name: "no filters", spec: model.LiveSubscriptionSpec{}},
		{
			name: "a wildcard mid-filter",
			spec: model.LiveSubscriptionSpec{Filters: []model.LiveFilter{{Pattern: "a/#/b"}}},
		},
		{
			name: "a wildcard inside a level",
			spec: model.LiveSubscriptionSpec{Filters: []model.LiveFilter{{Pattern: "sport+"}}},
		},
		{
			name: "a qos that is not a qos",
			spec: model.LiveSubscriptionSpec{Filters: []model.LiveFilter{
				{Pattern: "a/#", Options: map[string]string{AttrQoS: "9"}},
			}},
		},
		{
			name: "a buffer past the cap",
			spec: model.LiveSubscriptionSpec{
				Filters: []model.LiveFilter{{Pattern: "a/#"}},
				Buffer:  maxStreamBuffer + 1,
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()

			if _, err := conn.StartLiveSubscription(ctx, test.spec); err == nil {
				t.Error("a subscription the broker would refuse was accepted")
			}
		})
	}
}

// Shared subscriptions are 5.0 only. Sending one to a 3.1.1 broker subscribes
// to a topic literally called $share/... , which silently receives nothing.
func TestStartLiveSubscriptionRefusesASharedFilterOn311(t *testing.T) {
	address := fakeBroker(t)
	conn := openProfile(t, testProfile(address, protocol311, nil))

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := conn.StartLiveSubscription(ctx, model.LiveSubscriptionSpec{
		Filters: []model.LiveFilter{{Pattern: "$share/console/sensors/#"}},
	})
	if err == nil {
		t.Error("a 3.1.1 connection accepted a shared subscription")
	}
}

func TestLiveSubscriptionsListsWhatIsRunning(t *testing.T) {
	address := fakeBroker(t)
	conn := openProfile(t, testProfile(address, protocol5, nil))

	first := startStream(t, conn, "sensors/#")
	second := startStream(t, conn, "devices/#")

	running, err := conn.LiveSubscriptions(context.Background())
	if err != nil {
		t.Fatalf("live subscriptions: %v", err)
	}
	if len(running) != 2 {
		t.Fatalf("%d subscriptions are running, want 2", len(running))
	}

	ids := map[string]bool{running[0].ID: true, running[1].ID: true}
	if !ids[first.ID] || !ids[second.ID] {
		t.Errorf("the running list does not name both streams: %+v", running)
	}
}

// The broker holds a subscription until told otherwise, so a stopped stream
// has to stop the delivery too - not merely stop reading it.
func TestStopLiveSubscriptionEndsTheDelivery(t *testing.T) {
	server, address := fakeBrokerServer(t)
	conn := openProfile(t, testProfile(address, protocol5, nil))

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	subscription, err := conn.StartLiveSubscription(ctx, model.LiveSubscriptionSpec{
		Filters: []model.LiveFilter{{Pattern: "sensors/#"}},
	})
	if err != nil {
		t.Fatalf("start live subscription: %v", err)
	}
	if err := conn.StopLiveSubscription(ctx, subscription.ID); err != nil {
		t.Fatalf("stop live subscription: %v", err)
	}

	publishFromBroker(t, server, "sensors/room-1", "21.5", false)

	if _, err := conn.PollLiveSubscription(ctx, subscription.ID, 0, 0); err == nil {
		t.Error("a stopped subscription can still be polled")
	}
	if err := conn.StopLiveSubscription(ctx, subscription.ID); err == nil {
		t.Error("stopping a subscription twice reported success the second time")
	}
}

// Stopping one of two streams that share a filter must not unsubscribe the
// other: they are one subscription on the broker.
func TestStopLiveSubscriptionKeepsAFilterASecondStreamStillWants(t *testing.T) {
	server, address := fakeBrokerServer(t)
	conn := openProfile(t, testProfile(address, protocol5, nil))

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	first, err := conn.StartLiveSubscription(ctx, model.LiveSubscriptionSpec{
		Filters: []model.LiveFilter{{Pattern: "sensors/#"}},
	})
	if err != nil {
		t.Fatalf("start first: %v", err)
	}
	second := startStream(t, conn, "sensors/#")

	if err := conn.StopLiveSubscription(ctx, first.ID); err != nil {
		t.Fatalf("stop first: %v", err)
	}

	publishFromBroker(t, server, "sensors/room-1", "21.5", false)
	if got := drain(t, conn, second.ID, 1); len(got.Messages) != 1 {
		t.Errorf("the surviving stream saw %d messages", len(got.Messages))
	}
}

// A poll of a quiet stream has to move the cursor past what was dropped, or a
// caller that fell behind re-asks for a window that no longer exists on every
// poll and never catches up.
func TestPollAdvancesTheCursorPastWhatIsGone(t *testing.T) {
	server, address := fakeBrokerServer(t)
	conn := openProfile(t, testProfile(address, protocol5, nil))

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	subscription, err := conn.StartLiveSubscription(ctx, model.LiveSubscriptionSpec{
		Filters: []model.LiveFilter{{Pattern: "flood/#"}},
		Buffer:  2,
	})
	if err != nil {
		t.Fatalf("start live subscription: %v", err)
	}
	t.Cleanup(func() { _ = conn.StopLiveSubscription(context.Background(), subscription.ID) })

	for i := range 10 {
		publishFromBroker(t, server, "flood/messages", fmt.Sprintf("%d", i), false)
	}

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		batch, err := conn.PollLiveSubscription(ctx, subscription.ID, 0, 0)
		if err != nil {
			t.Fatalf("poll: %v", err)
		}
		if batch.Received < 10 {
			time.Sleep(20 * time.Millisecond)
			continue
		}
		// Everything held is newer than the cursor a caller starting at 0
		// would be given back, and the cursor names the newest of them.
		if batch.Cursor != batch.Messages[len(batch.Messages)-1].Seq {
			t.Errorf("cursor = %d, want %d", batch.Cursor,
				batch.Messages[len(batch.Messages)-1].Seq)
		}
		// A second poll from that cursor is empty and does not go backwards.
		next, err := conn.PollLiveSubscription(ctx, subscription.ID, batch.Cursor, 0)
		if err != nil {
			t.Fatalf("second poll: %v", err)
		}
		if len(next.Messages) != 0 {
			t.Errorf("polling from the cursor returned %d messages again", len(next.Messages))
		}
		if next.Cursor != batch.Cursor {
			t.Errorf("cursor moved from %d to %d on an empty poll", batch.Cursor, next.Cursor)
		}
		return
	}
	t.Fatal("the stream never received all ten messages")
}
