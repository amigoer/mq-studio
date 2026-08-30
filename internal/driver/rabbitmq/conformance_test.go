package rabbitmq

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	rabbithole "github.com/michaelklishin/rabbit-hole/v3"
	amqp "github.com/rabbitmq/amqp091-go"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

// liveEndpoint is the environment tests/e2e/rabbitmq brings up. Tests skip
// rather than fail when it is not running, so a checkout without docker still
// has a green suite.
const liveEndpoint = "http://127.0.0.1:15672"

// requireLiveBroker skips, or in CI fails, when the e2e environment is absent.
func requireLiveBroker(t *testing.T) {
	t.Helper()
	client := &http.Client{Timeout: 2 * time.Second}
	response, err := client.Get(liveEndpoint + "/api/overview")
	if err != nil {
		if os.Getenv("CI") != "" {
			t.Fatalf("rabbitmq must be running in CI: %v", err)
		}
		t.Skipf("rabbitmq is not running; start it with npm run e2e:rabbitmq:up (%v)", err)
	}
	_ = response.Body.Close()
}

func liveConn(t *testing.T) *Conn {
	return liveConnNamed(t, t.Name())
}

// liveConnNamed opens a connection the broker will list under that name, which
// is how a test picks its own AMQP connection out of everything else talking
// to the same broker.
func liveConnNamed(t *testing.T, name string) *Conn {
	t.Helper()
	requireLiveBroker(t)

	profile := model.ConnectionProfile{
		Kind:      model.KindRabbitMQ,
		Name:      name,
		Endpoints: liveEndpoint,
		Auth:      model.AuthConfig{Mechanism: model.AuthPlain},
	}
	profile.SetSecret(SecretUsername, "mqstudio")
	profile.SetSecret(SecretPassword, "mqstudio")

	conn, err := New().Open(context.Background(), profile)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	return conn.(*Conn)
}

// The check that makes a control the driver cannot service, or work it can do
// that the UI never offers, fail the build.
func TestConnDeclaresOnlyWhatItImplements(t *testing.T) {
	conn := liveConn(t)

	if problems := driver.CheckConformance(conn); len(problems) != 0 {
		for _, problem := range problems {
			t.Error(problem)
		}
	}
}

// The absences are the point. A UI that offered an offset reset here would be
// offering something RabbitMQ has no concept of.
func TestConnDeclaresNoOffsetOrPartitionCapabilities(t *testing.T) {
	conn := liveConn(t)
	capabilities := conn.Capabilities()

	for _, absent := range []model.Capability{
		model.CapOffsetReset,
		model.CapPartitions,
		model.CapMessageByID,
		model.CapMessageTrack,
		model.CapDestinationUpdate,
		model.CapSubscriptionCreate,
		model.CapSubscriptionDelete,
	} {
		if capabilities.Has(absent) {
			t.Errorf("declares %s, which rabbitmq has no concept of", absent)
		}
	}
}

func TestListDestinationsReadsTheLiveBroker(t *testing.T) {
	conn := liveConn(t)

	destinations, err := conn.ListDestinations(context.Background(), model.DestinationFilter{})
	if err != nil {
		t.Fatalf("list destinations: %v", err)
	}
	for _, destination := range destinations {
		if destination.Partitions != model.UnknownMetric {
			t.Errorf("queue %q reports %d partitions; rabbitmq has none",
				destination.Ref.Name, destination.Partitions)
		}
	}
}

// A declared queue must come back through the canonical list, which is what
// proves the mapping survives a round trip rather than only reading well.
func TestDeclaredQueueAppearsAsADestination(t *testing.T) {
	conn := liveConn(t)
	ctx := context.Background()
	ref := model.DestinationRef{Name: "mq-studio-conformance"}
	t.Cleanup(func() { _ = conn.RemoveDestination(ctx, ref) })

	if err := conn.CreateDestination(ctx, model.DestinationSpec{Ref: ref}); err != nil {
		t.Fatalf("create destination: %v", err)
	}

	destinations, err := conn.ListDestinations(ctx, model.DestinationFilter{})
	if err != nil {
		t.Fatalf("list destinations: %v", err)
	}
	for _, destination := range destinations {
		if destination.Ref.Name == ref.Name {
			return
		}
	}
	t.Fatalf("declared queue %q did not come back in the listing", ref.Name)
}

// Browsing is declared with a caveat rather than plainly supported. This is
// the third capability state earning its keep: the control renders, and the
// user is told that using it moves messages.
func TestBrowseIsSupportedWithACaveat(t *testing.T) {
	conn := liveConn(t)
	capabilities := conn.Capabilities()

	if !capabilities.Has(model.CapMessageQuery) {
		t.Fatal("browsing should be supported")
	}
	caveat, ok := capabilities.Caveat(model.CapMessageQuery)
	if !ok || caveat == "" {
		t.Error("browsing carries no caveat; the UI would not warn that it alters the queue")
	}
}

// Publish then browse, against the real broker. Browsing requeues rather than
// consuming, so the message has to still be there afterwards.
func TestPublishedMessageComesBackFromBrowse(t *testing.T) {
	conn := liveConn(t)
	ctx := context.Background()
	ref := model.DestinationRef{Name: "mq-studio-messages"}
	t.Cleanup(func() { _ = conn.RemoveDestination(ctx, ref) })

	if err := conn.CreateDestination(ctx, model.DestinationSpec{Ref: ref}); err != nil {
		t.Fatalf("create destination: %v", err)
	}
	if _, err := conn.SendMessage(ctx, ref.Name, "", "", "hello from conformance", 0); err != nil {
		t.Fatalf("publish: %v", err)
	}

	items, err := conn.QueryMessages(ctx, model.MessageQueryParams{Topic: ref.Name, MaxResults: 5})
	if err != nil {
		t.Fatalf("browse: %v", err)
	}
	if len(items) != 1 || items[0].Body != "hello from conformance" {
		t.Fatalf("browse returned %d items: %#v", len(items), items)
	}

	// The requeue is what makes this a browse rather than a consume.
	again, err := conn.QueryMessages(ctx, model.MessageQueryParams{Topic: ref.Name, MaxResults: 5})
	if err != nil {
		t.Fatalf("second browse: %v", err)
	}
	if len(again) != 1 {
		t.Fatalf("message did not survive browsing; got %d on the second read", len(again))
	}
}

// Exchanges and bindings have no counterpart in the canonical page set, which
// is what earns RabbitMQ its own page under the override rule.
func TestRoutingReadsTheLiveBroker(t *testing.T) {
	conn := liveConn(t)
	ctx := context.Background()

	exchanges, err := conn.ListExchanges(ctx, "")
	if err != nil {
		t.Fatalf("list exchanges: %v", err)
	}
	if len(exchanges) == 0 {
		t.Fatal("a fresh broker still has its amq.* exchanges")
	}
	for _, exchange := range exchanges {
		// An exchange routes rather than holds. Zero here would read as an
		// empty queue instead of as a field that does not apply.
		if exchange.Depth != model.UnknownMetric {
			t.Errorf("exchange %q reports a depth of %d", exchange.Ref.Name, exchange.Depth)
		}
	}

	if _, err := conn.ListBindings(ctx, ""); err != nil {
		t.Fatalf("list bindings: %v", err)
	}
}

func TestClusterOverviewReadsTheLiveBroker(t *testing.T) {
	conn := liveConn(t)

	overview, err := conn.ClusterOverview(context.Background())
	if err != nil {
		t.Fatalf("cluster overview: %v", err)
	}
	if overview.TotalNodes == 0 {
		t.Error("a running broker reports no nodes")
	}
	// RabbitMQ reports free-space headroom and an alarm flag, not a
	// percentage. Averaging alarms into a percent would invent a number.
	if overview.AvgDiskUsage != model.UnknownMetric {
		t.Errorf("disk usage = %d; rabbitmq has no cluster percentage to report", overview.AvgDiskUsage)
	}
}

// Against the real broker, a wrong password must read as a wrong password.
// This is the live half of TestProbeNamesTheActualFailure: the httptest cases
// prove the classifier, this proves RabbitMQ answers the way it assumes.
func TestLiveBadCredentialIsNotReportedAsMissingPlugin(t *testing.T) {
	requireLiveBroker(t)

	profile := model.ConnectionProfile{
		Kind:      model.KindRabbitMQ,
		Endpoints: liveEndpoint,
		Auth:      model.AuthConfig{Mechanism: model.AuthPlain},
	}
	profile.SetSecret(SecretUsername, "mqstudio")
	profile.SetSecret(SecretPassword, "definitely-not-the-password")

	conn, err := New().Open(context.Background(), profile)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer func() { _ = conn.Close() }()

	reason, degraded := conn.Capabilities().DegradedReason(model.CapDestinationList)
	if !degraded {
		t.Fatal("a rejected credential left the capabilities intact")
	}
	if reason != credentialsRejected {
		t.Errorf("reason = %q, want %q - the broker answered something other than 401", reason, credentialsRejected)
	}
}

// The broker lists every AMQP connection, and an operator looking at an
// unexpected one deserves a name rather than an IP and a port.
func TestLiveAmqpConnectionNamesItself(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	if err := conn.data.ping(ctx); err != nil {
		t.Fatalf("amqp ping: %v", err)
	}

	if name := waitForConnectionNamed(t, conn, connectionName(t.Name())); name == "" {
		t.Errorf("no connection on the broker calls itself %q", connectionName(t.Name()))
	}
}

// Close must end the AMQP session, not just stop using it. A disconnected
// profile still holding a connection is one the operator cannot account for.
func TestLiveCloseEndsTheAmqpConnection(t *testing.T) {
	// Two connections, named apart: the one under test, and one to watch it
	// with. Counting connections globally would make this depend on every
	// other test in the package and on anything else talking to the broker.
	subject := liveConnNamed(t, "close-subject")
	observer := liveConnNamed(t, "close-observer")
	defer func() { _ = observer.Close() }()

	if err := subject.data.ping(context.Background()); err != nil {
		t.Fatalf("amqp ping: %v", err)
	}

	name := waitForConnectionNamed(t, observer, connectionName("close-subject"))
	if name == "" {
		t.Fatal("the connection this test just opened never appeared")
	}
	_ = subject.Close()

	if !waitForConnectionToGo(t, observer, name) {
		t.Errorf("connection %q outlived Close", name)
	}
}

// A management API that answers and an AMQP port that does not is a working
// admin plane with no data plane, and the capability model is what says so.
func TestLiveUnreachableAmqpDegradesOnlyTheDataPlane(t *testing.T) {
	requireLiveBroker(t)

	profile := model.ConnectionProfile{
		Kind:       model.KindRabbitMQ,
		Endpoints:  liveEndpoint,
		TimeoutSec: 2,
		Auth:       model.AuthConfig{Mechanism: model.AuthPlain},
		Options:    map[string]string{OptionAMQPEndpoint: "127.0.0.1:1"},
	}
	profile.SetSecret(SecretUsername, "mqstudio")
	profile.SetSecret(SecretPassword, "mqstudio")

	conn, err := New().Open(context.Background(), profile)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer func() { _ = conn.Close() }()

	capabilities := conn.Capabilities()
	for _, capability := range []model.Capability{model.CapMessageQuery, model.CapPublish} {
		if _, degraded := capabilities.DegradedReason(capability); !degraded {
			t.Errorf("%s survived an unreachable AMQP port", capability)
		}
	}
	// The admin plane is reached over HTTP and is unaffected.
	for _, capability := range []model.Capability{
		model.CapDestinationList, model.CapClusterTopology, model.CapRouting,
	} {
		if _, degraded := capabilities.DegradedReason(capability); degraded {
			t.Errorf("%s was degraded by an AMQP failure it does not depend on", capability)
		}
	}
}

func liveConnections(t *testing.T, conn *Conn) []rabbithole.ConnectionInfo {
	t.Helper()
	found, err := call(context.Background(), conn.mgmt,
		func(client *rabbithole.Client) ([]rabbithole.ConnectionInfo, error) {
			return client.ListConnections()
		})
	if err != nil {
		t.Fatalf("list connections: %v", err)
	}
	return found
}

// The management API is eventually consistent about connections: its stats
// collector runs on an interval, so one that exists right now shows up a
// couple of seconds later and a closed one lingers just as long. Reading once
// and asserting would be a flaky test rather than a strict one.
const connectionSettleTimeout = 20 * time.Second

// waitForConnectionNamed returns the broker's own identifier for the
// connection advertising that connection_name, or "" if it never appears.
func waitForConnectionNamed(t *testing.T, admin *Conn, advertised string) string {
	t.Helper()
	deadline := time.Now().Add(connectionSettleTimeout)
	for {
		for _, connection := range liveConnections(t, admin) {
			if connection.ClientProperties["connection_name"] == advertised {
				return connection.Name
			}
		}
		if time.Now().After(deadline) {
			return ""
		}
		time.Sleep(250 * time.Millisecond)
	}
}

func waitForConnectionToGo(t *testing.T, admin *Conn, name string) bool {
	t.Helper()
	deadline := time.Now().Add(connectionSettleTimeout)
	for {
		present := false
		for _, connection := range liveConnections(t, admin) {
			if connection.Name == name {
				present = true
				break
			}
		}
		if !present {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(250 * time.Millisecond)
	}
}

// The census against the real broker. The offline tests prove the mapping
// against fixtures; this proves the fixtures are the shape RabbitMQ 4 sends.
func TestLiveCensusReadsTheBroker(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	census, err := conn.Census(ctx)
	if err != nil {
		t.Fatalf("Census: %v", err)
	}

	if census.ClusterName == "" {
		t.Error("the broker reported no cluster name")
	}
	if census.Version == "" || census.RuntimeVersion == "" {
		t.Errorf("versions = %q / %q, want both", census.Version, census.RuntimeVersion)
	}
	// Every vhost has the default exchanges, so this is never zero on a broker
	// that answered at all.
	if census.Exchanges <= 0 {
		t.Errorf("exchanges = %d, want the built-in ones at least", census.Exchanges)
	}
	// Connections is deliberately not asserted. The management API's object
	// totals come from a stats collector on an interval, so the connection
	// this test just opened is not counted for a few seconds - the same lag
	// TestLiveAmqpConnectionNamesItself has to poll around. Asserting it here
	// would be a flaky test rather than a strict one.
	if census.Connections < 0 {
		t.Errorf("connections = %d", census.Connections)
	}

	// Cross-check the census against walking the queues, which is the thing it
	// exists to avoid doing. They are read a moment apart, so this checks the
	// census is in the right order of magnitude rather than exactly equal.
	queues, err := conn.ListDestinations(ctx, model.DestinationFilter{IncludeInternal: true})
	if err != nil {
		t.Fatalf("list queues: %v", err)
	}
	if census.Queues < len(queues)-2 || census.Queues > len(queues)+2 {
		t.Errorf("census counts %d queues, the listing has %d", census.Queues, len(queues))
	}
}

// Node figures the overview's watermark meters read. They are attributes
// rather than canonical fields, so nothing but a test says they are there.
func TestLiveNodeCarriesMemoryAndDiskLimits(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	nodes, err := conn.ListNodes(context.Background())
	if err != nil {
		t.Fatalf("list nodes: %v", err)
	}
	if len(nodes) == 0 {
		t.Fatal("no nodes")
	}

	node := nodes[0]
	for _, key := range []string{AttrMemUsed, AttrMemLimit, AttrDiskFree, AttrDiskLimit} {
		value, present := node.Attributes[key]
		if !present || value == "" || value == "0" {
			t.Errorf("attribute %q = %q, want a real figure", key, value)
		}
	}
	for _, key := range []string{AttrMemAlarm, AttrDiskAlarm} {
		if value := node.Attributes[key]; value != "true" && value != "false" {
			t.Errorf("attribute %q = %q, want a boolean", key, value)
		}
	}
	// A healthy single-node broker is partitioned from nobody. The key must
	// still be present, because its absence and an empty list mean different
	// things to the reader.
	if _, present := node.Attributes[AttrPartitions]; !present {
		t.Error("the partitions attribute is missing entirely")
	}
	// RabbitMQ reports no per-node throughput, so these must stay unknown
	// rather than being filled with a zero that reads as "measured, idle".
	if node.RateIn != model.UnknownMetric || node.RateOut != model.UnknownMetric {
		t.Errorf("node rates = %d / %d, want the unknown sentinel", node.RateIn, node.RateOut)
	}
}

// A queue declared with arguments has to come back carrying them, because the
// queues board reads its whole detail panel out of that map.
func TestLiveQueueCarriesItsDeclaredArguments(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	name := "mqs-test-arguments"
	settings := rabbithole.QueueSettings{
		Durable: true,
		Arguments: map[string]interface{}{
			"x-message-ttl":            30000,
			"x-dead-letter-exchange":   "amq.fanout",
			"x-max-length":             5000,
			"x-overflow":               "reject-publish",
			"x-single-active-consumer": true,
		},
	}
	if err := exec(ctx, conn.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.DeclareQueue("/", name, settings)
	}); err != nil {
		t.Fatalf("declare: %v", err)
	}
	t.Cleanup(func() {
		_ = exec(context.Background(), conn.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
			return client.DeleteQueue("/", name)
		})
	})

	found, err := conn.DestinationDetail(ctx, model.DestinationRef{Namespace: "/", Name: name})
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	raw := found.Attributes[AttrArguments]
	if raw == "" {
		t.Fatal("the queue came back with no arguments at all")
	}
	var arguments map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &arguments); err != nil {
		t.Fatalf("arguments are not decodable JSON: %v", err)
	}
	// The types are the point: a reader has to tell the number 5000 from the
	// string "5000", so a flat string map would lose what matters.
	if ttl, ok := arguments["x-message-ttl"].(float64); !ok || ttl != 30000 {
		t.Errorf("x-message-ttl = %#v, want the number 30000", arguments["x-message-ttl"])
	}
	if single, ok := arguments["x-single-active-consumer"].(bool); !ok || !single {
		t.Errorf("x-single-active-consumer = %#v, want the boolean true", arguments["x-single-active-consumer"])
	}
	if arguments["x-overflow"] != "reject-publish" {
		t.Errorf("x-overflow = %#v", arguments["x-overflow"])
	}
	if found.Attributes[AttrQueueType] != "classic" {
		t.Errorf("queueType = %q, want classic for a queue declared without one",
			found.Attributes[AttrQueueType])
	}
}

// A quorum queue reports its replicas; a classic one reports none, and the
// absence is what tells the panel not to draw a replication section.
func TestLiveQuorumQueueReportsItsReplicas(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	name := "mqs-test-quorum"
	if err := exec(ctx, conn.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.DeclareQueue("/", name, rabbithole.QueueSettings{
			Durable:   true,
			Arguments: map[string]interface{}{"x-queue-type": "quorum"},
		})
	}); err != nil {
		t.Fatalf("declare: %v", err)
	}
	t.Cleanup(func() {
		_ = exec(context.Background(), conn.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
			return client.DeleteQueue("/", name)
		})
	})

	found, err := conn.DestinationDetail(ctx, model.DestinationRef{Namespace: "/", Name: name})
	if err != nil {
		t.Fatalf("detail: %v", err)
	}
	if found.Attributes[AttrQueueType] != "quorum" {
		t.Errorf("queueType = %q, want quorum", found.Attributes[AttrQueueType])
	}
	if found.Attributes[AttrLeader] == "" {
		t.Error("a quorum queue reported no leader")
	}
	if found.Attributes[AttrMembers] == "" {
		t.Error("a quorum queue reported no members")
	}
}

// Bindings, round trip. Declaring one and reading it back is what proves the
// mapping survives rather than only reading well against a fixture.
func TestLiveBindingRoundTrip(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const exchange = "mqs-test-ex"
	const queue = "mqs-test-bound-q"
	const routingKey = "order.created"

	if err := exec(ctx, conn.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.DeclareExchange("/", exchange, rabbithole.ExchangeSettings{
			Type: "topic", Durable: true,
		})
	}); err != nil {
		t.Fatalf("declare exchange: %v", err)
	}
	t.Cleanup(func() {
		_ = exec(context.Background(), conn.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
			return client.DeleteExchange("/", exchange)
		})
	})

	if err := exec(ctx, conn.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.DeclareQueue("/", queue, rabbithole.QueueSettings{Durable: true})
	}); err != nil {
		t.Fatalf("declare queue: %v", err)
	}
	t.Cleanup(func() {
		_ = exec(context.Background(), conn.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
			return client.DeleteQueue("/", queue)
		})
	})

	if err := exec(ctx, conn.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.DeclareBinding("/", rabbithole.BindingInfo{
			Source: exchange, Destination: queue, DestinationType: "queue", RoutingKey: routingKey,
		})
	}); err != nil {
		t.Fatalf("declare binding: %v", err)
	}

	bindings, err := conn.ListBindings(ctx, "/")
	if err != nil {
		t.Fatalf("list bindings: %v", err)
	}
	found := false
	for _, binding := range bindings {
		if binding.Source == exchange && binding.Destination == queue {
			found = true
			if binding.RoutingKey != routingKey {
				t.Errorf("routingKey = %q, want %q", binding.RoutingKey, routingKey)
			}
			if binding.DestinationKind != "queue" {
				t.Errorf("destinationKind = %q, want queue", binding.DestinationKind)
			}
		}
	}
	if !found {
		t.Errorf("the binding just declared is not in the listing")
	}

	// The exchange has to come back with a depth of unknown rather than zero:
	// it routes and holds nothing, and zero would read as an empty queue.
	exchanges, err := conn.ListExchanges(ctx, "/")
	if err != nil {
		t.Fatalf("list exchanges: %v", err)
	}
	var declared *model.Destination
	for _, found := range exchanges {
		if found.Ref.Name == exchange {
			declared = found
		}
	}
	if declared == nil {
		t.Fatal("the exchange just declared is not in the listing")
	}
	if declared.Depth != model.UnknownMetric {
		t.Errorf("exchange depth = %d, want the unknown sentinel", declared.Depth)
	}
	if declared.Attributes[AttrExchangeType] != "topic" {
		t.Errorf("exchangeType = %q", declared.Attributes[AttrExchangeType])
	}
}

// Every virtual host has a default exchange with an empty name. It must come
// through as itself rather than being dropped or renamed by the mapping.
func TestLiveDefaultExchangeIsListed(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	exchanges, err := conn.ListExchanges(context.Background(), "/")
	if err != nil {
		t.Fatalf("list exchanges: %v", err)
	}
	for _, exchange := range exchanges {
		if exchange.Ref.Name == "" {
			if exchange.Attributes[AttrExchangeType] != "direct" {
				t.Errorf("the default exchange is a %q", exchange.Attributes[AttrExchangeType])
			}
			return
		}
	}
	t.Error("the default exchange is missing from the listing")
}

// The connection this test is holding has to show up in the listing, with the
// fields the board reads. It polls, because the management API's client stats
// come from a collector on an interval.
func TestLiveClientConnectionsIncludeOurOwn(t *testing.T) {
	conn := liveConnNamed(t, "client-listing")
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	if err := conn.data.ping(ctx); err != nil {
		t.Fatalf("amqp ping: %v", err)
	}

	var found *model.ClientConnection
	deadline := time.Now().Add(connectionSettleTimeout)
	for found == nil && time.Now().Before(deadline) {
		connections, err := conn.ListClientConnections(ctx, "/")
		if err != nil {
			t.Fatalf("list client connections: %v", err)
		}
		for _, candidate := range connections {
			if candidate.ClientName == connectionName("client-listing") {
				found = candidate
			}
		}
		if found == nil {
			time.Sleep(250 * time.Millisecond)
		}
	}
	if found == nil {
		t.Fatal("our own AMQP connection never appeared in the listing")
	}

	if found.Protocol == "" {
		t.Error("the connection reports no protocol")
	}
	if found.User != "mqstudio" {
		t.Errorf("user = %q, want the connecting user", found.User)
	}
	if found.PeerHost == "" || found.PeerPort == 0 {
		t.Errorf("peer = %q:%d, want a real address", found.PeerHost, found.PeerPort)
	}
	// The driver negotiates a ten second heartbeat, so this must not be zero -
	// zero would mean heartbeats are off, which the panel says out loud.
	if found.HeartbeatSec <= 0 {
		t.Errorf("heartbeat = %d, want the negotiated interval", found.HeartbeatSec)
	}
	if found.Name == "" {
		t.Error("the connection has no name, which is what a close request needs")
	}
}

// A channel opened on our connection has to come back attached to it, because
// the board groups channels under the connection they belong to.
func TestLiveClientChannelsAttachToTheirConnection(t *testing.T) {
	conn := liveConnNamed(t, "channel-listing")
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	// Hold a channel open for the length of the check rather than letting
	// withChannel close it the moment it returns.
	held := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- conn.data.withChannel(ctx, func(*amqp.Channel) error {
			<-held
			return nil
		})
	}()
	defer func() { close(held); <-done }()

	var attached *model.ClientChannel
	deadline := time.Now().Add(connectionSettleTimeout)
	for attached == nil && time.Now().Before(deadline) {
		connections, err := conn.ListClientConnections(ctx, "/")
		if err != nil {
			t.Fatalf("list connections: %v", err)
		}
		ours := ""
		for _, candidate := range connections {
			if candidate.ClientName == connectionName("channel-listing") {
				ours = candidate.Name
			}
		}
		if ours != "" {
			channels, err := conn.ListClientChannels(ctx, "/")
			if err != nil {
				t.Fatalf("list channels: %v", err)
			}
			for _, channel := range channels {
				if channel.Connection == ours {
					attached = channel
				}
			}
		}
		if attached == nil {
			time.Sleep(250 * time.Millisecond)
		}
	}
	if attached == nil {
		t.Fatal("no channel came back attached to our connection")
	}
	if attached.Number <= 0 {
		t.Errorf("channel number = %d, want a real one", attached.Number)
	}
	if attached.Namespace != "/" {
		t.Errorf("vhost = %q, want the one asked for", attached.Namespace)
	}
}

// The broker's own health checks, against the real broker. A single-node
// development broker passes most of them, so what this pins is that each one
// produced an answer rather than an error the page would show as a failure.
func TestLiveHealthChecksAllAnswer(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	health, err := conn.Health(context.Background())
	if err != nil {
		t.Fatalf("Health: %v", err)
	}

	wanted := []string{
		CheckAlarms, CheckLocalAlarms, CheckVirtualHosts,
		CheckQuorum, CheckMirrorSync, CheckCertificates,
	}
	seen := make(map[string]*model.HealthCheck, len(health.Checks))
	for _, check := range health.Checks {
		seen[check.ID] = check
	}
	for _, id := range wanted {
		check, present := seen[id]
		if !present {
			t.Errorf("check %q produced no result at all", id)
			continue
		}
		// A check that could not run is a distinct state from one that ran and
		// failed, and it must not carry Passed.
		if check.Unavailable && check.Passed {
			t.Errorf("check %q is both unavailable and passed", id)
		}
	}

	// A healthy broker with no alarms reports the check as passed and the
	// alarm list as empty; the two must agree.
	if alarms := seen[CheckAlarms]; alarms != nil && alarms.Passed && len(health.Alarms) > 0 {
		t.Errorf("the alarm check passed while reporting %d alarms", len(health.Alarms))
	}
}

// Feature flags decide whether a rolling upgrade is possible, so the page has
// to be able to read them at all.
func TestLiveFeatureFlagsAreReadable(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	health, err := conn.Health(context.Background())
	if err != nil {
		t.Fatalf("Health: %v", err)
	}
	if len(health.FeatureFlags) == 0 {
		t.Fatal("no feature flags came back; RabbitMQ 4 ships with many")
	}
	for _, flag := range health.FeatureFlags {
		if flag.Name == "" || flag.State == "" {
			t.Errorf("flag %+v is missing a name or a state", flag)
		}
	}

	// The deprecation phase is decoded from an int by the library, so a naive
	// string conversion yields one rune rather than a word. Anything that came
	// back has to be a name.
	for _, feature := range health.DeprecatedFeatures {
		switch feature.Phase {
		case "permitted_by_default", "denied_by_default", "disconnected", "removed", "unknown":
		default:
			t.Errorf("deprecated feature %q has phase %q, which is not a name",
				feature.Name, feature.Phase)
		}
	}
}

// publishTestMessages puts n messages on a fresh queue and cleans it up.
func publishTestMessages(t *testing.T, conn *Conn, queue string, bodies []string, headers []amqp.Table) {
	t.Helper()
	ctx := context.Background()

	if err := exec(ctx, conn.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.DeclareQueue("/", queue, rabbithole.QueueSettings{Durable: true})
	}); err != nil {
		t.Fatalf("declare %q: %v", queue, err)
	}
	t.Cleanup(func() {
		_ = exec(context.Background(), conn.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
			return client.DeleteQueue("/", queue)
		})
	})

	err := conn.data.withChannel(ctx, func(channel *amqp.Channel) error {
		for i, body := range bodies {
			publishing := amqp.Publishing{
				Body:         []byte(body),
				DeliveryMode: amqp.Persistent,
				MessageId:    fmt.Sprintf("id-%d", i),
			}
			if i < len(headers) {
				publishing.Headers = headers[i]
			}
			if err := channel.PublishWithContext(ctx, "", queue, false, false, publishing); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	waitForDepth(t, conn, queue, len(bodies))
}

// waitForDepth polls until the queue reports the depth expected. Publishing is
// asynchronous without confirms, so the messages are not there the instant the
// publish call returns.
func waitForDepth(t *testing.T, conn *Conn, queue string, want int) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for {
		found, err := conn.DestinationDetail(context.Background(),
			model.DestinationRef{Namespace: "/", Name: queue})
		if err == nil && found.Attributes[AttrReady] == strconv.Itoa(want) {
			return
		}
		if time.Now().After(deadline) {
			depth := "unknown"
			if err == nil {
				depth = found.Attributes[AttrReady]
			}
			t.Fatalf("queue %q settled at %s ready, want %d", queue, depth, want)
		}
		time.Sleep(200 * time.Millisecond)
	}
}

// The invariant the whole board rests on: browsing must put everything back.
// If this ever fails, the page is silently eating production messages.
func TestLiveBrowseDoesNotConsume(t *testing.T) {
	conn := liveConnNamed(t, "browse-nondestructive")
	defer func() { _ = conn.Close() }()

	const queue = "mqs-test-browse"
	publishTestMessages(t, conn, queue, []string{"one", "two", "three"}, nil)

	items, err := conn.QueryMessages(context.Background(), model.MessageQueryParams{
		Topic: queue, MaxResults: 10,
	})
	if err != nil {
		t.Fatalf("browse: %v", err)
	}
	if len(items) != 3 {
		t.Fatalf("browsed %d messages, want 3", len(items))
	}
	// Everything has to be back, ready to deliver, once the nack lands.
	waitForDepth(t, conn, queue, 3)

	// And a second browse must see the same three, which is what proves the
	// first one did not take them.
	again, err := conn.QueryMessages(context.Background(), model.MessageQueryParams{
		Topic: queue, MaxResults: 10,
	})
	if err != nil {
		t.Fatalf("second browse: %v", err)
	}
	if len(again) != 3 {
		t.Errorf("the second browse found %d messages, want the same 3", len(again))
	}
}

// A browse asking for fewer than the queue holds must return exactly that many
// and leave the rest alone.
func TestLiveBrowseHonoursTheRequestedCount(t *testing.T) {
	conn := liveConnNamed(t, "browse-count")
	defer func() { _ = conn.Close() }()

	const queue = "mqs-test-browse-count"
	publishTestMessages(t, conn, queue, []string{"a", "b", "c", "d", "e"}, nil)

	items, err := conn.QueryMessages(context.Background(), model.MessageQueryParams{
		Topic: queue, MaxResults: 2,
	})
	if err != nil {
		t.Fatalf("browse: %v", err)
	}
	if len(items) != 2 {
		t.Errorf("browsed %d messages, want the 2 asked for", len(items))
	}
	waitForDepth(t, conn, queue, 5)
}

// The management API's get endpoint could not honour a filter at all. This is
// the reason browsing moved to AMQP.
func TestLiveBrowseFiltersOnHeadersAndBody(t *testing.T) {
	conn := liveConnNamed(t, "browse-filter")
	defer func() { _ = conn.Close() }()

	const queue = "mqs-test-browse-filter"
	publishTestMessages(t, conn, queue,
		[]string{"order created", "order shipped", "invoice raised"},
		[]amqp.Table{{"kind": "order"}, {"kind": "order"}, {"kind": "invoice"}},
	)

	ctx := context.Background()
	byBody, err := conn.QueryMessages(ctx, model.MessageQueryParams{
		Topic: queue, MaxResults: 10,
		Filters: map[string]string{FilterBody: "shipped"},
	})
	if err != nil {
		t.Fatalf("browse by body: %v", err)
	}
	if len(byBody) != 1 || byBody[0].Body != "order shipped" {
		t.Errorf("body filter returned %d items: %+v", len(byBody), byBody)
	}
	waitForDepth(t, conn, queue, 3)

	byHeader, err := conn.QueryMessages(ctx, model.MessageQueryParams{
		Topic: queue, MaxResults: 10,
		Filters: map[string]string{FilterHeader: "kind=invoice"},
	})
	if err != nil {
		t.Fatalf("browse by header: %v", err)
	}
	if len(byHeader) != 1 {
		t.Errorf("header filter returned %d items, want 1", len(byHeader))
	}
	waitForDepth(t, conn, queue, 3)
}

// Every property the detail panel shows has to survive the round trip. The
// management API flattened headers through JSON and lost their types.
func TestLiveBrowseCarriesPropertiesAndHeaders(t *testing.T) {
	conn := liveConnNamed(t, "browse-properties")
	defer func() { _ = conn.Close() }()

	const queue = "mqs-test-browse-props"
	publishTestMessages(t, conn, queue, []string{"payload"},
		[]amqp.Table{{"retries": int32(3), "source": "gateway"}})

	items, err := conn.QueryMessages(context.Background(), model.MessageQueryParams{
		Topic: queue, MaxResults: 1,
	})
	if err != nil {
		t.Fatalf("browse: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("browsed %d messages, want 1", len(items))
	}

	item := items[0]
	if item.Properties["header.retries"] != "3" {
		t.Errorf("header.retries = %q, want 3", item.Properties["header.retries"])
	}
	if item.Properties["header.source"] != "gateway" {
		t.Errorf("header.source = %q", item.Properties["header.source"])
	}
	// Persistent decides whether the message survives a restart, so the word
	// rather than the number 2.
	if item.Properties["deliveryMode"] != "persistent" {
		t.Errorf("deliveryMode = %q, want persistent", item.Properties["deliveryMode"])
	}
	if item.MessageID != "id-0" {
		t.Errorf("messageId = %q", item.MessageID)
	}
	// AMQP has no partition and no offset. Zero would read as the first
	// message on partition zero.
	if item.QueueID != model.UnknownMetric || item.QueueOffset != model.UnknownMetric {
		t.Errorf("queueId/offset = %d/%d, want the unknown sentinel", item.QueueID, item.QueueOffset)
	}
}

// An empty queue is a result, not an error, and it must not hang waiting for
// a message that is never coming.
func TestLiveBrowseAnEmptyQueueReturnsQuickly(t *testing.T) {
	conn := liveConnNamed(t, "browse-empty")
	defer func() { _ = conn.Close() }()

	const queue = "mqs-test-browse-empty"
	publishTestMessages(t, conn, queue, nil, nil)

	start := time.Now()
	items, err := conn.QueryMessages(context.Background(), model.MessageQueryParams{
		Topic: queue, MaxResults: 32,
	})
	if err != nil {
		t.Fatalf("browse: %v", err)
	}
	if len(items) != 0 {
		t.Errorf("an empty queue returned %d messages", len(items))
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Errorf("browsing an empty queue took %s", elapsed)
	}
}

// Dead-letter queues are found by walking the topology, so the test has to
// build one: a source queue with a dead-letter exchange, that exchange, and
// the queue it is bound to.
func TestLiveDeadLetterTopologyIsWalkedBackwards(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const (
		exchange = "mqs-test-dlx"
		target   = "mqs-test-dlq"
		source   = "mqs-test-dl-source"
	)

	declare := func(fn func(*rabbithole.Client) (*http.Response, error), what string) {
		t.Helper()
		if err := exec(ctx, conn.mgmt, fn); err != nil {
			t.Fatalf("declare %s: %v", what, err)
		}
	}
	declare(func(client *rabbithole.Client) (*http.Response, error) {
		return client.DeclareExchange("/", exchange, rabbithole.ExchangeSettings{Type: "fanout", Durable: true})
	}, "exchange")
	t.Cleanup(func() {
		_ = exec(context.Background(), conn.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
			return client.DeleteExchange("/", exchange)
		})
	})

	declare(func(client *rabbithole.Client) (*http.Response, error) {
		return client.DeclareQueue("/", target, rabbithole.QueueSettings{Durable: true})
	}, "target queue")
	t.Cleanup(func() {
		_ = exec(context.Background(), conn.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
			return client.DeleteQueue("/", target)
		})
	})

	declare(func(client *rabbithole.Client) (*http.Response, error) {
		return client.DeclareBinding("/", rabbithole.BindingInfo{
			Source: exchange, Destination: target, DestinationType: "queue",
		})
	}, "binding")

	declare(func(client *rabbithole.Client) (*http.Response, error) {
		return client.DeclareQueue("/", source, rabbithole.QueueSettings{
			Durable:   true,
			Arguments: map[string]interface{}{ArgDeadLetterExchange: exchange},
		})
	}, "source queue")
	t.Cleanup(func() {
		_ = exec(context.Background(), conn.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
			return client.DeleteQueue("/", source)
		})
	})

	found, err := conn.DeadLetterQueues(ctx, "/")
	if err != nil {
		t.Fatalf("DeadLetterQueues: %v", err)
	}

	var dlq *model.DeadLetterQueue
	for _, candidate := range found {
		if candidate.Name == target {
			dlq = candidate
		}
	}
	if dlq == nil {
		t.Fatalf("the dead-letter queue was not found; got %d queues", len(found))
	}
	if len(dlq.Sources) != 1 {
		t.Fatalf("sources = %d, want the one queue that dead-letters here", len(dlq.Sources))
	}
	if dlq.Sources[0].Queue != source {
		t.Errorf("source queue = %q, want %q", dlq.Sources[0].Queue, source)
	}
	if dlq.Sources[0].Exchange != exchange {
		t.Errorf("source exchange = %q, want %q", dlq.Sources[0].Exchange, exchange)
	}
	// No routing key was declared, so the message keeps its own - which is a
	// different setup from one that rewrites it, and the empty value says so.
	if dlq.Sources[0].RoutingKey != "" {
		t.Errorf("routingKey = %q, want empty", dlq.Sources[0].RoutingKey)
	}

	// The source queue itself must not be listed: it sends dead letters, it
	// does not receive them.
	for _, candidate := range found {
		if candidate.Name == source {
			t.Error("the source queue was listed as a dead-letter queue")
		}
	}
}

// A message that actually died has to carry the history the board reads.
func TestLiveDeadLetteredMessageCarriesXDeath(t *testing.T) {
	conn := liveConnNamed(t, "dead-letter-history")
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const (
		exchange = "mqs-test-death-dlx"
		target   = "mqs-test-death-dlq"
		source   = "mqs-test-death-source"
	)
	steps := []struct {
		what string
		run  func(*rabbithole.Client) (*http.Response, error)
	}{
		{"exchange", func(c *rabbithole.Client) (*http.Response, error) {
			return c.DeclareExchange("/", exchange, rabbithole.ExchangeSettings{Type: "fanout", Durable: true})
		}},
		{"target", func(c *rabbithole.Client) (*http.Response, error) {
			return c.DeclareQueue("/", target, rabbithole.QueueSettings{Durable: true})
		}},
		{"binding", func(c *rabbithole.Client) (*http.Response, error) {
			return c.DeclareBinding("/", rabbithole.BindingInfo{
				Source: exchange, Destination: target, DestinationType: "queue",
			})
		}},
		{"source", func(c *rabbithole.Client) (*http.Response, error) {
			return c.DeclareQueue("/", source, rabbithole.QueueSettings{
				Durable: true,
				Arguments: map[string]interface{}{
					ArgDeadLetterExchange: exchange,
					// A one-shot TTL is the cheapest way to make a message
					// die without needing a consumer to reject it.
					ArgMessageTTL: 1,
				},
			})
		}},
	}
	for _, step := range steps {
		if err := exec(ctx, conn.mgmt, step.run); err != nil {
			t.Fatalf("declare %s: %v", step.what, err)
		}
	}
	t.Cleanup(func() {
		for _, remove := range []func(*rabbithole.Client) (*http.Response, error){
			func(c *rabbithole.Client) (*http.Response, error) { return c.DeleteQueue("/", source) },
			func(c *rabbithole.Client) (*http.Response, error) { return c.DeleteQueue("/", target) },
			func(c *rabbithole.Client) (*http.Response, error) { return c.DeleteExchange("/", exchange) },
		} {
			_ = exec(context.Background(), conn.mgmt, remove)
		}
	})

	err := conn.data.withChannel(ctx, func(channel *amqp.Channel) error {
		return channel.PublishWithContext(ctx, "", source, false, false, amqp.Publishing{
			Body: []byte("will expire"), DeliveryMode: amqp.Persistent,
		})
	})
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	waitForDepth(t, conn, target, 1)

	items, err := conn.QueryMessages(ctx, model.MessageQueryParams{Topic: target, MaxResults: 1})
	if err != nil {
		t.Fatalf("browse: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("browsed %d messages, want the one that died", len(items))
	}

	death := items[0].Properties["header.x-death"]
	if death == "" {
		t.Fatal("a dead-lettered message carries no x-death header")
	}
	// The board parses the count, the origin queue and the reason out of this,
	// so all three have to survive the driver's flattening.
	for _, want := range []string{"count=", "queue=" + source, "reason=expired"} {
		if !strings.Contains(death, want) {
			t.Errorf("x-death %q does not contain %q", death, want)
		}
	}
}
