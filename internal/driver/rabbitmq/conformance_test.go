package rabbitmq

import (
	"context"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

// liveEndpoint is the environment tests/e2e/rabbitmq brings up. Tests skip
// rather than fail when it is not running, so a checkout without docker still
// has a green suite.
const liveEndpoint = "http://127.0.0.1:15672"

func liveConn(t *testing.T) *Conn {
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

	profile := model.ConnectionProfile{
		Kind:      model.KindRabbitMQ,
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
