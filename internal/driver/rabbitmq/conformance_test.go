package rabbitmq

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	rabbithole "github.com/michaelklishin/rabbit-hole/v3"
	amqp "github.com/rabbitmq/amqp091-go"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/e2e"
	"github.com/amigoer/mq-studio/internal/model"
)

// liveEndpoint is the environment tests/e2e/rabbitmq brings up. Tests skip
// rather than fail when it is not running, so a checkout without docker still
// has a green suite.
const liveEndpoint = "http://127.0.0.1:15672"

// requireLiveBroker skips, or in CI fails, when the e2e environment is absent.
func requireLiveBroker(t *testing.T) {
	t.Helper()
	e2e.Require(t, e2e.Env{
		Name:  "rabbitmq",
		Start: "npm run e2e:rabbitmq:up",
		Probe: e2e.HTTPGet(liveEndpoint + "/api/overview"),
	})
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

// Declaring through the form's path and reading the result back. Every
// argument has to arrive with the type the broker wanted, or the declare
// fails with a channel error naming a type nobody chose.
func TestLiveDeclareQueueWithArguments(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const name = "mqs-test-declared"
	spec := model.DestinationSpec{
		Ref: model.DestinationRef{Namespace: "/", Name: name},
		Attributes: map[string]string{
			AttrQueueType:  "quorum",
			AttrDurable:    "true",
			AttrAutoDelete: "false",
			// As the form sends it: JSON, with numbers as numbers.
			AttrArguments: `{"x-message-ttl":30000,"x-max-length":5000,"x-overflow":"reject-publish","x-dead-letter-exchange":"amq.fanout"}`,
		},
	}
	if err := conn.CreateDestination(ctx, spec); err != nil {
		t.Fatalf("declare: %v", err)
	}
	t.Cleanup(func() {
		_ = conn.RemoveDestination(context.Background(),
			model.DestinationRef{Namespace: "/", Name: name})
	})

	found, err := conn.DestinationDetail(ctx, model.DestinationRef{Namespace: "/", Name: name})
	if err != nil {
		t.Fatalf("detail: %v", err)
	}
	if found.Attributes[AttrQueueType] != "quorum" {
		t.Errorf("queueType = %q, want quorum", found.Attributes[AttrQueueType])
	}
	var arguments map[string]interface{}
	if err := json.Unmarshal([]byte(found.Attributes[AttrArguments]), &arguments); err != nil {
		t.Fatalf("arguments are not decodable: %v", err)
	}
	// JSON gives float64 and RabbitMQ wants an integer. If the driver passed
	// the float straight through, the declare above would have failed.
	if ttl, ok := arguments["x-message-ttl"].(float64); !ok || ttl != 30000 {
		t.Errorf("x-message-ttl = %#v", arguments["x-message-ttl"])
	}
	if arguments["x-overflow"] != "reject-publish" {
		t.Errorf("x-overflow = %#v", arguments["x-overflow"])
	}
}

// The delete guards are the broker's, and they have to actually stop a delete.
// A guard that silently passes is worse than none: it reads as protection.
func TestLiveGuardedDeleteRefusesANonEmptyQueue(t *testing.T) {
	conn := liveConnNamed(t, "guarded-delete")
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const name = "mqs-test-guarded"
	publishTestMessages(t, conn, name, []string{"still here"}, nil)

	ref := model.DestinationRef{Namespace: "/", Name: name}
	if err := conn.RemoveQueueGuarded(ctx, ref, false, true); err == nil {
		t.Fatal("if-empty deleted a queue holding a message")
	}
	// And the queue is still there, which is the part that matters.
	if _, err := conn.DestinationDetail(ctx, ref); err != nil {
		t.Fatalf("the queue is gone after a refused delete: %v", err)
	}

	// Unguarded, it goes.
	if err := conn.RemoveDestination(ctx, ref); err != nil {
		t.Fatalf("unguarded delete: %v", err)
	}
	if _, err := conn.DestinationDetail(ctx, ref); err == nil {
		t.Error("the queue survived an unguarded delete")
	}
}

// Re-declaring with different arguments is an error rather than an update,
// which is why there is no edit form. If this ever starts passing, the queue
// dialog can grow one.
func TestLiveRedeclareWithDifferentArgumentsFails(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const name = "mqs-test-redeclare"
	first := model.DestinationSpec{
		Ref:        model.DestinationRef{Namespace: "/", Name: name},
		Attributes: map[string]string{AttrDurable: "true", AttrArguments: `{"x-message-ttl":1000}`},
	}
	if err := conn.CreateDestination(ctx, first); err != nil {
		t.Fatalf("declare: %v", err)
	}
	t.Cleanup(func() {
		_ = conn.RemoveDestination(context.Background(),
			model.DestinationRef{Namespace: "/", Name: name})
	})

	second := first
	second.Attributes = map[string]string{AttrDurable: "true", AttrArguments: `{"x-message-ttl":2000}`}
	if err := conn.CreateDestination(ctx, second); err == nil {
		t.Error("re-declaring with a different TTL succeeded - RabbitMQ has learned to update a queue, so the dialog can grow an edit form")
	}
}

func TestLivePurgeEmptiesAQueue(t *testing.T) {
	conn := liveConnNamed(t, "purge")
	defer func() { _ = conn.Close() }()

	const queue = "mqs-test-purge"
	publishTestMessages(t, conn, queue, []string{"a", "b", "c"}, nil)

	ref := model.DestinationRef{Namespace: "/", Name: queue}
	if err := conn.PurgeQueue(context.Background(), ref); err != nil {
		t.Fatalf("purge: %v", err)
	}
	waitForDepth(t, conn, queue, 0)

	// The queue itself survives; purging is not deleting.
	if _, err := conn.DestinationDetail(context.Background(), ref); err != nil {
		t.Errorf("the queue was deleted rather than emptied: %v", err)
	}
}

// Moving has to leave the source empty and the target full, with the bodies
// intact - and it has to publish before it acknowledges, so a failure leaves a
// duplicate rather than a hole.
func TestLiveMoveMessagesBetweenQueues(t *testing.T) {
	conn := liveConnNamed(t, "move")
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const source = "mqs-test-move-src"
	const target = "mqs-test-move-dst"
	publishTestMessages(t, conn, source, []string{"one", "two", "three"}, nil)
	publishTestMessages(t, conn, target, nil, nil)

	// The default exchange with the target's name as the routing key is the
	// simplest way to send straight to a queue.
	moved, err := conn.MoveMessages(ctx, model.MoveRequest{
		Namespace: "/", From: source, ToExchange: "", ToRoutingKey: target, Limit: 10,
	})
	if err != nil {
		t.Fatalf("move: %v", err)
	}
	if moved != 3 {
		t.Errorf("moved %d, want 3", moved)
	}
	waitForDepth(t, conn, source, 0)
	waitForDepth(t, conn, target, 3)

	items, err := conn.QueryMessages(ctx, model.MessageQueryParams{Topic: target, MaxResults: 10})
	if err != nil {
		t.Fatalf("browse target: %v", err)
	}
	bodies := map[string]bool{}
	for _, item := range items {
		bodies[item.Body] = true
	}
	for _, want := range []string{"one", "two", "three"} {
		if !bodies[want] {
			t.Errorf("the body %q did not survive the move", want)
		}
	}
}

// Headers have to survive, because moving dead letters back is the main use
// and x-death is the only record of why they died.
func TestLiveMovePreservesHeaders(t *testing.T) {
	conn := liveConnNamed(t, "move-headers")
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const source = "mqs-test-move-hdr-src"
	const target = "mqs-test-move-hdr-dst"
	publishTestMessages(t, conn, source, []string{"payload"},
		[]amqp.Table{{"retries": int32(4), "origin": "order.settle.q"}})
	publishTestMessages(t, conn, target, nil, nil)

	if _, err := conn.MoveMessages(ctx, model.MoveRequest{
		Namespace: "/", From: source, ToRoutingKey: target, Limit: 10,
	}); err != nil {
		t.Fatalf("move: %v", err)
	}
	waitForDepth(t, conn, target, 1)

	items, err := conn.QueryMessages(ctx, model.MessageQueryParams{Topic: target, MaxResults: 1})
	if err != nil {
		t.Fatalf("browse: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("browsed %d, want 1", len(items))
	}
	if items[0].Properties["header.retries"] != "4" {
		t.Errorf("header.retries = %q, want 4", items[0].Properties["header.retries"])
	}
	if items[0].Properties["header.origin"] != "order.settle.q" {
		t.Errorf("header.origin = %q", items[0].Properties["header.origin"])
	}
	// Persistence is a property, not a header, and losing it would mean the
	// moved copy no longer survives a restart.
	if items[0].Properties["deliveryMode"] != "persistent" {
		t.Errorf("deliveryMode = %q, want persistent", items[0].Properties["deliveryMode"])
	}
}

// A move into nowhere must not eat the messages. Mandatory publishing plus the
// confirm is what turns that into a refusal rather than a silent drop.
func TestLiveMoveToNowhereLeavesTheSourceIntact(t *testing.T) {
	conn := liveConnNamed(t, "move-nowhere")
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const source = "mqs-test-move-nowhere"
	publishTestMessages(t, conn, source, []string{"precious"}, nil)

	moved, err := conn.MoveMessages(ctx, model.MoveRequest{
		Namespace: "/", From: source, ToRoutingKey: "mqs-test-no-such-queue", Limit: 10,
	})
	if err == nil {
		t.Error("moving into a routing key nothing is bound to reported success")
	}
	if moved != 0 {
		t.Errorf("moved = %d, want nothing moved", moved)
	}
	// The message is still in the source, which is the part that matters.
	waitForDepth(t, conn, source, 1)
}

// A batch limit has to be honoured, because moving is one round trip per
// message and a page asks for a batch rather than a whole backlog.
func TestLiveMoveHonoursTheBatchLimit(t *testing.T) {
	conn := liveConnNamed(t, "move-limit")
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const source = "mqs-test-move-limit-src"
	const target = "mqs-test-move-limit-dst"
	publishTestMessages(t, conn, source, []string{"a", "b", "c", "d", "e"}, nil)
	publishTestMessages(t, conn, target, nil, nil)

	moved, err := conn.MoveMessages(ctx, model.MoveRequest{
		Namespace: "/", From: source, ToRoutingKey: target, Limit: 2,
	})
	if err != nil {
		t.Fatalf("move: %v", err)
	}
	if moved != 2 {
		t.Errorf("moved %d, want the 2 asked for", moved)
	}
	waitForDepth(t, conn, source, 3)
	waitForDepth(t, conn, target, 2)
}

// Rebalancing is a no-op on a single node, which is exactly what it should be:
// it has to succeed rather than error, so the button is not permanently red on
// a development broker.
func TestLiveRebalanceSucceedsOnASingleNode(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	if err := conn.RebalanceQueues(context.Background()); err != nil {
		t.Errorf("rebalance: %v", err)
	}
}

// Declaring an exchange, binding it, unbinding it and deleting it - the whole
// life of a route through the driver's own methods.
func TestLiveRoutingLifecycle(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const exchange = "mqs-test-routing-ex"
	const queue = "mqs-test-routing-q"

	if err := conn.DeclareExchange(ctx, model.ExchangeSpec{
		Namespace: "/", Name: exchange, Type: "topic",
		Arguments: `{"alternate-exchange":"amq.fanout"}`,
	}); err != nil {
		t.Fatalf("declare exchange: %v", err)
	}
	t.Cleanup(func() { _ = conn.RemoveExchange(context.Background(), "/", exchange) })

	if err := conn.CreateDestination(ctx, model.DestinationSpec{
		Ref:        model.DestinationRef{Namespace: "/", Name: queue},
		Attributes: map[string]string{AttrDurable: "true"},
	}); err != nil {
		t.Fatalf("declare queue: %v", err)
	}
	t.Cleanup(func() {
		_ = conn.RemoveDestination(context.Background(),
			model.DestinationRef{Namespace: "/", Name: queue})
	})

	// The alternate exchange has to have survived the declaration, because it
	// is an argument rather than a field.
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
		t.Fatal("the exchange just declared is missing")
	}
	if declared.Attributes[AttrExchangeType] != "topic" {
		t.Errorf("type = %q, want topic", declared.Attributes[AttrExchangeType])
	}
	if !strings.Contains(declared.Attributes[AttrArguments], "alternate-exchange") {
		t.Errorf("the alternate exchange did not survive: %q", declared.Attributes[AttrArguments])
	}

	if err := conn.DeclareBinding(ctx, model.Binding{
		Namespace: "/", Source: exchange, Destination: queue,
		DestinationKind: "queue", RoutingKey: "order.*",
	}); err != nil {
		t.Fatalf("declare binding: %v", err)
	}

	// The listing has to carry the properties key, because that is the only
	// handle a delete has.
	find := func() *model.Binding {
		t.Helper()
		bindings, err := conn.ListBindings(ctx, "/")
		if err != nil {
			t.Fatalf("list bindings: %v", err)
		}
		for _, binding := range bindings {
			if binding.Source == exchange && binding.Destination == queue {
				return binding
			}
		}
		return nil
	}

	created := find()
	if created == nil {
		t.Fatal("the binding just declared is missing")
	}
	if created.PropertiesKey == "" {
		t.Fatal("the binding came back with no properties key, so it could never be deleted")
	}
	if created.RoutingKey != "order.*" {
		t.Errorf("routingKey = %q", created.RoutingKey)
	}

	if err := conn.RemoveBinding(ctx, *created); err != nil {
		t.Fatalf("remove binding: %v", err)
	}
	if find() != nil {
		t.Error("the binding survived its deletion")
	}
}

// Deleting a binding without the broker's key must be refused rather than
// guessed at: a binding has no name, and the same source, destination and key
// can exist more than once with different arguments.
func TestLiveRemoveBindingRefusesAGuess(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	err := conn.RemoveBinding(context.Background(), model.Binding{
		Namespace: "/", Source: "amq.topic", Destination: "whatever",
		DestinationKind: "queue", RoutingKey: "#",
	})
	if err == nil {
		t.Error("a binding delete with no properties key was attempted")
	}
}

// A headers binding is distinguished by its arguments alone, and two of them
// on the same source and destination have to stay two.
func TestLiveHeaderBindingsAreDistinguishedByArguments(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const exchange = "mqs-test-headers-ex"
	const queue = "mqs-test-headers-q"

	if err := conn.DeclareExchange(ctx, model.ExchangeSpec{
		Namespace: "/", Name: exchange, Type: "headers",
	}); err != nil {
		t.Fatalf("declare exchange: %v", err)
	}
	t.Cleanup(func() { _ = conn.RemoveExchange(context.Background(), "/", exchange) })

	if err := conn.CreateDestination(ctx, model.DestinationSpec{
		Ref:        model.DestinationRef{Namespace: "/", Name: queue},
		Attributes: map[string]string{AttrDurable: "true"},
	}); err != nil {
		t.Fatalf("declare queue: %v", err)
	}
	t.Cleanup(func() {
		_ = conn.RemoveDestination(context.Background(),
			model.DestinationRef{Namespace: "/", Name: queue})
	})

	for _, kind := range []string{"order", "invoice"} {
		if err := conn.DeclareBinding(ctx, model.Binding{
			Namespace: "/", Source: exchange, Destination: queue, DestinationKind: "queue",
			Arguments: map[string]string{"x-match": "all", "kind": kind},
		}); err != nil {
			t.Fatalf("declare binding for %q: %v", kind, err)
		}
	}

	bindings, err := conn.ListBindings(ctx, "/")
	if err != nil {
		t.Fatalf("list bindings: %v", err)
	}
	keys := map[string]bool{}
	count := 0
	for _, binding := range bindings {
		if binding.Source == exchange && binding.Destination == queue {
			count++
			keys[binding.PropertiesKey] = true
		}
	}
	if count != 2 {
		t.Errorf("found %d header bindings, want the 2 declared", count)
	}
	// Two bindings, two distinct keys - otherwise deleting one would delete
	// whichever the broker matched first.
	if len(keys) != count {
		t.Errorf("%d bindings share %d properties keys", count, len(keys))
	}
}

// Publishing with confirms, and every property surviving the round trip.
func TestLivePublishWithConfirms(t *testing.T) {
	conn := liveConnNamed(t, "publish")
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const queue = "mqs-test-publish"
	publishTestMessages(t, conn, queue, nil, nil)

	result, err := conn.Publish(ctx, model.PublishRequest{
		RoutingKey:    queue,
		Body:          `{"orderId":"1001"}`,
		Persistent:    true,
		Mandatory:     true,
		ContentType:   "application/json",
		CorrelationID: "corr-1",
		ReplyTo:       "reply.q",
		MessageID:     "msg-1",
		Headers:       map[string]string{"kind": "order"},
		Count:         3,
	})
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	if result.Sent != 3 {
		t.Errorf("sent = %d, want 3", result.Sent)
	}
	if result.Unroutable != 0 {
		t.Errorf("unroutable = %d, want none", result.Unroutable)
	}
	waitForDepth(t, conn, queue, 3)

	items, err := conn.QueryMessages(ctx, model.MessageQueryParams{Topic: queue, MaxResults: 1})
	if err != nil {
		t.Fatalf("browse: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("browsed %d, want 1", len(items))
	}
	item := items[0]
	for key, want := range map[string]string{
		"contentType":   "application/json",
		"correlationId": "corr-1",
		"replyTo":       "reply.q",
		"deliveryMode":  "persistent",
		"header.kind":   "order",
	} {
		if item.Properties[key] != want {
			t.Errorf("%s = %q, want %q", key, item.Properties[key], want)
		}
	}
	if item.MessageID != "msg-1" {
		t.Errorf("messageId = %q", item.MessageID)
	}
}

// The failure this console exists to make visible: a confirm is not routing.
// Without mandatory the broker drops the message and confirms it anyway, and
// a page reading only the confirm would call that a success.
func TestLiveUnroutablePublishIsReported(t *testing.T) {
	conn := liveConnNamed(t, "publish-unroutable")
	defer func() { _ = conn.Close() }()

	result, err := conn.Publish(context.Background(), model.PublishRequest{
		RoutingKey: "mqs-test-no-such-queue-at-all",
		Body:       "into the void",
		Persistent: true,
		Mandatory:  true,
		Count:      2,
	})
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	// The broker did take them, which is what a confirm means.
	if result.Sent != 2 {
		t.Errorf("sent = %d, want 2 confirmed", result.Sent)
	}
	// And handed both back, which is the part that matters.
	if result.Unroutable != 2 {
		t.Errorf("unroutable = %d, want 2 - a confirm is not routing", result.Unroutable)
	}
	if result.Reason == "" {
		t.Error("the broker's reason for handing them back was not reported")
	}
}

// The canonical publish is the rich one with the fields RabbitMQ has no
// counterpart for dropped - except the delay level, which is refused rather
// than silently ignored.
func TestLiveSendMessageRefusesADelayLevel(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	if _, err := conn.SendMessage(context.Background(), "any", "", "", "body", 3); err == nil {
		t.Error("a delay level was accepted; RabbitMQ has none, so the message would arrive at once")
	}
}

// Dropping acknowledges, which removes the messages from the broker with no
// dead-lettering and no copy anywhere. It has to be bounded: a purge cannot
// be, and "discard these ten and leave the rest" is the whole point.
func TestLiveDropDiscardsABoundedBatch(t *testing.T) {
	conn := liveConnNamed(t, "drop")
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const queue = "mqs-test-drop"
	publishTestMessages(t, conn, queue, []string{"a", "b", "c", "d", "e"}, nil)

	ref := model.DestinationRef{Namespace: "/", Name: queue}
	dropped, err := conn.DropMessages(ctx, ref, 2)
	if err != nil {
		t.Fatalf("drop: %v", err)
	}
	if dropped != 2 {
		t.Errorf("dropped %d, want the 2 asked for", dropped)
	}
	waitForDepth(t, conn, queue, 3)
}

// Dropping more than the queue holds takes what is there and stops, rather
// than waiting for messages that are not coming.
func TestLiveDropStopsWhenTheQueueRunsOut(t *testing.T) {
	conn := liveConnNamed(t, "drop-short")
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const queue = "mqs-test-drop-short"
	publishTestMessages(t, conn, queue, []string{"only one"}, nil)

	start := time.Now()
	dropped, err := conn.DropMessages(ctx, model.DestinationRef{Namespace: "/", Name: queue}, 100)
	if err != nil {
		t.Fatalf("drop: %v", err)
	}
	if dropped != 1 {
		t.Errorf("dropped %d, want the 1 that was there", dropped)
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Errorf("took %s to notice the queue had run out", elapsed)
	}
	waitForDepth(t, conn, queue, 0)
}

// The dead-letter round trip the board performs: a message is rejected, lands
// in the dead-letter queue, and is republished back to the queue it died in.
//
// Rejection rather than a TTL, because that is how dead letters actually
// happen and because a short TTL makes the republished message die again
// immediately - the move would then drain its own output in a loop.
func TestLiveRepublishADeadLetterToItsOrigin(t *testing.T) {
	conn := liveConnNamed(t, "republish")
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const exchange = "mqs-test-republish-dlx"
	const target = "mqs-test-republish-dlq"
	const source = "mqs-test-republish-src"

	steps := []func(*rabbithole.Client) (*http.Response, error){
		func(c *rabbithole.Client) (*http.Response, error) {
			return c.DeclareExchange("/", exchange, rabbithole.ExchangeSettings{Type: "fanout", Durable: true})
		},
		func(c *rabbithole.Client) (*http.Response, error) {
			return c.DeclareQueue("/", target, rabbithole.QueueSettings{Durable: true})
		},
		func(c *rabbithole.Client) (*http.Response, error) {
			return c.DeclareBinding("/", rabbithole.BindingInfo{
				Source: exchange, Destination: target, DestinationType: "queue",
			})
		},
		func(c *rabbithole.Client) (*http.Response, error) {
			return c.DeclareQueue("/", source, rabbithole.QueueSettings{
				Durable:   true,
				Arguments: map[string]interface{}{ArgDeadLetterExchange: exchange},
			})
		},
	}
	for _, step := range steps {
		if err := exec(ctx, conn.mgmt, step); err != nil {
			t.Fatalf("declare: %v", err)
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

	if err := conn.data.withChannel(ctx, func(channel *amqp.Channel) error {
		return channel.PublishWithContext(ctx, "", source, false, false, amqp.Publishing{
			Body: []byte("retry me"), DeliveryMode: amqp.Persistent,
		})
	}); err != nil {
		t.Fatalf("publish: %v", err)
	}
	waitForDepth(t, conn, source, 1)

	// Reject it without requeueing, which is what a consumer that cannot
	// process a message does and what actually fills a dead-letter queue.
	if err := conn.data.withChannel(ctx, func(channel *amqp.Channel) error {
		delivery, ok, err := channel.Get(source, false)
		if err != nil {
			return err
		}
		if !ok {
			return fmt.Errorf("nothing to reject")
		}
		return delivery.Nack(false, false)
	}); err != nil {
		t.Fatalf("reject: %v", err)
	}
	waitForDepth(t, conn, target, 1)

	moved, err := conn.MoveMessages(ctx, model.MoveRequest{
		Namespace: "/", From: target, ToRoutingKey: source, Limit: 10,
	})
	if err != nil {
		t.Fatalf("republish: %v", err)
	}
	if moved != 1 {
		t.Errorf("republished %d, want 1", moved)
	}
	// Back where it started, and the dead-letter queue is empty again.
	waitForDepth(t, conn, source, 1)
	waitForDepth(t, conn, target, 0)

	items, err := conn.QueryMessages(ctx, model.MessageQueryParams{Topic: source, MaxResults: 1})
	if err != nil {
		t.Fatalf("browse: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("browsed %d, want the republished message", len(items))
	}
	// The history survived the round trip, which is what tells whoever picks
	// it up next that this has already failed once.
	death := items[0].Properties["header.x-death"]
	if !strings.Contains(death, "reason=rejected") || !strings.Contains(death, "queue="+source) {
		t.Errorf("x-death did not survive the republish: %q", death)
	}
}

// Closing a connection, against a real one this test opens itself.
func TestLiveCloseClientConnection(t *testing.T) {
	subject := liveConnNamed(t, "close-target")
	defer func() { _ = subject.Close() }()
	observer := liveConnNamed(t, "close-observer")
	defer func() { _ = observer.Close() }()

	ctx := context.Background()
	if err := subject.data.ping(ctx); err != nil {
		t.Fatalf("amqp ping: %v", err)
	}

	name := waitForConnectionNamed(t, observer, connectionName("close-target"))
	if name == "" {
		t.Fatal("the connection to close never appeared")
	}

	if err := observer.CloseClientConnection(ctx, name, "closed by a test"); err != nil {
		t.Fatalf("close: %v", err)
	}
	if !waitForConnectionToGo(t, observer, name) {
		t.Errorf("connection %q is still listed after being closed", name)
	}
}

// Closing something already gone is the outcome that was asked for, not an
// error - the management API answers 404 and the driver treats it as done.
func TestLiveCloseAnAbsentConnectionSucceeds(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	err := conn.CloseClientConnection(context.Background(), "no-such-connection", "")
	if err != nil {
		t.Errorf("closing an absent connection reported an error: %v", err)
	}
}

func TestLiveCloseRefusesAnEmptyName(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	if err := conn.CloseClientConnection(context.Background(), "  ", "why"); err == nil {
		t.Error("a close with no connection name was attempted")
	}
	if err := conn.CloseUserConnections(context.Background(), "", "why"); err == nil {
		t.Error("a user close with no username was attempted")
	}
}

// The whole life of a virtual host, including the limits that live on their
// own endpoint.
func TestLiveNamespaceLifecycle(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const name = "mqs-test-vhost"

	if err := conn.CreateNamespace(ctx, model.NamespaceSpec{
		Name:             name,
		Description:      "created by a test",
		Tags:             []string{"testing"},
		DefaultQueueType: "quorum",
	}); err != nil {
		t.Fatalf("create: %v", err)
	}
	t.Cleanup(func() { _ = conn.RemoveNamespace(context.Background(), name) })

	find := func() *model.Namespace {
		t.Helper()
		namespaces, err := conn.ListNamespaces(ctx)
		if err != nil {
			t.Fatalf("list: %v", err)
		}
		for _, namespace := range namespaces {
			if namespace.Name == name {
				return namespace
			}
		}
		return nil
	}

	created := find()
	if created == nil {
		t.Fatal("the virtual host just created is missing")
	}
	if created.Description != "created by a test" {
		t.Errorf("description = %q", created.Description)
	}
	// The default queue type is the setting worth having, and the one most
	// likely to be dropped silently by a mapping.
	if created.DefaultQueueType != "quorum" {
		t.Errorf("defaultQueueType = %q, want quorum", created.DefaultQueueType)
	}
	// No limits set yet, and that has to read as absence rather than zero.
	if len(created.Limits) != 0 {
		t.Errorf("limits = %v, want none", created.Limits)
	}

	if err := conn.SetNamespaceLimit(ctx, name, LimitMaxQueues, 10); err != nil {
		t.Fatalf("set limit: %v", err)
	}
	limited := find()
	if limited == nil || limited.Limits[LimitMaxQueues] != 10 {
		t.Fatalf("limits = %v, want max-queues 10", limited.Limits)
	}

	// Removing a limit is not setting it to zero: zero forbids everything.
	if err := conn.RemoveNamespaceLimit(ctx, name, LimitMaxQueues); err != nil {
		t.Fatalf("remove limit: %v", err)
	}
	lifted := find()
	if lifted == nil {
		t.Fatal("the virtual host disappeared")
	}
	if _, present := lifted.Limits[LimitMaxQueues]; present {
		t.Errorf("the limit is still present as %v after being removed", lifted.Limits[LimitMaxQueues])
	}

	// Creating over an existing one updates it rather than failing, which is
	// what lets the dialog be create and edit at once.
	if err := conn.CreateNamespace(ctx, model.NamespaceSpec{
		Name: name, Description: "updated", DefaultQueueType: "classic",
	}); err != nil {
		t.Fatalf("update: %v", err)
	}
	updated := find()
	if updated == nil || updated.Description != "updated" || updated.DefaultQueueType != "classic" {
		t.Errorf("the update did not take: %+v", updated)
	}

	if err := conn.RemoveNamespace(ctx, name); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if find() != nil {
		t.Error("the virtual host survived its deletion")
	}
}

// A queue declared in a virtual host is invisible from another, which is the
// isolation the page exists to explain.
func TestLiveNamespacesAreIsolated(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const other = "mqs-test-isolated"
	const queue = "mqs-test-isolated-q"

	if err := conn.CreateNamespace(ctx, model.NamespaceSpec{Name: other}); err != nil {
		t.Fatalf("create vhost: %v", err)
	}
	t.Cleanup(func() { _ = conn.RemoveNamespace(context.Background(), other) })

	if err := conn.CreateDestination(ctx, model.DestinationSpec{
		Ref:        model.DestinationRef{Namespace: other, Name: queue},
		Attributes: map[string]string{AttrDurable: "true"},
	}); err != nil {
		t.Fatalf("declare queue: %v", err)
	}

	// Present in its own virtual host.
	inOther, err := conn.ListDestinations(ctx, model.DestinationFilter{Namespace: other})
	if err != nil {
		t.Fatalf("list in %q: %v", other, err)
	}
	found := false
	for _, destination := range inOther {
		if destination.Ref.Name == queue {
			found = true
		}
	}
	if !found {
		t.Errorf("the queue is missing from its own virtual host")
	}

	// Invisible from the root one.
	inRoot, err := conn.ListDestinations(ctx, model.DestinationFilter{Namespace: "/"})
	if err != nil {
		t.Fatalf("list in /: %v", err)
	}
	for _, destination := range inRoot {
		if destination.Ref.Name == queue {
			t.Errorf("a queue in %q is visible from the root virtual host", other)
		}
	}
}

// A user's whole life, and the two systems that decide what it can do.
func TestLiveIdentityLifecycle(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const name = "mqs-test-user"

	if err := conn.SaveIdentity(ctx, model.IdentitySpec{
		Name: name, Tags: []string{"management"}, Password: "s3cret",
	}); err != nil {
		t.Fatalf("create: %v", err)
	}
	t.Cleanup(func() { _ = conn.RemoveIdentity(context.Background(), name) })

	find := func() *model.Identity {
		t.Helper()
		identities, err := conn.ListIdentities(ctx)
		if err != nil {
			t.Fatalf("list: %v", err)
		}
		for _, identity := range identities {
			if identity.Name == name {
				return identity
			}
		}
		return nil
	}

	created := find()
	if created == nil {
		t.Fatal("the user just created is missing")
	}
	if len(created.Tags) != 1 || created.Tags[0] != "management" {
		t.Errorf("tags = %v, want management", created.Tags)
	}
	// The password never comes back; the hash being present is the only thing
	// that says one exists.
	if !created.HasPassword {
		t.Error("a user created with a password reports having none")
	}
	// A brand new user has no permissions anywhere, which is what makes it
	// unusable until one is granted.
	if len(created.Permissions) != 0 {
		t.Errorf("a new user already has permissions: %v", created.Permissions)
	}

	// Editing tags without knowing the password is the case the empty-password
	// path exists for.
	if err := conn.SaveIdentity(ctx, model.IdentitySpec{
		Name: name, Tags: []string{"monitoring", "policymaker"},
	}); err != nil {
		t.Fatalf("update tags: %v", err)
	}
	updated := find()
	if updated == nil || len(updated.Tags) != 2 {
		t.Fatalf("tags after update = %v", updated)
	}
	if !updated.HasPassword {
		t.Error("updating tags with an empty password wiped the stored password")
	}

	if err := conn.RemoveIdentity(ctx, name); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if find() != nil {
		t.Error("the user survived its deletion")
	}
}

// Permissions, and the distinction the page is built around: an empty pattern
// permits nothing, and no permission record at all is a different thing again.
func TestLivePermissionLifecycle(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const name = "mqs-test-perm-user"

	if err := conn.SaveIdentity(ctx, model.IdentitySpec{
		Name: name, Tags: []string{"management"}, Password: "s3cret",
	}); err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() { _ = conn.RemoveIdentity(context.Background(), name) })

	permissionsOf := func() []*model.NamespacePermission {
		t.Helper()
		identities, err := conn.ListIdentities(ctx)
		if err != nil {
			t.Fatalf("list: %v", err)
		}
		for _, identity := range identities {
			if identity.Name == name {
				return identity.Permissions
			}
		}
		t.Fatal("the user disappeared")
		return nil
	}

	// Consume-only, which is the preset with the most room to be wrong: read
	// everything, write and configure nothing.
	if err := conn.SetPermission(ctx, model.NamespacePermission{
		Namespace: "/", Identity: name, Configure: "", Write: "", Read: ".*",
	}); err != nil {
		t.Fatalf("set permission: %v", err)
	}

	granted := permissionsOf()
	if len(granted) != 1 {
		t.Fatalf("permissions = %d, want 1", len(granted))
	}
	if granted[0].Read != ".*" {
		t.Errorf("read = %q, want .*", granted[0].Read)
	}
	// The empty patterns have to survive as empty rather than being dropped or
	// defaulted, because empty is what denies.
	if granted[0].Write != "" || granted[0].Configure != "" {
		t.Errorf("write/configure = %q/%q, want both empty",
			granted[0].Write, granted[0].Configure)
	}

	// Revoking removes the record entirely, which is not the same as granting
	// nothing - the broker refuses the connection rather than admitting it.
	if err := conn.RemovePermission(ctx, "/", name); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if remaining := permissionsOf(); len(remaining) != 0 {
		t.Errorf("permissions after revoking = %v, want none", remaining)
	}
}

// Topic permissions are a filter over the permissions above rather than a
// grant of their own, and they live on their own endpoint.
func TestLiveTopicPermissions(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const name = "mqs-test-topic-perm"

	if err := conn.SaveIdentity(ctx, model.IdentitySpec{
		Name: name, Tags: []string{"management"}, Password: "s3cret",
	}); err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() { _ = conn.RemoveIdentity(context.Background(), name) })

	if err := conn.SetTopicPermission(ctx, model.TopicPermission{
		Namespace: "/", Identity: name, Exchange: "amq.topic",
		Write: "^order\\.", Read: "^order\\.",
	}); err != nil {
		t.Fatalf("set topic permission: %v", err)
	}

	found, err := conn.ListTopicPermissions(ctx)
	if err != nil {
		t.Fatalf("list topic permissions: %v", err)
	}
	var mine *model.TopicPermission
	for _, permission := range found {
		if permission.Identity == name {
			mine = permission
		}
	}
	if mine == nil {
		t.Fatal("the topic permission just set is missing")
	}
	if mine.Exchange != "amq.topic" || mine.Write != "^order\\." {
		t.Errorf("topic permission = %+v", mine)
	}

	if err := conn.RemoveTopicPermission(ctx, "/", name); err != nil {
		t.Fatalf("clear topic permission: %v", err)
	}
	after, err := conn.ListTopicPermissions(ctx)
	if err != nil {
		t.Fatalf("list after clear: %v", err)
	}
	for _, permission := range after {
		if permission.Identity == name {
			t.Error("the topic permission survived being cleared")
		}
	}
}

// Asking for a user with no password is a different instruction from leaving
// the field blank, and the broker has no way to express the difference - so
// the driver has to.
func TestLiveIdentityWithoutPasswordIsDeliberate(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const name = "mqs-test-nopassword"

	if err := conn.SaveIdentity(ctx, model.IdentitySpec{
		Name: name, Tags: []string{"management"}, WithoutPassword: true,
	}); err != nil {
		t.Fatalf("create: %v", err)
	}
	t.Cleanup(func() { _ = conn.RemoveIdentity(context.Background(), name) })

	find := func() *model.Identity {
		t.Helper()
		identities, err := conn.ListIdentities(ctx)
		if err != nil {
			t.Fatalf("list: %v", err)
		}
		for _, identity := range identities {
			if identity.Name == name {
				return identity
			}
		}
		return nil
	}

	created := find()
	if created == nil {
		t.Fatal("the user is missing")
	}
	if created.HasPassword {
		t.Error("a user created without a password reports having one")
	}

	// Giving it one afterwards works, and the flag not being set is what makes
	// the difference.
	if err := conn.SaveIdentity(ctx, model.IdentitySpec{
		Name: name, Tags: []string{"management"}, Password: "now-it-has-one",
	}); err != nil {
		t.Fatalf("set password: %v", err)
	}
	if withPassword := find(); withPassword == nil || !withPassword.HasPassword {
		t.Error("setting a password on a passwordless user did not take")
	}

	// And taking it away again is the flag, not a blank field.
	if err := conn.SaveIdentity(ctx, model.IdentitySpec{
		Name: name, Tags: []string{"management"}, WithoutPassword: true,
	}); err != nil {
		t.Fatalf("clear password: %v", err)
	}
	if cleared := find(); cleared == nil || cleared.HasPassword {
		t.Error("asking for no password left one in place")
	}
}

// The whole life of a policy, and the answer only the broker can give: which
// one actually applies to a queue.
func TestLivePolicyLifecycle(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const name = "mqs-test-policy"
	const queue = "mqs-test-policy-q"

	if err := conn.CreateDestination(ctx, model.DestinationSpec{
		Ref:        model.DestinationRef{Namespace: "/", Name: queue},
		Attributes: map[string]string{AttrDurable: "true"},
	}); err != nil {
		t.Fatalf("declare queue: %v", err)
	}
	t.Cleanup(func() {
		_ = conn.RemoveDestination(context.Background(),
			model.DestinationRef{Namespace: "/", Name: queue})
	})

	if err := conn.SavePolicy(ctx, model.Policy{
		Namespace: "/", Name: name, Pattern: "^mqs-test-policy-",
		ApplyTo: "queues", Priority: 5,
		Definition: `{"message-ttl":30000,"max-length":5000}`,
	}); err != nil {
		t.Fatalf("save policy: %v", err)
	}
	t.Cleanup(func() { _ = conn.RemovePolicy(context.Background(), "/", name, false) })

	find := func() *model.Policy {
		t.Helper()
		policies, err := conn.ListPolicies(ctx)
		if err != nil {
			t.Fatalf("list policies: %v", err)
		}
		for _, policy := range policies {
			if policy.Name == name {
				return policy
			}
		}
		return nil
	}

	saved := find()
	if saved == nil {
		t.Fatal("the policy just saved is missing")
	}
	if saved.Priority != 5 || saved.ApplyTo != "queues" {
		t.Errorf("priority/applyTo = %d/%q", saved.Priority, saved.ApplyTo)
	}
	if saved.Operator {
		t.Error("a user policy came back marked as an operator policy")
	}
	// The definition's integers have to have survived JSON's single number
	// type, exactly as queue arguments do.
	var definition map[string]interface{}
	if err := json.Unmarshal([]byte(saved.Definition), &definition); err != nil {
		t.Fatalf("definition is not decodable: %v", err)
	}
	if ttl, ok := definition["message-ttl"].(float64); !ok || ttl != 30000 {
		t.Errorf("message-ttl = %#v", definition["message-ttl"])
	}

	// The broker's own answer to which policy applies, which is the call that
	// makes this page worth having.
	matching, err := conn.MatchingPolicies(ctx,
		model.DestinationRef{Namespace: "/", Name: queue}, "queue")
	if err != nil {
		t.Fatalf("matching policies: %v", err)
	}
	found := false
	for _, policy := range matching {
		if policy.Name == name {
			found = true
		}
	}
	if !found {
		t.Errorf("the broker does not report %q as applying to %q", name, queue)
	}

	// The queue itself reports the policy that matched it, which is what the
	// queue detail panel shows. It polls: the broker attributes a new policy to
	// its matching queues asynchronously, so this is not true the instant the
	// policy is saved.
	if !waitForPolicyOn(t, conn, queue, name) {
		detail, _ := conn.DestinationDetail(ctx, model.DestinationRef{Namespace: "/", Name: queue})
		t.Errorf("the queue reports policy %q, want %q", detail.Attributes[AttrPolicy], name)
	}

	if err := conn.RemovePolicy(ctx, "/", name, false); err != nil {
		t.Fatalf("remove policy: %v", err)
	}
	if find() != nil {
		t.Error("the policy survived its deletion")
	}
}

func waitForPolicyOn(t *testing.T, conn *Conn, queue, policy string) bool {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for {
		detail, err := conn.DestinationDetail(context.Background(),
			model.DestinationRef{Namespace: "/", Name: queue})
		if err == nil && detail.Attributes[AttrPolicy] == policy {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(200 * time.Millisecond)
	}
}

// An operator policy is a different object on a different endpoint, and the
// listing has to keep them apart - it decides who can change one and which
// value wins where both set the same key.
func TestLiveOperatorPolicyIsMarkedApart(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const name = "mqs-test-operator-policy"

	if err := conn.SavePolicy(ctx, model.Policy{
		Namespace: "/", Name: name, Pattern: "^mqs-test-", ApplyTo: "queues",
		Definition: `{"max-length":100}`, Operator: true,
	}); err != nil {
		t.Fatalf("save operator policy: %v", err)
	}
	t.Cleanup(func() { _ = conn.RemovePolicy(context.Background(), "/", name, true) })

	policies, err := conn.ListPolicies(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	var mine *model.Policy
	for _, policy := range policies {
		if policy.Name == name {
			mine = policy
		}
	}
	if mine == nil {
		t.Fatal("the operator policy is missing from the listing")
	}
	if !mine.Operator {
		t.Error("an operator policy came back marked as a user policy")
	}
}

// Shovels and federation upstreams are stored as runtime parameters, which is
// why the page shows them - and why the driver only reads and deletes.
func TestLiveRuntimeParametersAreReadable(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	// A stock broker has none, which is a result rather than an error.
	parameters, err := conn.ListRuntimeParameters(context.Background())
	if err != nil {
		t.Fatalf("list runtime parameters: %v", err)
	}
	for _, parameter := range parameters {
		if parameter.Component == "" || parameter.Name == "" {
			t.Errorf("parameter %+v is missing a component or a name", parameter)
		}
		// The value crosses as JSON, because its shape belongs to the plugin.
		var decoded interface{}
		if err := json.Unmarshal([]byte(parameter.Value), &decoded); err != nil {
			t.Errorf("parameter %q has an undecodable value %q", parameter.Name, parameter.Value)
		}
	}
}

// Exporting, counting and importing - the whole document round trip.
func TestLiveDefinitionsRoundTrip(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const vhost = "mqs-test-definitions"
	const queue = "mqs-test-definitions-q"

	if err := conn.CreateNamespace(ctx, model.NamespaceSpec{Name: vhost}); err != nil {
		t.Fatalf("create vhost: %v", err)
	}
	t.Cleanup(func() { _ = conn.RemoveNamespace(context.Background(), vhost) })

	if err := conn.CreateDestination(ctx, model.DestinationSpec{
		Ref:        model.DestinationRef{Namespace: vhost, Name: queue},
		Attributes: map[string]string{AttrDurable: "true"},
	}); err != nil {
		t.Fatalf("declare queue: %v", err)
	}

	exported, err := conn.ExportDefinitions(ctx, vhost)
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	if exported.Counts[model.DefinitionQueues] < 1 {
		t.Errorf("the export counts %d queues, want at least the one declared",
			exported.Counts[model.DefinitionQueues])
	}
	// A single-vhost export carries no users: they are broker-wide, and
	// including them would put every password hash in a file about one
	// application.
	if exported.Counts[model.DefinitionUsers] != 0 {
		t.Errorf("a per-vhost export carries %d users", exported.Counts[model.DefinitionUsers])
	}

	// Counting a document without applying it is what the import step shows.
	counted, err := SummariseDefinitions(exported.Document)
	if err != nil {
		t.Fatalf("summarise: %v", err)
	}
	if counted[model.DefinitionQueues] != exported.Counts[model.DefinitionQueues] {
		t.Errorf("summary counts %d queues, the export counted %d",
			counted[model.DefinitionQueues], exported.Counts[model.DefinitionQueues])
	}

	// Delete the queue, then put the document back and check it returns.
	if err := conn.RemoveDestination(ctx, model.DestinationRef{Namespace: vhost, Name: queue}); err != nil {
		t.Fatalf("delete queue: %v", err)
	}
	if err := conn.ImportDefinitions(ctx, vhost, exported.Document); err != nil {
		t.Fatalf("import: %v", err)
	}
	if _, err := conn.DestinationDetail(ctx, model.DestinationRef{Namespace: vhost, Name: queue}); err != nil {
		t.Errorf("the queue did not come back from the import: %v", err)
	}
}

// A document that is not JSON has to be refused before it reaches the broker,
// because the failure there is far less legible.
func TestLiveImportRefusesNonsense(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	if err := conn.ImportDefinitions(context.Background(), "/", "not a document"); err == nil {
		t.Error("an unparsable document was sent to the broker")
	}
	if _, err := SummariseDefinitions("{oops"); err == nil {
		t.Error("an unparsable document was summarised")
	}
}

// A shovel, from declaration through running state to deletion.
//
// The state half is the point: a shovel that is defined and a shovel that is
// running are different facts, and the page exists to show the second.
func TestLiveShovelLifecycle(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const name = "mqs-test-shovel"
	const source = "mqs-test-shovel-src"
	const target = "mqs-test-shovel-dst"

	for _, queue := range []string{source, target} {
		if err := conn.CreateDestination(ctx, model.DestinationSpec{
			Ref:        model.DestinationRef{Namespace: "/", Name: queue},
			Attributes: map[string]string{AttrDurable: "true"},
		}); err != nil {
			t.Fatalf("declare %s: %v", queue, err)
		}
		t.Cleanup(func() {
			_ = conn.RemoveDestination(context.Background(),
				model.DestinationRef{Namespace: "/", Name: queue})
		})
	}

	// The password in the URI is what the page has to remove, so the test
	// declares one with a password rather than a bare address.
	const uri = "amqp://mqstudio:mqstudio@127.0.0.1:5672/%2F"
	if err := exec(ctx, conn.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.DeclareShovel("/", name, rabbithole.ShovelDefinition{
			SourceURI:        rabbithole.URISet{uri},
			DestinationURI:   rabbithole.URISet{uri},
			SourceQueue:      source,
			DestinationQueue: target,
			AckMode:          "on-confirm",
		})
	}); err != nil {
		t.Fatalf("declare shovel: %v", err)
	}
	t.Cleanup(func() { _ = conn.RemoveShovel(context.Background(), "/", name) })

	found := waitForShovel(t, conn, name)
	if found == nil {
		t.Fatalf("the declared shovel never appeared in the listing")
	}
	if found.Source != "queue "+source {
		t.Errorf("source = %q, want %q", found.Source, "queue "+source)
	}
	if found.Target != "queue "+target {
		t.Errorf("target = %q, want %q", found.Target, "queue "+target)
	}
	if found.AckMode != "on-confirm" {
		t.Errorf("ack mode = %q", found.AckMode)
	}
	// A shovel between two local queues has nothing to stop it, so anything
	// other than running means the driver is reading the wrong field.
	if found.State != "running" {
		t.Errorf("state = %q, want running", found.State)
	}

	/*
	 * The timestamp has to carry its zone. The broker reports UTC in a format
	 * with no marker, and passed through it was drawn beside times rendered in
	 * the reader's own zone - eight hours wrong for a reader eight hours from
	 * UTC. The unit test covers the conversion; this covers it being called.
	 */
	if found.Since == "" {
		t.Error("a running shovel reported no timestamp")
	} else if _, err := time.Parse(time.RFC3339, found.Since); err != nil {
		t.Errorf("state timestamp %q does not carry its zone: %v", found.Since, err)
	}

	// The credential must not survive the trip out of the driver: this page
	// is exactly the sort of thing that ends up in a screenshot.
	for _, address := range append(append([]string{}, found.SourceURI...), found.TargetURI...) {
		if strings.Contains(address, "mqstudio:mqstudio") {
			t.Errorf("a shovel URI carried its password out of the driver: %q", address)
		}
		if !strings.Contains(address, "127.0.0.1") {
			t.Errorf("redaction removed the host as well: %q", address)
		}
	}

	if err := conn.RemoveShovel(ctx, "/", name); err != nil {
		t.Fatalf("remove shovel: %v", err)
	}
	if waitForShovelToGo(t, conn, name) == false {
		t.Error("the shovel survived its deletion")
	}
}

// A shovel that moves messages actually moves them - which is what separates a
// definition the broker accepted from one that works.
func TestLiveShovelMovesMessages(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const name = "mqs-test-shovel-moves"
	const source = "mqs-test-shovel-moves-src"
	const target = "mqs-test-shovel-moves-dst"

	for _, queue := range []string{source, target} {
		if err := conn.CreateDestination(ctx, model.DestinationSpec{
			Ref:        model.DestinationRef{Namespace: "/", Name: queue},
			Attributes: map[string]string{AttrDurable: "true"},
		}); err != nil {
			t.Fatalf("declare %s: %v", queue, err)
		}
		t.Cleanup(func() {
			_ = conn.RemoveDestination(context.Background(),
				model.DestinationRef{Namespace: "/", Name: queue})
		})
	}

	if _, err := conn.SendMessage(ctx, source, "", "", "shovelled", 0); err != nil {
		t.Fatalf("publish: %v", err)
	}

	const uri = "amqp://mqstudio:mqstudio@127.0.0.1:5672/%2F"
	if err := exec(ctx, conn.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.DeclareShovel("/", name, rabbithole.ShovelDefinition{
			SourceURI:        rabbithole.URISet{uri},
			DestinationURI:   rabbithole.URISet{uri},
			SourceQueue:      source,
			DestinationQueue: target,
			AckMode:          "on-confirm",
		})
	}); err != nil {
		t.Fatalf("declare shovel: %v", err)
	}
	t.Cleanup(func() { _ = conn.RemoveShovel(context.Background(), "/", name) })

	waitForDepth(t, conn, target, 1)
	waitForDepth(t, conn, source, 0)
}

// A federation upstream, and the link that is its running half.
func TestLiveFederationUpstreamLifecycle(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const name = "mqs-test-upstream"

	const uri = "amqp://mqstudio:mqstudio@127.0.0.1:5672/%2F"
	if err := exec(ctx, conn.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.PutFederationUpstream("/", name, rabbithole.FederationDefinition{
			Uri:     rabbithole.URISet{uri},
			MaxHops: 2,
			AckMode: "on-confirm",
		})
	}); err != nil {
		t.Fatalf("declare upstream: %v", err)
	}
	t.Cleanup(func() { _ = conn.RemoveFederationUpstream(context.Background(), "/", name) })

	found := waitForUpstream(t, conn, name)
	if found == nil {
		t.Fatalf("the declared upstream never appeared in the listing")
	}
	if found.MaxHops != 2 {
		t.Errorf("max hops = %d, want 2", found.MaxHops)
	}
	if found.AckMode != "on-confirm" {
		t.Errorf("ack mode = %q", found.AckMode)
	}
	// Nothing is bound to this upstream, so it has no link - and an upstream
	// with no link is the case the page names rather than leaves blank.
	if found.State != "" && found.State != "running" {
		t.Errorf("state = %q, want running or none", found.State)
	}
	for _, address := range found.URI {
		if strings.Contains(address, "mqstudio:mqstudio") {
			t.Errorf("an upstream URI carried its password out of the driver: %q", address)
		}
	}

	if err := conn.RemoveFederationUpstream(ctx, "/", name); err != nil {
		t.Fatalf("remove upstream: %v", err)
	}
	upstreams, err := conn.ListFederationUpstreams(ctx)
	if err != nil {
		t.Fatalf("list upstreams: %v", err)
	}
	for _, upstream := range upstreams {
		if upstream.Name == name {
			t.Error("the upstream survived its deletion")
		}
	}
}

// The plugins are on in the e2e environment, so the capability must be plain
// supported. The degraded path is covered against a broker without them.
func TestLiveReplicationIsSupportedWhenThePluginsAreOn(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	capabilities := conn.Capabilities()
	if !capabilities.Has(model.CapReplication) {
		t.Fatal("replication is absent on a broker with the shovel plugin on")
	}
	if reason, degraded := capabilities.DegradedReason(model.CapReplication); degraded {
		t.Errorf("replication is degraded with %q on a broker that has the plugins", reason)
	}
}

// A shovel's definition and its status are two calls on the broker, and the
// status arrives on its own schedule: a new shovel reports no state, then
// starting, and only then whatever it settles on.
func waitForShovel(t *testing.T, conn *Conn, name string) *model.Shovel {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	var last *model.Shovel
	for {
		shovels, err := conn.ListShovels(context.Background())
		if err != nil {
			t.Fatalf("list shovels: %v", err)
		}
		for _, shovel := range shovels {
			if shovel.Name == name {
				last = shovel
				if shovel.State != "" && shovel.State != "starting" {
					return shovel
				}
			}
		}
		if time.Now().After(deadline) {
			return last
		}
		time.Sleep(250 * time.Millisecond)
	}
}

func waitForShovelToGo(t *testing.T, conn *Conn, name string) bool {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for {
		shovels, err := conn.ListShovels(context.Background())
		if err != nil {
			t.Fatalf("list shovels: %v", err)
		}
		gone := true
		for _, shovel := range shovels {
			if shovel.Name == name {
				gone = false
			}
		}
		if gone {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(250 * time.Millisecond)
	}
}

func waitForUpstream(t *testing.T, conn *Conn, name string) *model.FederationUpstream {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for {
		upstreams, err := conn.ListFederationUpstreams(context.Background())
		if err != nil {
			t.Fatalf("list upstreams: %v", err)
		}
		for _, upstream := range upstreams {
			if upstream.Name == name {
				return upstream
			}
		}
		if time.Now().After(deadline) {
			return nil
		}
		time.Sleep(250 * time.Millisecond)
	}
}

// A stream queue, and the clients the rest of this app cannot see.
//
// The stream protocol is not AMQP: its clients connect on their own port and
// never appear among a queue's consumers. This is the panel that says so, and
// what it must not do is report an error on a stream nobody is streaming.
func TestLiveStreamQueueReportsItsOwnClients(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	const stream = "mqs-test-stream"
	ref := model.DestinationRef{Namespace: "/", Name: stream}

	if err := conn.CreateDestination(ctx, model.DestinationSpec{
		Ref: ref,
		Attributes: map[string]string{
			AttrDurable:   "true",
			AttrQueueType: "stream",
		},
	}); err != nil {
		t.Fatalf("declare stream: %v", err)
	}
	t.Cleanup(func() { _ = conn.RemoveDestination(context.Background(), ref) })

	detail, err := conn.DestinationDetail(ctx, ref)
	if err != nil {
		t.Fatalf("read the stream back: %v", err)
	}
	if got := detail.Attributes[AttrQueueType]; got != "stream" {
		t.Fatalf("queue type = %q, want stream", got)
	}

	// Nothing is attached over the stream protocol, and that is a real answer
	// rather than a failure - the panel says so in a sentence.
	clients, err := conn.StreamClients(ctx, ref)
	if err != nil {
		t.Fatalf("stream clients: %v", err)
	}
	if clients == nil {
		t.Fatal("stream clients = nil, want an empty set")
	}
	if len(clients.Publishers) != 0 || len(clients.Consumers) != 0 {
		t.Errorf("a stream nobody is streaming reports %d publishers and %d consumers",
			len(clients.Publishers), len(clients.Consumers))
	}

	/*
	 * The separation this panel exists for: a stream read over AMQP is a
	 * normal consumer and belongs in the consumer list, not here. If a
	 * future change started folding AMQP consumers into this, the panel
	 * would double-count every one of them.
	 */
	if err := conn.data.withChannel(ctx, func(channel *amqp.Channel) error {
		// A stream consumer over AMQP needs a prefetch and an offset; the
		// broker refuses the subscription without them.
		if qosErr := channel.Qos(1, 0, false); qosErr != nil {
			return qosErr
		}
		if _, consumeErr := channel.Consume(stream, "mqs-test-stream-amqp",
			false, false, false, false, amqp.Table{"x-stream-offset": "first"}); consumeErr != nil {
			return consumeErr
		}

		attached, clientsErr := conn.StreamClients(ctx, ref)
		if clientsErr != nil {
			return clientsErr
		}
		if len(attached.Consumers) != 0 {
			t.Errorf("an AMQP consumer was counted as a stream protocol client: %+v",
				attached.Consumers)
		}
		return nil
	}); err != nil {
		t.Fatalf("consume over amqp: %v", err)
	}
}

// A stream in one virtual host must not report another's clients: the consumer
// endpoint is per-vhost and the filtering is this driver's job.
func TestLiveStreamClientsAreScopedToTheirStream(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	ctx := context.Background()
	for _, name := range []string{"mqs-test-stream-a", "mqs-test-stream-b"} {
		ref := model.DestinationRef{Namespace: "/", Name: name}
		if err := conn.CreateDestination(ctx, model.DestinationSpec{
			Ref:        ref,
			Attributes: map[string]string{AttrDurable: "true", AttrQueueType: "stream"},
		}); err != nil {
			t.Fatalf("declare %s: %v", name, err)
		}
		t.Cleanup(func() { _ = conn.RemoveDestination(context.Background(), ref) })

		clients, err := conn.StreamClients(ctx, ref)
		if err != nil {
			t.Fatalf("stream clients for %s: %v", name, err)
		}
		for _, consumer := range clients.Consumers {
			if consumer.Connection == "" {
				t.Errorf("%s reported a consumer with no connection", name)
			}
		}
	}
}

// The plugins are on in the e2e environment, so the capability is plainly
// supported. Its absence degrades rather than fails, which is covered against
// a broker without them.
func TestLiveStreamClientsAreSupportedWhenThePluginIsOn(t *testing.T) {
	conn := liveConn(t)
	defer func() { _ = conn.Close() }()

	capabilities := conn.Capabilities()
	if !capabilities.Has(model.CapStreamClients) {
		reason, _ := capabilities.DegradedReason(model.CapStreamClients)
		t.Fatalf("stream clients are unavailable on a broker with the plugin on: %q", reason)
	}
}

/*
 * The capability set the sidebar is derived from.
 *
 * The conformance check above proves every declared capability has an
 * implementation behind it. It cannot prove the set is the one the app was
 * built for: dropping a capability compiles, passes conformance, and silently
 * removes a finished page from the sidebar.
 *
 * The same list is asserted from the other side in
 * frontend/src/mq/navigation.rabbitmq.test.ts, which turns it into the pages a
 * connection can reach. Change one and this fails; change both deliberately
 * and neither does.
 */
func TestCapabilitiesMatchTheSidebarContract(t *testing.T) {
	want := []model.Capability{
		"destination.list", "destination.create", "destination.delete",
		"destination.purge", "destination.move", "destination.rebalance",
		"subscription.list", "subscription.lag",
		"message.query", "message.dlqTopology", "message.publish", "message.publishRich",
		"cluster.topology", "cluster.metrics", "cluster.census",
		"client.inspect", "client.close", "cluster.health",
		"namespace.list", "namespace.admin", "namespace.limits",
		"identity.list", "identity.admin", "identity.permissions",
		"policy.list", "policy.admin", "parameter.admin",
		"definitions.export", "definitions.import",
		"replication.admin", "stream.clients",
		"routing.exchanges", "routing.admin",
	}

	declared := map[model.Capability]bool{}
	for _, capability := range capabilities() {
		declared[capability] = true
	}
	expected := map[model.Capability]bool{}
	for _, capability := range want {
		expected[capability] = true
		if !declared[capability] {
			t.Errorf("%s is no longer declared; its page has left the sidebar", capability)
		}
	}
	for _, capability := range capabilities() {
		if !expected[capability] {
			t.Errorf("%s is newly declared; add it to navigation.rabbitmq.test.ts too", capability)
		}
	}

	/*
	 * RocketMQ's access capability stays absent on purpose. Its port is shaped
	 * around access keys and topic/group rules; RabbitMQ has users and
	 * per-vhost permission regexes, and two of the five methods have no
	 * counterpart at all. The permissions page is reached through the identity
	 * capability instead.
	 */
	if declared[model.CapAccessControl] {
		t.Error("declares access.control, which is RocketMQ's ACL shape rather than RabbitMQ's")
	}
	if !declared[model.CapIdentityList] {
		t.Error("does not declare identity.list, so the permissions page is unreachable")
	}
}
