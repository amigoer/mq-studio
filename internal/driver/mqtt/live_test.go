package mqtt

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/e2e"
	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * The live suites, against two brokers that between them cover both optional
 * tiers - and neither of which covers both alone.
 *
 * Mosquitto publishes a full $SYS tree and has no management API at all, so it
 * is the only place the $SYS reader can be checked against real counters and
 * the only place the absent-management path is real rather than simulated.
 *
 * EMQX is the mirror image: its default authorisation refuses a remote
 * client's $SYS subscription, and its REST API answers everything the protocol
 * cannot. It is where the management tier is checked, and where the tiers
 * covering for each other is checked - a broker with no readable $SYS whose
 * cluster pages work anyway.
 *
 * What the in-process broker cannot do is the reason these exist. mochi-mqtt
 * never sends reason code 16, has no management API to probe, and publishes a
 * $SYS tree of its own invention. Every one of those is asserted here instead.
 */

const (
	liveMosquitto   = "127.0.0.1:1883"
	liveMosquittoWS = "127.0.0.1:9001"
	liveEMQX        = "127.0.0.1:1884"
	liveEMQXAPI     = "http://127.0.0.1:18083"
	liveEMQXKey     = "mqstudio-e2e"
	liveEMQXSecret  = "mqstudio-e2e-secret-key"
)

func requireMosquitto(t *testing.T) {
	t.Helper()
	e2e.Require(t, e2e.Env{
		Name:  "mosquitto",
		Start: "npm run e2e:mqtt:up",
		Probe: e2e.DialTCP(liveMosquitto),
	})
}

func requireEMQX(t *testing.T) {
	t.Helper()
	e2e.Require(t, e2e.Env{
		Name:  "emqx",
		Start: "npm run e2e:mqtt:emqx:up",
		Probe: e2e.HTTPGet(liveEMQXAPI + "/api/v5/status"),
	})
}

// liveProfile points at one of the two brokers, with the options a test wants.
func liveProfile(address, version string, options map[string]string) model.ConnectionProfile {
	profile := model.ConnectionProfile{
		Name:       "live",
		Kind:       model.KindMQTT,
		Endpoints:  address,
		TimeoutSec: 10,
		Options:    map[string]string{OptionProtocolVersion: version},
	}
	for key, value := range options {
		profile.Options[key] = value
	}
	return profile
}

// managedLiveProfile adds the EMQX management endpoint and its API key.
func managedLiveProfile(version string) model.ConnectionProfile {
	profile := liveProfile(liveEMQX, version, map[string]string{
		OptionManagementURL: liveEMQXAPI,
	})
	profile.Secrets = map[string]string{
		SecretManagementKey:  liveEMQXKey,
		SecretManagementSalt: liveEMQXSecret,
	}
	return profile
}

func liveConn(t *testing.T, profile model.ConnectionProfile) *Conn {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	opened, err := New().Open(ctx, profile)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	conn, ok := opened.(*Conn)
	if !ok {
		t.Fatalf("open returned %T, want *Conn", opened)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

// liveTopic keeps one test's traffic out of another's. The suites run in
// parallel with the other families' against brokers that are shared.
func liveTopic(t *testing.T, suffix string) string {
	t.Helper()
	return fmt.Sprintf("mqs-test/%s/%s", strings.ReplaceAll(t.Name(), "/", "-"), suffix)
}

// A publish and a subscription over a real broker, at both protocol versions
// and every QoS. The in-process broker covers the same ground; this covers it
// against a broker that was not written to make these tests pass.
func TestLivePublishReachesASubscription(t *testing.T) {
	requireMosquitto(t)

	for _, version := range []string{protocol5, protocol311} {
		for _, qos := range []byte{0, 1, 2} {
			t.Run(fmt.Sprintf("mqtt%s/qos%d", version, qos), func(t *testing.T) {
				conn := liveConn(t, liveProfile(liveMosquitto, version, nil))
				topic := liveTopic(t, "telemetry")

				ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
				defer cancel()

				subscription, err := conn.StartLiveSubscription(ctx, model.LiveSubscriptionSpec{
					Filters: []model.LiveFilter{{
						Pattern: topic,
						Options: map[string]string{AttrQoS: "1"},
					}},
				})
				if err != nil {
					t.Fatalf("start live subscription: %v", err)
				}
				t.Cleanup(func() {
					stopCtx, stopCancel := context.WithTimeout(context.Background(), 10*time.Second)
					defer stopCancel()
					_ = conn.StopLiveSubscription(stopCtx, subscription.ID)
				})

				// A second connection, so this asserts delivery between two
				// clients rather than a broker handing a message back to the
				// one that sent it. The same-connection case is covered at the
				// app layer, where it is the send console and the workbench.
				publisher := liveConn(t, liveProfile(liveMosquitto, version, nil))
				if _, err := publisher.Publish(ctx, PublishRequest{
					Topic:   topic,
					Payload: `{"c":21.5}`,
					QoS:     qos,
				}); err != nil {
					t.Fatalf("publish: %v", err)
				}

				batch := awaitBatch(t, conn, subscription.ID, 1)
				if got := batch.Messages[0]; got.Destination != topic || got.Body != `{"c":21.5}` {
					t.Errorf("received %+v", got)
				}
			})
		}
	}
}

/*
 * WebSocket, with a round trip rather than only a dial.
 *
 * The dial was never the problem. autopaho's own WebSocket adapter writes one
 * frame per Write and paho writes a packet through net.Buffers, so a PUBLISH
 * left as three frames: the connection came up, QoS 0 went out, and every
 * acknowledged round trip timed out while the broker logged "malformed
 * packet" and dropped the session behind it.
 *
 * So this publishes at QoS 1 and reads the message back. A test that only
 * connected passed against the broken adapter.
 */
func TestLiveWebSocketTransportConnects(t *testing.T) {
	e2e.Require(t, e2e.Env{
		Name:  "mosquitto over websocket",
		Start: "npm run e2e:mqtt:up",
		Probe: e2e.DialTCP(liveMosquittoWS),
	})

	for _, version := range []string{protocol5, protocol311} {
		t.Run("mqtt"+version, func(t *testing.T) {
			conn := liveConn(t, liveProfile(liveMosquittoWS, version, map[string]string{
				OptionTransport: transportWS,
				// Mosquitto serves MQTT at the root of its WebSocket
				// listener; the field defaults to EMQX's /mqtt.
				OptionWebSocketPath: "/",
			}))

			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()

			// Ping is itself an acknowledged round trip - an unsubscribe - so
			// this alone would have caught it.
			if err := conn.Ping(ctx); err != nil {
				t.Fatalf("ping: %v", err)
			}

			topic := liveTopic(t, "ws")
			subscription, err := conn.StartLiveSubscription(ctx, model.LiveSubscriptionSpec{
				Filters: []model.LiveFilter{{
					Pattern: topic,
					Options: map[string]string{AttrQoS: "1"},
				}},
			})
			if err != nil {
				t.Fatalf("start live subscription: %v", err)
			}
			t.Cleanup(func() {
				stopCtx, stopCancel := context.WithTimeout(context.Background(), 10*time.Second)
				defer stopCancel()
				_ = conn.StopLiveSubscription(stopCtx, subscription.ID)
			})

			publisher := liveConn(t, liveProfile(liveMosquittoWS, version, map[string]string{
				OptionTransport:     transportWS,
				OptionWebSocketPath: "/",
			}))
			// QoS 1: the acknowledged path, which is the one that broke. A
			// payload long enough to be split across buffers by paho's writer,
			// because a short one fits in a single buffer and goes through
			// even when the packet is fragmented.
			payload := strings.Repeat("telemetry ", 64)
			if _, err := publisher.Publish(ctx, PublishRequest{
				Topic:   topic,
				Payload: payload,
				QoS:     1,
			}); err != nil {
				t.Fatalf("publish over websocket: %v", err)
			}

			batch := awaitBatch(t, conn, subscription.ID, 1)
			if batch.Messages[0].Body != payload {
				t.Errorf("the payload did not survive the websocket transport")
			}
		})
	}
}

// A retained publish is the only state MQTT stores, and the listing is built
// entirely from it. Both halves are checked in one pass because neither means
// anything without the other.
func TestLiveRetainedPublishBecomesAListedTopic(t *testing.T) {
	requireMosquitto(t)

	conn := liveConn(t, liveProfile(liveMosquitto, protocol5, nil))
	topic := liveTopic(t, "status")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if _, err := conn.Publish(ctx, PublishRequest{
		Topic:   topic,
		Payload: "online",
		QoS:     1,
		Retain:  true,
	}); err != nil {
		t.Fatalf("publish: %v", err)
	}
	// Clearing it again is not tidiness: a retained message outlives the test,
	// and the broker is shared with every other run.
	t.Cleanup(func() {
		clearCtx, clearCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer clearCancel()
		_, _ = conn.Publish(clearCtx, PublishRequest{Topic: topic, QoS: 1, Retain: true})
	})

	topics, err := conn.ListDestinations(ctx, model.DestinationFilter{})
	if err != nil {
		t.Fatalf("list destinations: %v", err)
	}

	var found *model.Destination
	for _, destination := range topics {
		if destination.Ref.Name == topic {
			found = destination
			break
		}
	}
	if found == nil {
		t.Fatalf("the retained topic is not in the listing of %d topics", len(topics))
	}
	if found.Attributes[AttrSource] != sourceRetained {
		t.Errorf("source = %q, want %q", found.Attributes[AttrSource], sourceRetained)
	}
	// Every count MQTT has no concept of.
	if found.Depth != model.UnknownMetric || found.Subscribers != model.UnknownMetric {
		t.Errorf("a count the protocol cannot produce was reported: %+v", found)
	}

	detail, err := conn.DestinationDetail(ctx, model.DestinationRef{Name: topic})
	if err != nil {
		t.Fatalf("destination detail: %v", err)
	}
	if detail.Ref.Name != topic {
		t.Errorf("detail is for %q", detail.Ref.Name)
	}
}

/*
 * The $SYS tree, against the broker whose key names this driver reads.
 *
 * The names came off a running Mosquitto rather than its documentation, and
 * two of them are the reason this test exists: "retained messages/count" has a
 * space in it, and uptime is published as "3600 seconds" rather than a number.
 * The in-process broker publishes neither, so nothing else would catch a
 * rename.
 */
func TestLiveSysTreeIsReadFromMosquitto(t *testing.T) {
	requireMosquitto(t)

	conn := liveConn(t, liveProfile(liveMosquitto, protocol5, nil))

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	overview, err := conn.ClusterOverview(ctx)
	if err != nil {
		t.Fatalf("cluster overview: %v", err)
	}

	if !strings.Contains(overview.Attributes[AttrBrokerVersion], "mosquitto") {
		t.Errorf("version = %q, want mosquitto's own string",
			overview.Attributes[AttrBrokerVersion])
	}
	for _, attribute := range []string{
		AttrUptimeSeconds,
		AttrClientsConnected,
		AttrRetainedCount,
		AttrMessagesReceived,
		AttrBytesReceived,
	} {
		if overview.Attributes[attribute] == "" {
			t.Errorf("%s is missing; the $SYS key it reads may have been renamed", attribute)
		}
	}
	// The whole tree is carried for the board's own table.
	if !strings.Contains(overview.Attributes[AttrSysTopics], "$SYS/broker/") {
		t.Error("the raw $SYS tree did not survive")
	}

	// A topic count is the one figure this tier cannot produce.
	if overview.Destinations != model.UnknownMetric {
		t.Errorf("destinations = %d, but MQTT cannot enumerate topics", overview.Destinations)
	}

	nodes, err := conn.ListNodes(ctx)
	if err != nil {
		t.Fatalf("list nodes: %v", err)
	}
	if len(nodes) != 1 {
		t.Fatalf("%d nodes; a session is one socket", len(nodes))
	}
}

/*
 * Mosquitto has no management API, which is not a failure and has to be
 * reported as such: the pages that need one are degraded with a reason, and
 * everything the protocol itself answers is left alone.
 */
func TestLiveMosquittoDegradesTheManagementTier(t *testing.T) {
	requireMosquitto(t)

	conn := liveConn(t, liveProfile(liveMosquitto, protocol5, nil))
	declared := conn.Capabilities()

	for _, capability := range []model.Capability{
		model.CapClientInspect,
		model.CapClientClose,
	} {
		reason, degraded := declared.DegradedReason(capability)
		if !degraded {
			t.Errorf("%s is not degraded against a broker with no management api", capability)
			continue
		}
		if reason != managementAbsent {
			t.Errorf("%s degraded with %q, want %q", capability, reason, managementAbsent)
		}
	}

	for _, capability := range []model.Capability{
		model.CapPublish,
		model.CapLiveStream,
		model.CapDestinationList,
		model.CapClusterTopology,
		model.CapClusterMetrics,
	} {
		if !declared.Has(capability) {
			reason, _ := declared.DegradedReason(capability)
			t.Errorf("%s is degraded (%q) on a broker that answers it", capability, reason)
		}
	}
}

/*
 * The case the whole tier design exists for.
 *
 * EMQX's default authorisation refuses a remote client's $SYS subscription, so
 * the tier that answers the cluster pages on Mosquitto is unavailable here -
 * and the pages work anyway, because the management API answers them better.
 * A driver that degraded them would take two working pages off a broker that
 * can serve them.
 */
func TestLiveEMQXKeepsTheClusterTierWithoutSys(t *testing.T) {
	requireEMQX(t)

	conn := liveConn(t, managedLiveProfile(protocol5))
	declared := conn.Capabilities()

	for _, capability := range []model.Capability{
		model.CapClusterTopology,
		model.CapClusterMetrics,
		model.CapClientInspect,
		model.CapClientClose,
	} {
		if !declared.Has(capability) {
			reason, _ := declared.DegradedReason(capability)
			t.Errorf("%s is degraded (%q) on a broker whose management api answers", capability, reason)
		}
	}
}

// The management tier against the API it was written for. The fixtures in the
// unit tests are this broker's own answers; this is what catches them going
// stale.
func TestLiveEMQXManagementPlane(t *testing.T) {
	requireEMQX(t)

	conn := liveConn(t, managedLiveProfile(protocol5))

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	nodes, err := conn.ListNodes(ctx)
	if err != nil {
		t.Fatalf("list nodes: %v", err)
	}
	if len(nodes) == 0 {
		t.Fatal("the management api named no nodes")
	}
	node := nodes[0]
	if node.Version == "" || node.Status != model.NodeOnline {
		t.Errorf("node = %+v", node)
	}
	if node.Attributes[AttrNodeRole] == "" {
		t.Error("the node role is missing; it is what tells this tier apart from $SYS")
	}
	// EMQX reports running totals rather than rates, and deriving one here
	// would be this app's arithmetic shown as the broker's figure.
	if node.RateIn != model.UnknownMetric {
		t.Errorf("rate in = %d, want the not-reported marker", node.RateIn)
	}

	overview, err := conn.ClusterOverview(ctx)
	if err != nil {
		t.Fatalf("cluster overview: %v", err)
	}
	// The one figure the management tier can give that no amount of
	// subscribing would produce.
	if overview.Destinations == model.UnknownMetric {
		t.Error("the management api did not report a topic count")
	}

	// This connection is itself a client, so the list can never be empty.
	clients, err := conn.ListClientConnections(ctx, "")
	if err != nil {
		t.Fatalf("list client connections: %v", err)
	}
	var self *model.ClientConnection
	for _, client := range clients {
		if strings.HasPrefix(client.Name, clientName) {
			self = client
			break
		}
	}
	if self == nil {
		t.Fatalf("this connection is not in the broker's own client list of %d", len(clients))
	}
	if self.Protocol != "MQTT 5.0" {
		t.Errorf("protocol = %q, want MQTT 5.0", self.Protocol)
	}
	if self.Attributes[AttrListener] == "" {
		t.Error("the listener is missing from the client's attributes")
	}

	// A channel is AMQP's layer and MQTT has none.
	channels, err := conn.ListClientChannels(ctx, "")
	if err != nil {
		t.Fatalf("list client channels: %v", err)
	}
	if len(channels) != 0 {
		t.Errorf("%d channels, but MQTT has no such layer", len(channels))
	}
}

// A subscription this connection holds has to appear in the broker's own list,
// which is the only way to see one at all: MQTT cannot enumerate subscriptions.
func TestLiveEMQXListsThisConnectionsSubscription(t *testing.T) {
	requireEMQX(t)

	conn := liveConn(t, managedLiveProfile(protocol5))
	topic := liveTopic(t, "watched")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	subscription, err := conn.StartLiveSubscription(ctx, model.LiveSubscriptionSpec{
		Filters: []model.LiveFilter{{Pattern: topic}},
	})
	if err != nil {
		t.Fatalf("start live subscription: %v", err)
	}
	t.Cleanup(func() {
		stopCtx, stopCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer stopCancel()
		_ = conn.StopLiveSubscription(stopCtx, subscription.ID)
	})

	deadline := time.Now().Add(15 * time.Second)
	for {
		subscriptions, err := conn.Subscriptions(ctx)
		if err != nil {
			t.Fatalf("subscriptions: %v", err)
		}
		for _, held := range subscriptions {
			if held.Topic == topic {
				return
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("the broker never listed a subscription to %q", topic)
		}
		time.Sleep(200 * time.Millisecond)
	}
}

/*
 * Reason code 16, from a broker that actually sends it.
 *
 * The in-process broker defines the code and never uses it, so the decode is
 * unit-tested against a synthesised acknowledgement and this is the only place
 * the real thing is seen. It matters because it is a success the console
 * should still report: the broker took the message and had nobody to give it
 * to.
 */
func TestLiveNoMatchingSubscribersIsReported(t *testing.T) {
	requireMosquitto(t)

	conn := liveConn(t, liveProfile(liveMosquitto, protocol5, nil))

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	result, err := conn.Publish(ctx, PublishRequest{
		Topic:   liveTopic(t, "nobody"),
		Payload: "hello",
		QoS:     1,
	})
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	if !result.NoMatchingSubscribers {
		t.Errorf("nothing was subscribed and the broker did not say so: %+v", result)
	}
	if !result.Acknowledged {
		t.Error("a QoS 1 publish reported no acknowledgement")
	}
}

// awaitBatch polls until want messages have arrived.
func awaitBatch(t *testing.T, conn *Conn, id string, want int) *model.LiveBatch {
	t.Helper()

	collected := &model.LiveBatch{}
	cursor := int64(0)
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		batch, err := conn.PollLiveSubscription(context.Background(), id, cursor, 0)
		if err != nil {
			t.Fatalf("poll: %v", err)
		}
		collected.Messages = append(collected.Messages, batch.Messages...)
		cursor = batch.Cursor
		if len(collected.Messages) >= want {
			return collected
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("only %d of %d messages arrived", len(collected.Messages), want)
	return nil
}

/*
 * Topics on a broker that will not let anything subscribe to "#".
 *
 * EMQX's default authorisation denies a subscription to exactly that, so the
 * protocol-level discovery every other broker uses is refused outright and the
 * page failed rather than coming back short. The management API answers it
 * instead, which is the tiering doing its job - and it also has to exclude the
 * broker's own $SYS tree, because the protocol-level path excludes it by the
 * specification's wildcard rule and the same page must not mean two different
 * things depending on who answered.
 */
func TestLiveEMQXListsTopicsThroughTheManagementApi(t *testing.T) {
	requireEMQX(t)

	conn := liveConn(t, managedLiveProfile(protocol5))
	topic := liveTopic(t, "retained")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if _, err := conn.Publish(ctx, PublishRequest{
		Topic:   topic,
		Payload: "online",
		QoS:     1,
		Retain:  true,
	}); err != nil {
		t.Fatalf("publish: %v", err)
	}
	t.Cleanup(func() {
		clearCtx, clearCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer clearCancel()
		_, _ = conn.Publish(clearCtx, PublishRequest{Topic: topic, QoS: 1, Retain: true})
	})

	deadline := time.Now().Add(15 * time.Second)
	for {
		topics, err := conn.ListDestinations(ctx, model.DestinationFilter{})
		if err != nil {
			t.Fatalf("list destinations: %v", err)
		}

		var found bool
		for _, destination := range topics {
			if strings.HasPrefix(destination.Ref.Name, "$SYS/") {
				t.Fatalf("the broker's own $SYS tree reached the topic list: %s",
					destination.Ref.Name)
			}
			if destination.Ref.Name == topic {
				found = true
				if destination.Attributes[AttrSource] != sourceManagedList {
					t.Errorf("source = %q, want %q",
						destination.Attributes[AttrSource], sourceManagedList)
				}
			}
		}
		if found {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("the retained topic never appeared in the listing of %d", len(topics))
		}
		time.Sleep(300 * time.Millisecond)
	}
}

/*
 * A refusal a person can act on.
 *
 * EMQX's default authorisation denies a subscription to exactly "#", which is
 * the filter the workbench opens with - so the first thing anyone tries on the
 * commonest managed broker fails. The libraries pass the broker's own answer
 * through and it is empty: "failed to subscribe to topic:" with nothing after
 * the colon is what reached the screen.
 */
func TestLiveEMQXRefusesSubscribingToEverythingReadably(t *testing.T) {
	requireEMQX(t)

	conn := liveConn(t, managedLiveProfile(protocol5))

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	_, err := conn.StartLiveSubscription(ctx, model.LiveSubscriptionSpec{
		Filters: []model.LiveFilter{{Pattern: "#"}},
	})
	if err == nil {
		t.Fatal("EMQX accepted a subscription to #; its default authorisation denies one")
	}
	for _, want := range []string{"refused", `"#"`, "narrower filter"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("the refusal does not mention %q: %v", want, err)
		}
	}

	// And a narrower filter is accepted, so the advice the message gives is
	// advice that works.
	narrow := liveTopic(t, "narrow") + "/#"
	subscription, err := conn.StartLiveSubscription(ctx, model.LiveSubscriptionSpec{
		Filters: []model.LiveFilter{{Pattern: narrow}},
	})
	if err != nil {
		t.Fatalf("EMQX refused %q as well, so the message sends people nowhere: %v", narrow, err)
	}
	stopCtx, stopCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer stopCancel()
	_ = conn.StopLiveSubscription(stopCtx, subscription.ID)
}
