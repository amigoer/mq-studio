package mqtt

import (
	"context"
	"errors"
	"testing"
	"time"

	mochi "github.com/mochi-mqtt/server/v2"

	"github.com/amigoer/mq-studio/internal/model"
)

// publishSys writes a value into the broker's own tree.
//
// The inline client bypasses the topic rules, which is the only way to put
// something under $SYS: it is the broker's to write, and that is the point of
// it. The values are Mosquitto's key names, checked against a live Mosquitto
// rather than against its documentation - mochi publishes a tree of its own
// with different names, and mapping those would be tuning the driver to the
// test fake instead of to a broker anyone runs.
func publishSys(t *testing.T, server *mochi.Server, values map[string]string) {
	t.Helper()

	for key, value := range values {
		if err := server.Publish(mosquittoPrefix+key, []byte(value), true, 0); err != nil {
			t.Fatalf("publish %s: %v", key, err)
		}
	}
}

func mosquittoTree() map[string]string {
	return map[string]string{
		sysVersion:          "mosquitto version 2.1.2",
		sysUptime:           "3600 seconds",
		sysClientsConnected: "12",
		sysClientsTotal:     "40",
		sysClientsMaximum:   "51",
		sysSubscriptions:    "128",
		sysRetained:         "55",
		sysMessagesReceived: "9000",
		sysMessagesSent:     "12000",
		sysMessagesDropped:  "3",
		sysBytesReceived:    "480000",
		sysBytesSent:        "512000",
		sysLoadIn1min:       "120.5",
		sysLoadOut1min:      "240.0",
	}
}

func TestClusterOverviewReadsTheBrokersOwnTree(t *testing.T) {
	server, address := fakeBrokerServer(t)
	publishSys(t, server, mosquittoTree())

	conn := openProfile(t, testProfile(address, protocol5, nil))

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	overview, err := conn.ClusterOverview(ctx)
	if err != nil {
		t.Fatalf("cluster overview: %v", err)
	}

	if overview.TotalNodes != 1 || overview.OnlineNodes != 1 {
		t.Errorf("nodes = %d of %d, want 1 of 1", overview.OnlineNodes, overview.TotalNodes)
	}
	if overview.Subscriptions != 128 {
		t.Errorf("subscriptions = %d, want 128", overview.Subscriptions)
	}
	// A topic is not an object in MQTT, so there is no count of them. Passing
	// the retained total off as one would be a different claim.
	if overview.Destinations != model.UnknownMetric {
		t.Errorf("destinations = %d, want the not-reported marker", overview.Destinations)
	}

	want := map[string]string{
		AttrClientsConnected: "12",
		AttrClientsTotal:     "40",
		AttrClientsMaximum:   "51",
		AttrRetainedCount:    "55",
		AttrMessagesReceived: "9000",
		AttrMessagesSent:     "12000",
		AttrMessagesDropped:  "3",
		AttrBytesReceived:    "480000",
		AttrBytesSent:        "512000",
		// Mosquitto publishes uptime as "3600 seconds", not as a number.
		AttrUptimeSeconds: "3600",
		AttrBrokerVersion: "mosquitto version 2.1.2",
	}
	for key, value := range want {
		if got := overview.Attributes[key]; got != value {
			t.Errorf("%s = %q, want %q", key, got, value)
		}
	}

	// The whole tree is carried alongside the figures, so a broker publishing
	// counters this driver does not know by name still has them on screen.
	if overview.Attributes[AttrSysTopics] == "" {
		t.Error("the raw $SYS tree is missing")
	}
}

// A counter the broker does not publish has to be absent, not zero and not -1.
// "This broker does not report dropped messages" and "no messages were
// dropped" are different claims, and only one of them is a reason to relax.
func TestSysCountersAreAbsentRatherThanZeroWhenNotPublished(t *testing.T) {
	server, address := fakeBrokerServer(t)
	publishSys(t, server, map[string]string{sysClientsConnected: "12"})

	conn := openProfile(t, testProfile(address, protocol5, nil))

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	overview, err := conn.ClusterOverview(ctx)
	if err != nil {
		t.Fatalf("cluster overview: %v", err)
	}
	if _, published := overview.Attributes[AttrHeapCurrent]; published {
		t.Errorf("a counter nothing published was reported as %q",
			overview.Attributes[AttrHeapCurrent])
	}
	if _, published := overview.Attributes[AttrSharedSubscriptions]; published {
		t.Error("shared subscriptions were reported by a broker that does not publish them")
	}
}

func TestListNodesIsTheOneBrokerTheSessionIsOn(t *testing.T) {
	server, address := fakeBrokerServer(t)
	publishSys(t, server, mosquittoTree())

	conn := openProfile(t, testProfile(address, protocol5, nil))

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	nodes, err := conn.ListNodes(ctx)
	if err != nil {
		t.Fatalf("list nodes: %v", err)
	}
	if len(nodes) != 1 {
		t.Fatalf("%d nodes, want 1: MQTT says nothing about how a broker is deployed", len(nodes))
	}

	node := nodes[0]
	if node.Address != address {
		t.Errorf("address = %q, want %q", node.Address, address)
	}
	if node.Version != "mosquitto version 2.1.2" {
		t.Errorf("version = %q", node.Version)
	}
	if node.Status != model.NodeOnline {
		t.Errorf("status = %q, want online", node.Status)
	}
	// The load average is per minute and the field is per second.
	if node.RateIn != 2 {
		t.Errorf("rate in = %d, want 2 (120.5 a minute)", node.RateIn)
	}
	// No MQTT broker publishes a disk figure.
	if node.DiskUsage != model.UnknownMetric {
		t.Errorf("disk usage = %d, want the not-reported marker", node.DiskUsage)
	}

	if _, err := conn.NodeDetail(ctx, "10.0.0.9:1883"); err == nil {
		t.Error("a node this connection has never seen reported a detail")
	}
}

// stubClient is an mqttClient that answers however a test needs, for the cases
// a broker cannot be talked into: refusing a subscription outright, or taking
// one and then publishing nothing.
type stubClient struct {
	subscribeErr error
}

func (s *stubClient) Connect(context.Context) error { return nil }
func (s *stubClient) Ping(context.Context) error    { return nil }
func (s *stubClient) Publish(context.Context, PublishRequest) (*publishAnswer, error) {
	return nil, nil
}
func (s *stubClient) Subscribe(context.Context, []subscribeFilter) error { return s.subscribeErr }
func (s *stubClient) Unsubscribe(context.Context, []string) error        { return nil }
func (s *stubClient) OnMessage(func(inboundMessage))                     {}
func (s *stubClient) OnConnectionUp(func() []subscribeFilter)            {}
func (s *stubClient) OnConnectionDown(func())                            {}
func (s *stubClient) Disconnect() error                                  { return nil }

/*
 * The two ways the $SYS tier goes missing, reported apart.
 *
 * EMQX's default authorisation refuses a remote client's subscription to $SYS
 * outright - the common case, not an unusual one - and the fix is in its
 * access rules. An embedded broker may take the subscription and publish
 * nothing, where there is nothing to configure and the tree simply does not
 * exist. One reason covering both would send half the people who read it to
 * the wrong place.
 */
func TestProbeDegradesTheClusterTierWhenSysIsMissing(t *testing.T) {
	tests := []struct {
		name       string
		client     *stubClient
		wantReason string
	}{
		{
			name:       "the broker refuses the subscription",
			client:     &stubClient{subscribeErr: errors.New("broker refused the subscription")},
			wantReason: sysRefused,
		},
		{
			name:       "the broker publishes no tree",
			client:     &stubClient{},
			wantReason: sysSilent,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			conn := newConn(test.client, clientConfig{DialTimeout: time.Second})
			conn.probe(context.Background())

			declared := conn.Capabilities()
			for _, capability := range []model.Capability{
				model.CapClusterTopology,
				model.CapClusterMetrics,
			} {
				reason, degraded := declared.DegradedReason(capability)
				if !degraded {
					t.Errorf("%s is not degraded on a broker with no $SYS", capability)
					continue
				}
				if reason != test.wantReason {
					t.Errorf("%s degraded with %q, want %q", capability, reason, test.wantReason)
				}
			}

			// The protocol tier is unaffected: a session that connected can
			// publish and subscribe whatever the broker says about itself.
			for _, capability := range []model.Capability{
				model.CapPublish,
				model.CapLiveStream,
				model.CapDestinationList,
			} {
				if !declared.Has(capability) {
					t.Errorf("%s was degraded along with the $SYS tier", capability)
				}
			}
		})
	}
}

// A broker that does publish a tree keeps the tier supported.
func TestProbeKeepsTheClusterTierWhenSysAnswers(t *testing.T) {
	server, address := fakeBrokerServer(t)
	publishSys(t, server, mosquittoTree())

	conn := openProfile(t, testProfile(address, protocol5, nil))
	declared := conn.Capabilities()

	for _, capability := range []model.Capability{
		model.CapClusterTopology,
		model.CapClusterMetrics,
	} {
		if !declared.Has(capability) {
			reason, _ := declared.DegradedReason(capability)
			t.Errorf("%s is degraded (%q) against a broker that publishes $SYS", capability, reason)
		}
	}
}

func TestUptimeReadsBothSpellings(t *testing.T) {
	tests := []struct {
		raw  string
		want int64
	}{
		// Mosquitto's wording.
		{raw: "3600 seconds", want: 3600},
		// A bare number, which other brokers publish.
		{raw: "3600", want: 3600},
		{raw: "", want: unknown},
		{raw: "a while", want: unknown},
	}

	for _, test := range tests {
		t.Run(test.raw, func(t *testing.T) {
			tree := &sysTree{Values: map[string]string{}}
			if test.raw != "" {
				tree.Values[mosquittoPrefix+sysUptime] = test.raw
			}
			if got := tree.uptimeSeconds(); got != test.want {
				t.Errorf("uptimeSeconds(%q) = %d, want %d", test.raw, got, test.want)
			}
		})
	}
}
