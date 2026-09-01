package mqtt

import (
	"context"
	"testing"
	"time"

	"github.com/eclipse/paho.golang/paho"
	mochi "github.com/mochi-mqtt/server/v2"
	"github.com/mochi-mqtt/server/v2/packets"
)

// arrival is one message as the broker saw it, which is the only side worth
// asserting on: a publish that the client thinks succeeded and the broker
// never stored is exactly the failure these tests exist to catch.
type arrival struct {
	Topic   string
	Payload string
	QoS     byte
	Retain  bool
}

// watchInline subscribes from inside the broker and returns a channel of what
// it saw. The buffer is generous because a test that fills it would block the
// broker's own delivery goroutine rather than fail.
func watchInline(t *testing.T, server *mochi.Server, filter string) <-chan arrival {
	t.Helper()

	arrivals := make(chan arrival, 64)
	err := server.Subscribe(filter, 1, func(_ *mochi.Client, _ packets.Subscription, pk packets.Packet) {
		select {
		case arrivals <- arrival{
			Topic:   pk.TopicName,
			Payload: string(pk.Payload),
			QoS:     pk.FixedHeader.Qos,
			Retain:  pk.FixedHeader.Retain,
		}:
		default:
		}
	})
	if err != nil {
		t.Fatalf("inline subscribe: %v", err)
	}
	return arrivals
}

func nextArrival(t *testing.T, arrivals <-chan arrival) arrival {
	t.Helper()

	select {
	case got := <-arrivals:
		return got
	case <-time.After(5 * time.Second):
		t.Fatal("no message reached the broker")
		return arrival{}
	}
}

// Every QoS has to reach the broker, at both protocol versions. QoS 0 is the
// one worth pinning: it is acknowledged by nothing, so the only proof it
// worked is the broker's own side.
func TestPublishReachesTheBrokerAtEveryQoS(t *testing.T) {
	for _, version := range []string{protocol5, protocol311} {
		for _, qos := range []byte{0, 1, 2} {
			t.Run(qosName(version, qos), func(t *testing.T) {
				server, address := fakeBrokerServer(t)
				arrivals := watchInline(t, server, "sensors/#")
				conn := openProfile(t, testProfile(address, version, nil))

				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()

				result, err := conn.Publish(ctx, PublishRequest{
					Topic:   "sensors/room-1/temperature",
					Payload: `{"c":21.5}`,
					QoS:     qos,
				})
				if err != nil {
					t.Fatalf("publish: %v", err)
				}
				if result.Sent != 1 {
					t.Errorf("sent = %d, want 1", result.Sent)
				}
				// The distinction the console has to show: at QoS 0 nothing
				// was acknowledged, so "sent" means written to a socket.
				if want := qos > 0; result.Acknowledged != want {
					t.Errorf("acknowledged = %v, want %v at qos %d", result.Acknowledged, want, qos)
				}

				got := nextArrival(t, arrivals)
				if got.Topic != "sensors/room-1/temperature" || got.Payload != `{"c":21.5}` {
					t.Errorf("broker received %+v", got)
				}
			})
		}
	}
}

func qosName(version string, qos byte) string {
	return "mqtt" + version + "/qos" + string('0'+qos)
}

// Retain is the only stored state MQTT has, and the reason a topic can be
// listed at all later. It has to survive the publish, not just be accepted.
func TestPublishSetsTheRetainFlag(t *testing.T) {
	for _, version := range []string{protocol5, protocol311} {
		t.Run("mqtt"+version, func(t *testing.T) {
			server, address := fakeBrokerServer(t)
			arrivals := watchInline(t, server, "devices/#")
			conn := openProfile(t, testProfile(address, version, nil))

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()

			if _, err := conn.Publish(ctx, PublishRequest{
				Topic:   "devices/a19f/status",
				Payload: "online",
				QoS:     1,
				Retain:  true,
			}); err != nil {
				t.Fatalf("publish: %v", err)
			}

			if got := nextArrival(t, arrivals); !got.Retain {
				t.Errorf("the retain flag did not reach the broker: %+v", got)
			}
		})
	}
}

// The console offers a repeat count so a board can be given something to look
// at. Reporting how many actually went is the point: a partial failure that
// says "sent" is worse than one that says nothing.
func TestPublishRepeatsAndCountsWhatWentOut(t *testing.T) {
	server, address := fakeBrokerServer(t)
	arrivals := watchInline(t, server, "bulk/#")
	conn := openProfile(t, testProfile(address, protocol5, nil))

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	result, err := conn.Publish(ctx, PublishRequest{
		Topic:   "bulk/messages",
		Payload: "x",
		QoS:     1,
		Count:   5,
	})
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	if result.Sent != 5 {
		t.Errorf("sent = %d, want 5", result.Sent)
	}
	for i := range 5 {
		if got := nextArrival(t, arrivals); got.Payload != "x" {
			t.Errorf("message %d was %+v", i, got)
		}
	}
}

/*
 * The two 5.0 reason codes that change what the console should say.
 *
 * This reads synthesised acknowledgements rather than provoking a broker,
 * because mochi-mqtt answers every accepted publish with 0: it defines
 * CodeNoMatchingSubscribers and never sends it. That is a gap in the fake, not
 * in MQTT, so the decode is pinned here and a real broker sending 16 is left
 * to the live suite.
 */
func TestPublishAnswerReadsTheReasonCode(t *testing.T) {
	tests := []struct {
		name          string
		response      *paho.PublishResponse
		wantErr       bool
		wantNoSubs    bool
		wantReason    string
		wantNilAnswer bool
	}{
		{
			// QoS 0 is acknowledged by nothing at all.
			name:          "no acknowledgement",
			response:      nil,
			wantNilAnswer: true,
		},
		{
			name:     "accepted",
			response: &paho.PublishResponse{ReasonCode: 0},
		},
		{
			// Success, and worth saying: the message was taken and there was
			// nobody to give it to.
			name:       "no matching subscribers",
			response:   &paho.PublishResponse{ReasonCode: reasonNoMatchingSubscribers},
			wantNoSubs: true,
		},
		{
			// A refusal arrives on the acknowledgement, not as a transport
			// error, so it has to be turned into one here or the send reports
			// success.
			name: "not authorized",
			response: &paho.PublishResponse{
				ReasonCode: 0x87,
				Properties: &paho.PublishResponseProperties{ReasonString: "not authorized"},
			},
			wantErr:    true,
			wantReason: "not authorized",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			answer, err := publishAnswerOf(test.response)

			if (err != nil) != test.wantErr {
				t.Fatalf("error = %v, want error %v", err, test.wantErr)
			}
			if test.wantNilAnswer {
				if answer != nil {
					t.Fatalf("answer = %+v, want none", answer)
				}
				return
			}
			if answer.NoMatchingSubscribers != test.wantNoSubs {
				t.Errorf("no matching subscribers = %v, want %v",
					answer.NoMatchingSubscribers, test.wantNoSubs)
			}
			if answer.Reason != test.wantReason {
				t.Errorf("reason = %q, want %q", answer.Reason, test.wantReason)
			}
		})
	}
}

// The 5.0 properties are refused rather than dropped on a 3.1.1 connection. A
// correlation id that vanished in transit is worse than one that was never
// accepted: the first is found by the person debugging the consumer.
func TestPublishRefusesFivePropertiesOn311(t *testing.T) {
	address := fakeBroker(t)
	conn := openProfile(t, testProfile(address, protocol311, nil))

	tests := []struct {
		name    string
		request PublishRequest
	}{
		{name: "content type", request: PublishRequest{ContentType: "application/json"}},
		{name: "response topic", request: PublishRequest{ResponseTopic: "replies/1"}},
		{name: "correlation data", request: PublishRequest{CorrelationData: "abc"}},
		{name: "message expiry", request: PublishRequest{MessageExpiry: 60}},
		{name: "user properties", request: PublishRequest{UserProperties: map[string]string{"a": "b"}}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()

			request := test.request
			request.Topic = "sensors/room-1/temperature"
			request.Payload = "1"
			if _, err := conn.Publish(ctx, request); err == nil {
				t.Error("a 3.1.1 connection accepted an MQTT 5.0 property")
			}
		})
	}
}

// The 5.0 properties have to actually cross on a 5.0 connection, or the test
// above would pass against a driver that refuses them everywhere.
func TestPublishCarriesFivePropertiesOn5(t *testing.T) {
	server, address := fakeBrokerServer(t)
	arrivals := watchInline(t, server, "rpc/#")
	conn := openProfile(t, testProfile(address, protocol5, nil))

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if _, err := conn.Publish(ctx, PublishRequest{
		Topic:           "rpc/request",
		Payload:         `{"op":"read"}`,
		QoS:             1,
		ContentType:     "application/json",
		ResponseTopic:   "rpc/reply",
		CorrelationData: "req-1",
		MessageExpiry:   60,
		UserProperties:  map[string]string{"tenant": "acme"},
	}); err != nil {
		t.Fatalf("publish: %v", err)
	}
	nextArrival(t, arrivals)
}

func TestPublishRefusesWhatTheProtocolCannotCarry(t *testing.T) {
	address := fakeBroker(t)
	conn := openProfile(t, testProfile(address, protocol5, nil))

	tests := []struct {
		name    string
		request PublishRequest
	}{
		{name: "no topic", request: PublishRequest{Payload: "x"}},
		// Wildcards belong in a filter. Some brokers answer a wildcard publish
		// by closing the connection rather than refusing it, which would read
		// as an unstable network.
		{name: "single-level wildcard", request: PublishRequest{Topic: "a/+/c", Payload: "x"}},
		{name: "multi-level wildcard", request: PublishRequest{Topic: "a/#", Payload: "x"}},
		{name: "qos above 2", request: PublishRequest{Topic: "a/b", Payload: "x", QoS: 3}},
		{name: "count past the cap", request: PublishRequest{Topic: "a/b", Payload: "x", Count: maxPublishCount + 1}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()

			if _, err := conn.Publish(ctx, test.request); err == nil {
				t.Error("publish accepted a request the protocol cannot carry")
			}
		})
	}
}

// SendMessage is the canonical publish every family answers. Three of its
// arguments are RocketMQ's vocabulary, and MQTT has no counterpart for any of
// them — so they are refused rather than dropped, which would report success
// for a message that arrived without them.
func TestSendMessageRefusesWhatMQTTHasNoConceptOf(t *testing.T) {
	address := fakeBroker(t)
	conn := openProfile(t, testProfile(address, protocol5, nil))

	tests := []struct {
		name       string
		tags       string
		keys       string
		delayLevel int
	}{
		{name: "tags", tags: "order"},
		{name: "keys", keys: "order-1"},
		{name: "delay level", delayLevel: 3},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()

			_, err := conn.SendMessage(ctx, "sensors/room-1", test.tags, test.keys, "body", test.delayLevel)
			if err == nil {
				t.Error("SendMessage accepted an argument MQTT has no concept of")
			}
		})
	}
}

func TestSendMessagePublishesTheBody(t *testing.T) {
	server, address := fakeBrokerServer(t)
	arrivals := watchInline(t, server, "sensors/#")
	conn := openProfile(t, testProfile(address, protocol5, nil))

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if _, err := conn.SendMessage(ctx, "sensors/room-1", "", "", "21.5", 0); err != nil {
		t.Fatalf("SendMessage: %v", err)
	}

	got := nextArrival(t, arrivals)
	if got.Topic != "sensors/room-1" || got.Payload != "21.5" {
		t.Errorf("broker received %+v", got)
	}
	// QoS 1 rather than 0, because the caller is a person watching for an
	// answer and at QoS 0 a wrong topic looks exactly like a working one.
	if got.QoS != 1 {
		t.Errorf("qos = %d, want 1", got.QoS)
	}
}
