package rocketmq_test

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/driver/rocketmq"
	"github.com/amigoer/mq-studio/internal/e2e"
	"github.com/amigoer/mq-studio/internal/model"
)

// These run against the broker `npm run e2e:up` starts. Locally they are
// opt-in, so the rest of the suite passes with nothing listening; CI starts
// the broker and the opt-in does not apply there. See internal/e2e.
//
//	npm run e2e:up && MQ_STUDIO_E2E=1 go test ./internal/driver/rocketmq/...
const liveNameServer = "127.0.0.1:9876"

func liveContext(t *testing.T) context.Context {
	t.Helper()
	e2e.Require(t, e2e.Env{
		Name:  "the rocketmq broker",
		Start: "npm run e2e:up",
		Probe: e2e.DialTCP(liveNameServer),
	})
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func liveProfile(id int, name string) model.ConnectionProfile {
	return model.ConnectionProfile{
		ID:         id,
		Name:       name,
		Kind:       model.KindRocketMQ,
		Endpoints:  liveNameServer,
		TimeoutSec: 5,
	}
}

func newLiveRegistry(t *testing.T) *driver.Registry {
	t.Helper()
	// Register is process-wide and panics on a duplicate, so it is done once
	// here rather than per test.
	if _, ok := driver.Lookup(model.KindRocketMQ); !ok {
		driver.Register(rocketmq.New())
	}
	registry := driver.NewRegistry()
	t.Cleanup(registry.CloseAll)
	return registry
}

// The case the shared client got wrong: two profiles naming one NameServer are
// two connections, and closing either must leave the other working.
func TestLiveTwoProfilesOnOneNameServerAreIndependent(t *testing.T) {
	ctx := liveContext(t)
	registry := newLiveRegistry(t)

	for _, profile := range []model.ConnectionProfile{liveProfile(1, "first"), liveProfile(2, "second")} {
		if err := registry.Open(ctx, profile); err != nil {
			t.Fatalf("open %s: %v", profile.Name, err)
		}
	}

	first, ok := registry.Get(1)
	if !ok {
		t.Fatal("connection 1 is missing from the registry")
	}
	second, ok := registry.Get(2)
	if !ok {
		t.Fatal("connection 2 is missing from the registry")
	}
	if first == second {
		t.Fatal("both profiles resolved to the same connection")
	}

	if _, err := first.(driver.DestinationAdmin).ListDestinations(ctx, model.DestinationFilter{}); err != nil {
		t.Fatalf("list topics on connection 1: %v", err)
	}

	registry.Close(1)
	if _, stillOpen := registry.Get(1); stillOpen {
		t.Fatal("a closed connection is still in the registry")
	}
	if _, err := second.(driver.ClusterAdmin).ClusterOverview(ctx); err != nil {
		t.Fatalf("connection 2 broke when connection 1 closed: %v", err)
	}
}

// Reopening under the same id is what reconnecting from the UI does.
func TestLiveReopenUnderTheSameID(t *testing.T) {
	ctx := liveContext(t)
	registry := newLiveRegistry(t)

	for attempt := range 2 {
		if err := registry.Open(ctx, liveProfile(1, "first")); err != nil {
			t.Fatalf("open attempt %d: %v", attempt+1, err)
		}
	}
	conn, ok := registry.Get(1)
	if !ok {
		t.Fatal("connection missing after reopen")
	}
	if err := conn.Ping(ctx); err != nil {
		t.Fatalf("ping after reopen: %v", err)
	}
}

// A Proxy endpoint has no admin plane, so it is refused with an explanation
// rather than dialled and failing somewhere deep in the first admin call.
func TestLiveProxyProfileIsRefused(t *testing.T) {
	ctx := liveContext(t)
	registry := newLiveRegistry(t)

	profile := liveProfile(3, "proxy")
	profile.SetOption(rocketmq.OptionAccess, rocketmq.AccessProxy)
	if err := registry.Open(ctx, profile); err == nil {
		t.Fatal("a Proxy profile was accepted")
	}
}

// The namespace fixtures npm run e2e:seed creates. The namespaced pair carries
// its own base names on purpose: seeded under the same ones, a scoped and an
// unscoped connection would both show "MQ_STUDIO_E2E" and no assertion here
// could tell the two views apart.
const (
	liveNamespace      = "NS_E2E"
	liveUnscopedTopic  = "MQ_STUDIO_E2E"
	liveNamespacedName = "MQ_STUDIO_E2E_NS"
	liveNamespacedRaw  = liveNamespace + "%" + liveNamespacedName
	liveNamespacedGrp  = "MQ_STUDIO_E2E_NS_GROUP"
)

// liveConn opens one connection, optionally scoped to the seeded namespace.
func liveConn(t *testing.T, id int, name, namespace string) driver.Conn {
	t.Helper()
	ctx := liveContext(t)
	registry := newLiveRegistry(t)
	profile := liveProfile(id, name)
	if namespace != "" {
		profile.SetOption(rocketmq.OptionNamespace, namespace)
	}
	if err := registry.Open(ctx, profile); err != nil {
		t.Fatalf("open %s: %v", name, err)
	}
	conn, ok := registry.Get(id)
	if !ok {
		t.Fatalf("connection %s missing after open", name)
	}
	return conn
}

func liveTopicNames(t *testing.T, conn driver.Conn) []string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	destinations, err := conn.(driver.DestinationAdmin).ListDestinations(ctx, model.DestinationFilter{})
	if err != nil {
		t.Fatalf("list destinations: %v", err)
	}
	names := make([]string, 0, len(destinations))
	for _, destination := range destinations {
		names = append(names, destination.Ref.Name)
	}
	return names
}

func contains(names []string, want string) bool {
	return slices.Contains(names, want)
}

// The whole point of a namespace, in one assertion each way: a scoped
// connection sees its own topics under their short names and nothing else, and
// an unscoped one sees the cluster as it really is.
func TestLiveNamespaceScopesTheTopicList(t *testing.T) {
	scoped := liveTopicNames(t, liveConn(t, 40, "scoped", liveNamespace))
	if !contains(scoped, liveNamespacedName) {
		t.Fatalf("a scoped connection did not list %s (run `npm run e2e:seed`); got %v",
			liveNamespacedName, scoped)
	}
	if contains(scoped, liveNamespacedRaw) {
		t.Fatalf("a scoped connection showed the broker-real name %s", liveNamespacedRaw)
	}
	if contains(scoped, liveUnscopedTopic) {
		t.Fatalf("a scoped connection showed %s, which belongs to no namespace", liveUnscopedTopic)
	}

	unscoped := liveTopicNames(t, liveConn(t, 41, "unscoped", ""))
	if !contains(unscoped, liveUnscopedTopic) || !contains(unscoped, liveNamespacedRaw) {
		t.Fatalf("an unscoped connection must still see the cluster whole; got %v", unscoped)
	}
	if contains(unscoped, liveNamespacedName) {
		t.Fatalf("an unscoped connection stripped a namespace it was not given")
	}
}

// Consumer groups take the same path as topics and are worth their own case:
// the group list is assembled per broker rather than from the name server.
func TestLiveNamespaceScopesTheConsumerGroups(t *testing.T) {
	ctx := liveContext(t)
	conn := liveConn(t, 42, "scoped-groups", liveNamespace)

	subscriptions, err := conn.(driver.SubscriptionAdmin).ListSubscriptions(ctx)
	if err != nil {
		t.Fatalf("list subscriptions: %v", err)
	}
	names := make([]string, 0, len(subscriptions))
	for _, subscription := range subscriptions {
		names = append(names, subscription.Ref.Name)
	}
	if !contains(names, liveNamespacedGrp) {
		e2e.Missing(t, "the namespaced consumer group %s is not seeded; run `npm run e2e:seed` (got %v)",
			liveNamespacedGrp, names)
	}
	if contains(names, "MQ_STUDIO_E2E_GROUP") {
		t.Fatalf("a scoped connection showed the unscoped group; got %v", names)
	}
}

// What the list tests cannot prove: that the namespace reached the wire. The
// topic is created through the scoped connection and looked for through an
// unscoped one, which sees whatever the broker actually stored.
func TestLiveNamespaceTopicLifecycleReachesTheBroker(t *testing.T) {
	ctx := liveContext(t)
	scoped := liveConn(t, 43, "scoped-lifecycle", liveNamespace)
	unscoped := liveConn(t, 44, "unscoped-witness", "")

	const short = "MQ_STUDIO_E2E_NS_LIFECYCLE"
	raw := liveNamespace + "%" + short
	ref := model.DestinationRef{Name: short}
	admin := scoped.(driver.DestinationAdmin)
	t.Cleanup(func() { _ = admin.RemoveDestination(context.Background(), ref) })

	if err := admin.CreateDestination(ctx, model.DestinationSpec{
		Ref: ref,
		Attributes: map[string]string{
			rocketmq.AttrReadQueue:  "2",
			rocketmq.AttrWriteQueue: "2",
			rocketmq.AttrPerm:       string(model.PermRW),
		},
	}); err != nil {
		t.Fatalf("create through a scoped connection: %v", err)
	}

	if !contains(liveTopicNames(t, unscoped), raw) {
		t.Fatalf("the broker stored something other than %s", raw)
	}
	if _, err := admin.DestinationDetail(ctx, ref); err != nil {
		t.Fatalf("detail through a scoped connection: %v", err)
	}

	if err := admin.RemoveDestination(ctx, ref); err != nil {
		t.Fatalf("delete through a scoped connection: %v", err)
	}
	if contains(liveTopicNames(t, unscoped), raw) {
		t.Fatalf("%s survived a delete through the scoped connection", raw)
	}
}

// The publish path is the one that used to fail silently: without the wrap a
// message went to a topic of the short name, which on an auto-create broker is
// a new topic nobody reads.
func TestLiveNamespaceSendThenQuery(t *testing.T) {
	ctx := liveContext(t)
	scoped := liveConn(t, 45, "scoped-send", liveNamespace)
	unscoped := liveConn(t, 46, "unscoped-send-witness", "")

	key := "ns-e2e-" + time.Now().UTC().Format("20060102150405.000")
	body := `{"probe":"` + key + `"}`
	if _, err := scoped.(driver.MessagePublisher).SendMessage(
		ctx, liveNamespacedName, "probe", key, body, 0); err != nil {
		t.Fatalf("send through a scoped connection: %v", err)
	}

	// The broker indexes by key asynchronously, so this is retried rather than
	// run once and called a failure.
	find := func(conn driver.Conn, topic string) []*model.MessageItem {
		t.Helper()
		for attempt := range 10 {
			if attempt > 0 {
				time.Sleep(500 * time.Millisecond)
			}
			found, err := conn.(driver.MessageReader).QueryMessages(ctx, model.MessageQueryParams{
				Topic: topic, MessageKey: key, MaxResults: 8,
			})
			if err == nil && len(found) > 0 {
				return found
			}
		}
		return nil
	}

	found := find(scoped, liveNamespacedName)
	if len(found) == 0 {
		t.Fatalf("the message sent under key %s never came back through the scoped connection", key)
	}
	if found[0].Body != body {
		t.Fatalf("body = %q, want %q", found[0].Body, body)
	}
	// Short on the way out, whatever it is on the wire.
	if found[0].Topic != liveNamespacedName {
		t.Fatalf("Topic = %q, want %q", found[0].Topic, liveNamespacedName)
	}

	// And the witness: the broker really holds it under the namespaced name.
	if len(find(unscoped, liveNamespacedRaw)) == 0 {
		t.Fatalf("the broker does not hold the message under %s", liveNamespacedRaw)
	}
}
