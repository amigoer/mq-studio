package mqtt

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/model"
)

// The bodies below are what a live EMQX 6 answered, trimmed to the fields this
// driver reads. Written down rather than paraphrased: `username` is null for
// an anonymous client and not absent, `proto_ver` is the wire number, and the
// stats keys carry dots that are part of the key rather than nesting - all
// three would silently decode to a zero value if guessed wrong.
const (
	emqxNodesBody = `[{"node":"emqx@127.0.0.1","version":"6.2.3","otp_release":"28.4.1-4/16.3",
		"load1":7.14,"load5":5.62,"load15":4.87,"uptime":22828,"role":"core",
		"memory_used":"7.07G","memory_total":"11.74G","node_status":"running",
		"connections":2,"max_fds":20480,"edition":"Enterprise","cluster_sessions":3,
		"live_connections":2}]`

	emqxStatsBody = `[{"node":"emqx@127.0.0.1","subscriptions.count":7,"subscriptions.shared.count":1,
		"connections.count":2,"connections.max":9,"sessions.count":3,"topics.count":5,
		"routes.count":5,"retained.count":4,"delayed.count":0}]`

	emqxMetricsBody = `[{"node":"emqx@127.0.0.1","bytes.received":175,"bytes.sent":86,
		"messages.received":11,"messages.sent":12,"messages.dropped":1,
		"packets.received":15,"packets.sent":12}]`

	emqxClientsBody = `{"data":[{"clientid":"probe-client","username":null,"node":"emqx@127.0.0.1",
		"ip_address":"192.168.166.1","port":50240,"connected":true,"proto_ver":4,"proto_name":"MQTT",
		"connected_at":"2026-09-01T19:34:27.680+00:00","disconnected_at":null,"keepalive":60,
		"clean_start":true,"expiry_interval":0,"subscriptions_cnt":1,"inflight_cnt":0,
		"mqueue_len":0,"mqueue_dropped":0,"recv_oct":9,"send_oct":11,"listener":"tcp:default",
		"is_persistent":false,"durable":false}],"meta":{"count":1,"limit":500,"page":1,"hasnext":false}}`

	emqxSubscriptionsBody = `[{"clientid":"probe-client","node":"emqx@127.0.0.1","topic":"sensors/#",
		"qos":1,"nl":1,"rap":0,"rh":0,"durable":false}]`
)

// fakeEMQX answers the management API, and records what was asked for.
func fakeEMQX(t *testing.T, routes map[string]string) (*httptest.Server, *[]string) {
	t.Helper()

	var seen []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Method+" "+r.URL.Path)

		// Every call has to carry the API key, or a broker with authorisation
		// on would answer this app with 401 in production and nothing here.
		if user, password, ok := r.BasicAuth(); !ok || user != "key" || password != "secret" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		body, known := routes[r.Method+" "+r.URL.Path]
		if !known {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	return server, &seen
}

func emqxRoutes() map[string]string {
	return map[string]string{
		"GET /api/v5/nodes":                              emqxNodesBody,
		"GET /api/v5/stats":                              emqxStatsBody,
		"GET /api/v5/metrics":                            emqxMetricsBody,
		"GET /api/v5/clients":                            emqxClientsBody,
		"GET /api/v5/subscriptions":                      emqxSubscriptionsBody,
		"GET /api/v5/clients/probe-client/subscriptions": emqxSubscriptionsBody,
		"DELETE /api/v5/clients/probe-client":            "",
	}
}

// managedProfile points a connection at both a broker and a management API.
func managedProfile(address, management string) model.ConnectionProfile {
	profile := testProfile(address, protocol5, map[string]string{
		OptionManagementURL: management,
	})
	profile.Secrets = map[string]string{
		SecretManagementKey:  "key",
		SecretManagementSalt: "secret",
	}
	return profile
}

func TestClientsAreReadFromTheManagementApi(t *testing.T) {
	api, _ := fakeEMQX(t, emqxRoutes())
	address := fakeBroker(t)
	conn := openProfile(t, managedProfile(address, api.URL))

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	clients, err := conn.ListClientConnections(ctx, "")
	if err != nil {
		t.Fatalf("list client connections: %v", err)
	}
	if len(clients) != 1 {
		t.Fatalf("%d clients, want 1", len(clients))
	}

	client := clients[0]
	// The client id is both name and client name because in MQTT they are one
	// thing: what the application called itself and what a kick names.
	if client.Name != "probe-client" || client.ClientName != "probe-client" {
		t.Errorf("name = %q / %q, want probe-client twice", client.Name, client.ClientName)
	}
	// An anonymous client sends no username. EMQX answers null, which must not
	// decode into a user called "null".
	if client.User != "" {
		t.Errorf("user = %q, want empty for an anonymous client", client.User)
	}
	if client.PeerHost != "192.168.166.1" || client.PeerPort != 50240 {
		t.Errorf("peer = %s:%d", client.PeerHost, client.PeerPort)
	}
	// proto_ver is the wire number, not a version string.
	if client.Protocol != "MQTT 3.1.1" {
		t.Errorf("protocol = %q, want MQTT 3.1.1 for proto_ver 4", client.Protocol)
	}
	if client.State != "connected" {
		t.Errorf("state = %q", client.State)
	}
	if client.HeartbeatSec != 60 {
		t.Errorf("keepalive = %d, want 60", client.HeartbeatSec)
	}
	if client.ConnectedAtMs == 0 {
		t.Error("connected_at did not parse")
	}
	// MQTT has no multiplexed sessions inside a connection.
	if client.Channels != 0 {
		t.Errorf("channels = %d, want 0", client.Channels)
	}
	if got := client.Attributes[AttrSubscriptionsCnt]; got != "1" {
		t.Errorf("subscriptions = %q, want 1", got)
	}
	if got := client.Attributes[AttrCleanStart]; got != "true" {
		t.Errorf("clean start = %q, want true", got)
	}

	// A channel list has to be empty rather than made up of subscriptions.
	channels, err := conn.ListClientChannels(ctx, "")
	if err != nil {
		t.Fatalf("list client channels: %v", err)
	}
	if len(channels) != 0 {
		t.Errorf("%d channels, but MQTT has no such layer", len(channels))
	}
}

func TestClientSubscriptionsAreReadFromTheManagementApi(t *testing.T) {
	api, _ := fakeEMQX(t, emqxRoutes())
	address := fakeBroker(t)
	conn := openProfile(t, managedProfile(address, api.URL))

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	subscriptions, err := conn.ClientSubscriptions(ctx, "probe-client")
	if err != nil {
		t.Fatalf("client subscriptions: %v", err)
	}
	if len(subscriptions) != 1 {
		t.Fatalf("%d subscriptions, want 1", len(subscriptions))
	}

	subscription := subscriptions[0]
	if subscription.Topic != "sensors/#" || subscription.QoS != 1 {
		t.Errorf("subscription = %+v", subscription)
	}
	// The 5.0 options arrive as 0 and 1 rather than as booleans.
	if !subscription.NoLocal || subscription.RetainAsPublished {
		t.Errorf("subscription options did not decode: %+v", subscription)
	}
}

func TestKickingAClientCallsTheManagementApi(t *testing.T) {
	api, seen := fakeEMQX(t, emqxRoutes())
	address := fakeBroker(t)
	conn := openProfile(t, managedProfile(address, api.URL))

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := conn.CloseClientConnection(ctx, "probe-client", "because"); err != nil {
		t.Fatalf("close client connection: %v", err)
	}
	if !contains(*seen, "DELETE /api/v5/clients/probe-client") {
		t.Errorf("the client was not kicked; calls were %v", *seen)
	}
	if err := conn.CloseClientConnection(ctx, "", ""); err == nil {
		t.Error("kicking a client with no id reported success")
	}
}

func TestClusterPagesPreferTheManagementApi(t *testing.T) {
	api, _ := fakeEMQX(t, emqxRoutes())
	address := fakeBroker(t)
	conn := openProfile(t, managedProfile(address, api.URL))

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	overview, err := conn.ClusterOverview(ctx)
	if err != nil {
		t.Fatalf("cluster overview: %v", err)
	}
	// The one figure the management tier gives that no amount of subscribing
	// would produce: MQTT cannot enumerate topics and EMQX counts them.
	if overview.Destinations != 5 {
		t.Errorf("destinations = %d, want 5", overview.Destinations)
	}
	if overview.Subscriptions != 7 {
		t.Errorf("subscriptions = %d, want 7", overview.Subscriptions)
	}
	if overview.TotalNodes != 1 || overview.OnlineNodes != 1 {
		t.Errorf("nodes = %d of %d", overview.OnlineNodes, overview.TotalNodes)
	}
	if got := overview.Attributes[AttrRetainedCount]; got != "4" {
		t.Errorf("retained = %q, want 4", got)
	}
	if got := overview.Attributes[AttrMessagesDropped]; got != "1" {
		t.Errorf("dropped = %q, want 1", got)
	}

	nodes, err := conn.ListNodes(ctx)
	if err != nil {
		t.Fatalf("list nodes: %v", err)
	}
	if len(nodes) != 1 || nodes[0].Name != "emqx@127.0.0.1" {
		t.Fatalf("nodes = %+v", nodes)
	}
	if nodes[0].Version != "6.2.3" || nodes[0].Status != model.NodeOnline {
		t.Errorf("node = %+v", nodes[0])
	}
	// EMQX counts uptime in milliseconds and the boards read seconds.
	if got := nodes[0].Attributes[AttrUptimeSeconds]; got != "22" {
		t.Errorf("uptime = %q seconds, want 22 from 22828ms", got)
	}
	// EMQX reports running totals, not rates. Deriving one here would be this
	// app's arithmetic shown as the broker's figure.
	if nodes[0].RateIn != model.UnknownMetric {
		t.Errorf("rate in = %d, want the not-reported marker", nodes[0].RateIn)
	}
}

/*
 * The four ways the management tier goes missing, reported apart.
 *
 * They are fixed in four different places - nowhere at all for a broker that
 * has no such API, on the broker for one that is down, on this form for a
 * rejected key, and in the address box for something that answered and was not
 * this API - so one reason covering them would send most readers wrong.
 */
func TestProbeNamesWhyTheManagementTierIsMissing(t *testing.T) {
	unauthorised := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	t.Cleanup(unauthorised.Close)

	notAnAPI := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(notAnAPI.Close)

	// An address with nothing on it, taken and given back.
	vacant := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	vacantURL := vacant.URL
	vacant.Close()

	tests := []struct {
		name       string
		management string
		secrets    map[string]string
		wantReason string
	}{
		{
			name:       "no endpoint on the profile",
			wantReason: managementAbsent,
		},
		{
			name:       "nothing listening",
			management: vacantURL,
			wantReason: managementUnreachable,
		},
		{
			name:       "the key was refused",
			management: unauthorised.URL,
			wantReason: managementCredentials,
		},
		{
			name:       "something answered that is not this api",
			management: notAnAPI.URL,
			wantReason: managementUnknown,
		},
	}

	address := fakeBroker(t)
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			profile := testProfile(address, protocol5, map[string]string{
				OptionManagementURL: test.management,
			})
			profile.TimeoutSec = 1
			profile.Secrets = map[string]string{
				SecretManagementKey:  "key",
				SecretManagementSalt: "secret",
			}

			conn := openProfile(t, profile)
			declared := conn.Capabilities()

			for _, capability := range []model.Capability{
				model.CapClientInspect,
				model.CapClientClose,
			} {
				reason, degraded := declared.DegradedReason(capability)
				if !degraded {
					t.Errorf("%s is not degraded with no management api", capability)
					continue
				}
				if reason != test.wantReason {
					t.Errorf("%s degraded with %q, want %q", capability, reason, test.wantReason)
				}
			}

			// Reading through a degraded capability has to fail, not answer
			// with an empty list that reads as "nobody is connected".
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if _, err := conn.ListClientConnections(ctx, ""); err == nil {
				t.Error("a connection with no management api listed clients anyway")
			}
		})
	}
}

// A broker with a management API can answer the cluster pages without $SYS,
// which is exactly the EMQX case: its default authorisation refuses that
// subscription and its REST API has better figures anyway.
func TestManagementApiKeepsTheClusterTierWithoutSys(t *testing.T) {
	api, _ := fakeEMQX(t, emqxRoutes())
	// A stub whose subscribe fails stands in for EMQX refusing $SYS.
	conn := newConn(&stubClient{subscribeErr: errNoSys}, clientConfig{
		DialTimeout:      time.Second,
		ManagementURL:    api.URL,
		ManagementKey:    "key",
		ManagementSecret: "secret",
	})
	conn.probe(context.Background())

	declared := conn.Capabilities()
	for _, capability := range []model.Capability{
		model.CapClusterTopology,
		model.CapClusterMetrics,
		model.CapClientInspect,
	} {
		if !declared.Has(capability) {
			reason, _ := declared.DegradedReason(capability)
			t.Errorf("%s is degraded (%q) on a broker whose management api answers", capability, reason)
		}
	}
}

// The endpoint is accepted in whatever shape an operator's notes have it.
func TestManagementEndpointIsAcceptedInEveryShape(t *testing.T) {
	api, _ := fakeEMQX(t, emqxRoutes())
	bare := strings.TrimPrefix(api.URL, "http://")

	for _, endpoint := range []string{api.URL, api.URL + "/", api.URL + "/api/v5", bare} {
		t.Run(endpoint, func(t *testing.T) {
			conn := newConn(&stubClient{}, clientConfig{
				DialTimeout:      time.Second,
				ManagementURL:    endpoint,
				ManagementKey:    "key",
				ManagementSecret: "secret",
			})
			if reason := conn.probeManagement(context.Background()); reason != "" {
				t.Errorf("endpoint %q was not accepted: %s", endpoint, reason)
			}
		})
	}
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

// errNoSys stands in for a broker refusing the $SYS subscription, which is
// what EMQX's default authorisation does to any client that is not local.
var errNoSys = errors.New("broker refused the subscription to $SYS/#")
