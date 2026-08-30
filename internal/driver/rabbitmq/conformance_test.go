package rabbitmq

import (
	"context"
	"net/http"
	"os"
	"testing"
	"time"

	rabbithole "github.com/michaelklishin/rabbit-hole/v3"

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
