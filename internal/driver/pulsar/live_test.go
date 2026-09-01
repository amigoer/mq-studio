package pulsar

import (
	"context"
	"fmt"
	"testing"
	"time"

	pulsarclient "github.com/apache/pulsar-client-go/pulsar"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/e2e"
	"github.com/amigoer/mq-studio/internal/model"
)

const (
	liveService = "pulsar://127.0.0.1:6650"
	liveAdmin   = "http://127.0.0.1:8080"
)

func requireLiveCluster(t *testing.T) {
	t.Helper()
	e2e.Require(t, e2e.Env{
		Name:  "pulsar",
		Start: "npm run e2e:pulsar:up",
		// The admin plane, not the broker port: standalone binds 6650 before
		// the broker has registered, so a dial would pass against a cluster
		// that cannot answer anything yet.
		Probe: e2e.HTTPGet(liveAdmin + "/admin/v2/brokers/health"),
	})
}

// liveProfile is what the connection form produces for the compose cluster.
func liveProfile() model.ConnectionProfile {
	return model.ConnectionProfile{
		Name:       "pulsar-e2e",
		Kind:       model.KindPulsar,
		Endpoints:  liveService,
		TimeoutSec: 10,
		Options: map[string]string{
			OptionAdminURL:  liveAdmin,
			OptionTenant:    defaultTenant,
			OptionNamespace: defaultNamespace,
		},
	}
}

func liveConn(t *testing.T) *Conn {
	t.Helper()
	requireLiveCluster(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	opened, err := New().Open(ctx, liveProfile())
	if err != nil {
		t.Fatalf("open the live cluster: %v", err)
	}
	t.Cleanup(func() { _ = opened.Close() })

	conn, ok := opened.(*Conn)
	if !ok {
		t.Fatalf("Open returned %T, want *Conn", opened)
	}
	return conn
}

// The connection the app makes, against the cluster the app will meet.
//
// Everything else in this package is tested against a fake, which proves the
// driver's own logic and nothing about whether the two libraries agree with a
// real broker on the wire.
func TestLiveOpenAndPing(t *testing.T) {
	conn := liveConn(t)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if err := conn.Ping(ctx); err != nil {
		t.Fatalf("ping the live cluster: %v", err)
	}
	if conn.Kind() != model.KindPulsar {
		t.Errorf("kind = %q, want pulsar", conn.Kind())
	}
}

// Conformance against a live connection, not only an offline one.
//
// The offline test proves the type is consistent; this proves the capability
// set the probe actually produces is too. They differ whenever probing
// degrades something, which is the case the UI reads.
func TestLiveConnDeclaresOnlyWhatItImplements(t *testing.T) {
	conn := liveConn(t)

	if problems := driver.CheckConformance(conn); len(problems) != 0 {
		for _, problem := range problems {
			t.Error(problem)
		}
	}
}

// A cluster that answers degrades nothing.
//
// This is the test that fails when a capability is declared before its port
// works against a real broker: the probe would degrade it and the sidebar
// would draw a disabled page with an explanation the cluster never gave.
func TestLiveClusterDegradesNothing(t *testing.T) {
	conn := liveConn(t)

	for capability, reason := range conn.Capabilities().Degraded {
		t.Errorf("%s is degraded against a healthy cluster: %s", capability, reason)
	}
}

/*
 * The two planes are judged separately, and the admin plane survives a broker
 * port that is shut.
 *
 * A profile pointed at a real web service and a dead broker port is what a
 * half-configured ingress looks like. Reported as one failure it takes every
 * listing away, and an operator sees an empty app rather than the one page
 * that is actually broken.
 */
func TestLiveAdminAndDataPlanesFailSeparately(t *testing.T) {
	requireLiveCluster(t)

	profile := liveProfile()
	// Port 1 is reserved and never bound, so this is the live admin plane
	// beside a data plane that cannot be dialled.
	profile.Endpoints = "pulsar://127.0.0.1:1"

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	opened, err := New().Open(ctx, profile)
	if err != nil {
		t.Fatalf("open with a shut broker port: %v", err)
	}
	defer func() { _ = opened.Close() }()

	conn, ok := opened.(*Conn)
	if !ok {
		t.Fatalf("Open returned %T, want *Conn", opened)
	}
	if err := conn.pingAdmin(ctx); err != nil {
		t.Errorf("the admin plane failed because the broker port is shut: %v", err)
	}
	if err := conn.pingDataPlane(ctx); err == nil {
		t.Error("the data plane probe passed against a port nothing is listening on")
	}
}

// A profile scoped to a tenant that is not there is a configuration mistake,
// and it has to read as one. Reported as "unreachable" it sends an operator to
// check a network that was fine.
func TestLiveMissingTenantReadsAsAMissingTenant(t *testing.T) {
	requireLiveCluster(t)

	profile := liveProfile()
	profile.Options[OptionTenant] = "a-tenant-that-does-not-exist"

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	opened, err := New().Open(ctx, profile)
	if err != nil {
		t.Fatalf("open against a missing tenant: %v", err)
	}
	defer func() { _ = opened.Close() }()

	conn, ok := opened.(*Conn)
	if !ok {
		t.Fatalf("Open returned %T, want *Conn", opened)
	}
	err = conn.pingAdmin(ctx)
	if err == nil {
		t.Fatal("listing a missing tenant's namespaces succeeded")
	}
	if got := degradeReason(err); got != tenantMissing {
		t.Errorf("degradeReason = %q, want %q", got, tenantMissing)
	}
}

// The cluster page's own reads, against a real broker.
//
// The unit tests prove the mapping from a load report; only a live cluster
// proves the calls behind it exist, answer, and agree with the shapes
// pulsaradmin declares.
func TestLiveClusterOverviewCountsTheStandaloneBroker(t *testing.T) {
	conn := liveConn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	overview, err := conn.ClusterOverview(ctx)
	if err != nil {
		t.Fatalf("ClusterOverview: %v", err)
	}
	if overview.Name == "" {
		t.Error("the overview names no cluster")
	}
	if overview.OnlineNodes < 1 {
		t.Errorf("online brokers = %d, want at least one", overview.OnlineNodes)
	}

	nodes, err := conn.ListNodes(ctx)
	if err != nil {
		t.Fatalf("ListNodes: %v", err)
	}
	if len(nodes) != overview.TotalNodes {
		t.Errorf("listed %d brokers, the overview counted %d", len(nodes), overview.TotalNodes)
	}
	for _, node := range nodes {
		if node.Address == "" {
			t.Error("a broker was listed with no address")
		}
		if node.Status != model.NodeOnline {
			t.Errorf("%s is in the active listing with status %q", node.Address, node.Status)
		}
	}
}

/*
 * The compose cluster runs a real load manager, so its figures must arrive.
 *
 * This is the assertion that would have caught the environment being wrong:
 * standalone defaults to NoopLoadManager, which answers 204 here, and every
 * rate on the cluster page would have been silently unknown in CI while
 * working against any real deployment.
 */
func TestLiveBrokerReportsItsOwnFigures(t *testing.T) {
	conn := liveConn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	report := conn.loadReport(ctx)
	if report == nil {
		t.Fatal("the cluster published no load report; check loadManagerClassName in the compose file")
	}

	nodes, err := conn.ListNodes(ctx)
	if err != nil {
		t.Fatalf("ListNodes: %v", err)
	}
	described := 0
	for _, node := range nodes {
		if node.RateIn != model.UnknownMetric {
			described++
			if node.Version == "" {
				t.Errorf("%s has rates but no version", node.Address)
			}
			if node.Attributes[AttrNodeBundles] == "" {
				t.Errorf("%s has rates but no bundle count", node.Address)
			}
		}
	}
	if described != 1 {
		t.Errorf("%d brokers carry the load report, want exactly the one that served it", described)
	}
}

// Metrics stay supported against a cluster that publishes figures. The mirror
// of the unit test that degrades them when it does not.
func TestLiveMetricsAreNotDegraded(t *testing.T) {
	conn := liveConn(t)

	if reason, degraded := conn.Capabilities().DegradedReason(model.CapClusterMetrics); degraded {
		t.Errorf("metrics degraded against a cluster with a load manager: %s", reason)
	}
}

func TestLiveHealthCheckPasses(t *testing.T) {
	conn := liveConn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	health, err := conn.Health(ctx)
	if err != nil {
		t.Fatalf("Health: %v", err)
	}
	for _, check := range health.Checks {
		if !check.Passed {
			t.Errorf("check %q failed: %s", check.ID, check.Reason)
		}
	}
}

// The configuration pages read whatever the broker is running with. Both calls
// are separate endpoints and either can need a superuser, so both are worth a
// live assertion rather than only the mapping.
func TestLiveBrokerConfigurationIsReadable(t *testing.T) {
	conn := liveConn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	config, err := conn.NodeConfig(ctx, "")
	if err != nil {
		t.Fatalf("NodeConfig: %v", err)
	}
	// The one this compose file sets, which proves the read reached the broker
	// rather than returning an empty map that would also have passed.
	if config["allowAutoTopicCreation"] != "false" {
		t.Errorf("allowAutoTopicCreation = %q, want the compose file's false",
			config["allowAutoTopicCreation"])
	}

	directory, err := conn.DirectoryConfig(ctx)
	if err != nil {
		t.Fatalf("DirectoryConfig: %v", err)
	}
	if directory["metadataStoreUrl"] == "" {
		t.Error("the metadata store address is empty")
	}
}

/*
 * A tenant and a namespace, created and removed against a real cluster.
 *
 * The unit tests prove the mapping from a policies document; only a live
 * cluster proves the create actually takes the shape pulsaradmin sends, that
 * the limit calls reach the endpoints they name, and that a delete of a
 * non-empty object is refused rather than silently succeeding.
 */
func TestLiveTenantAndNamespaceRoundTrip(t *testing.T) {
	conn := liveConn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	const tenant = "mq-studio-e2e-tenant"
	const namespace = tenant + "/orders"

	// Idempotent: a previous run that failed part way leaves these behind, and
	// a suite that only passes on a clean cluster is a suite nobody can rerun.
	_ = conn.RemoveNamespace(ctx, namespace)
	_ = conn.RemoveTenant(ctx, tenant)

	if err := conn.SaveTenant(ctx, TenantSpec{Name: tenant}); err != nil {
		t.Fatalf("create tenant: %v", err)
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		_ = conn.RemoveNamespace(cleanup, namespace)
		_ = conn.RemoveTenant(cleanup, tenant)
	})

	tenants, err := conn.Tenants(ctx)
	if err != nil {
		t.Fatalf("list tenants: %v", err)
	}
	var created *Tenant
	for _, candidate := range tenants {
		if candidate.Name == tenant {
			created = candidate
		}
	}
	if created == nil {
		t.Fatalf("the tenant just created is not in the listing")
	}
	// A tenant with no allowed cluster can hold no namespace anywhere, so a
	// blank form has to default to the local one rather than storing nothing.
	if len(created.AllowedClusters) == 0 {
		t.Error("a tenant created with no clusters was stored with none, and can hold nothing")
	}

	if err := conn.CreateNamespace(ctx, model.NamespaceSpec{Name: namespace}); err != nil {
		t.Fatalf("create namespace: %v", err)
	}

	// A tenant that still holds a namespace cannot be deleted, and the refusal
	// is what the page shows rather than a delete that appears to work.
	if err := conn.RemoveTenant(ctx, tenant); err == nil {
		t.Error("a tenant holding a namespace was deleted")
	}

	if err := conn.RemoveNamespace(ctx, namespace); err != nil {
		t.Fatalf("delete namespace: %v", err)
	}
	if err := conn.RemoveTenant(ctx, tenant); err != nil {
		t.Fatalf("delete the now-empty tenant: %v", err)
	}
}

/*
 * Setting a limit, reading it back, and clearing it are three different calls
 * and all three have to reach the broker.
 *
 * Clearing is the one worth a live test: it is a DELETE to a different
 * endpoint than the PUT that set it, so a driver that sent zero instead would
 * pass every unit test and leave a namespace capped at nothing.
 */
func TestLiveNamespaceLimitRoundTrip(t *testing.T) {
	conn := liveConn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	const namespace = "public/default"

	if err := conn.SetNamespaceLimit(ctx, namespace, LimitMessageTTLSeconds, 3600); err != nil {
		t.Fatalf("set the message TTL: %v", err)
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		_ = conn.RemoveNamespaceLimit(cleanup, namespace, LimitMessageTTLSeconds)
	})

	if got := liveLimit(t, conn, namespace, LimitMessageTTLSeconds); got == nil || *got != 3600 {
		t.Fatalf("message TTL after set = %v, want 3600", got)
	}

	if err := conn.RemoveNamespaceLimit(ctx, namespace, LimitMessageTTLSeconds); err != nil {
		t.Fatalf("remove the message TTL: %v", err)
	}
	if got := liveLimit(t, conn, namespace, LimitMessageTTLSeconds); got != nil && *got != 0 {
		t.Errorf("message TTL after remove = %d, want it back at the broker's default", *got)
	}
}

// liveLimit reads one limit off the live namespace listing.
func liveLimit(t *testing.T, conn *Conn, namespace, limit string) *int {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	namespaces, err := conn.ListNamespaces(ctx)
	if err != nil {
		t.Fatalf("ListNamespaces: %v", err)
	}
	for _, candidate := range namespaces {
		if candidate.Name != namespace {
			continue
		}
		if value, ok := candidate.Limits[limit]; ok {
			return &value
		}
		return nil
	}
	t.Fatalf("%s is not in the namespace listing", namespace)
	return nil
}

/*
 * A topic created and then read back, against a real cluster.
 *
 * Pulsar assigns a topic to a namespace bundle asynchronously, so a stats read
 * immediately after a create can 404 on a broker that has not taken ownership
 * yet. The wait is bounded and the failure is reported rather than retried
 * forever: a create that never becomes visible is a real problem, and a test
 * that spins until it does would hide it.
 */
func TestLiveTopicRoundTripSurvivesPropagation(t *testing.T) {
	conn := liveConn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	ref := model.DestinationRef{Namespace: "public/default", Name: "mq-studio-e2e-orders"}
	_ = conn.RemoveDestination(ctx, ref)

	spec := model.DestinationSpec{Ref: ref, Partitions: 3}
	if err := conn.CreateDestination(ctx, spec); err != nil {
		t.Fatalf("create a partitioned topic: %v", err)
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = conn.RemoveDestination(cleanup, ref)
	})

	listed := waitForTopic(t, conn, ref.Name)
	if listed.Partitions != 3 {
		t.Errorf("partitions = %d, want 3", listed.Partitions)
	}
	if listed.Attributes[AttrTopicPersistent] != "true" {
		t.Errorf("a topic created without a scheme is not persistent: %v", listed.Attributes)
	}

	// Raising is the only edit Pulsar offers, and it is one-way.
	spec.Partitions = 5
	if err := conn.UpdateDestination(ctx, spec); err != nil {
		t.Fatalf("raise the partition count: %v", err)
	}
	detail, err := conn.DestinationDetail(ctx, ref)
	if err != nil {
		t.Fatalf("DestinationDetail: %v", err)
	}
	if detail.Partitions != 5 {
		t.Errorf("partitions after the raise = %d, want 5", detail.Partitions)
	}

	spec.Partitions = 2
	if err := conn.UpdateDestination(ctx, spec); err == nil {
		t.Error("lowering a partition count was accepted by the cluster")
	}

	if err := conn.RemoveDestination(ctx, ref); err != nil {
		t.Fatalf("delete the partitioned topic: %v", err)
	}
}

/*
 * A non-partitioned topic is a different shape, and the delete has to know it.
 *
 * Pulsar's delete takes a nonPartitioned flag and asking to delete a
 * partitioned topic as non-partitioned leaves every partition behind. Only a
 * live cluster proves the driver reads the shape before it deletes.
 */
func TestLiveNonPartitionedTopicRoundTrip(t *testing.T) {
	conn := liveConn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	ref := model.DestinationRef{Namespace: "public/default", Name: "mq-studio-e2e-audit"}
	_ = conn.RemoveDestination(ctx, ref)

	if err := conn.CreateDestination(ctx, model.DestinationSpec{Ref: ref}); err != nil {
		t.Fatalf("create a non-partitioned topic: %v", err)
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = conn.RemoveDestination(cleanup, ref)
	})

	// Zero partitions is a fact about this topic, not a figure nobody read.
	if listed := waitForTopic(t, conn, ref.Name); listed.Partitions != 0 {
		t.Errorf("partitions = %d, want an explicit 0", listed.Partitions)
	}
	if err := conn.RemoveDestination(ctx, ref); err != nil {
		t.Fatalf("delete the non-partitioned topic: %v", err)
	}
	if listed := findTopic(t, conn, ref.Name); listed != nil {
		t.Error("the topic is still listed after being deleted")
	}
}

// A non-persistent topic is listed beside the persistent ones, and carries the
// scheme a later delete needs.
func TestLiveNonPersistentTopicIsListedWithItsScheme(t *testing.T) {
	conn := liveConn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	ref := model.DestinationRef{Namespace: "public/default", Name: "mq-studio-e2e-telemetry"}
	spec := model.DestinationSpec{
		Ref:        ref,
		Attributes: map[string]string{AttrTopicPersistent: "false"},
	}
	_ = conn.RemoveDestination(ctx, ref)

	if err := conn.CreateDestination(ctx, spec); err != nil {
		t.Fatalf("create a non-persistent topic: %v", err)
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = conn.RemoveDestination(cleanup, ref)
	})

	listed := waitForTopic(t, conn, ref.Name)
	if listed.Attributes[AttrTopicPersistent] != "false" {
		t.Errorf("a non-persistent topic is listed as persistent: %v", listed.Attributes)
	}
}

// waitForTopic gives the cluster a bounded moment to make a new topic visible.
func waitForTopic(t *testing.T, conn *Conn, name string) *model.Destination {
	t.Helper()

	deadline := time.Now().Add(20 * time.Second)
	for {
		if found := findTopic(t, conn, name); found != nil {
			return found
		}
		if time.Now().After(deadline) {
			t.Fatalf("%s never appeared in the listing", name)
		}
		time.Sleep(500 * time.Millisecond)
	}
}

func findTopic(t *testing.T, conn *Conn, name string) *model.Destination {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	topics, err := conn.ListDestinations(ctx, model.DestinationFilter{IncludeInternal: true})
	if err != nil {
		t.Fatalf("ListDestinations: %v", err)
	}
	for _, topic := range topics {
		if topic.Ref.Name == name {
			return topic
		}
	}
	return nil
}

/*
 * A subscription created from the admin API, found by the walk, and moved.
 *
 * Creating one before any consumer attaches is the whole point of the
 * capability: it is how a consumer that has not started yet stops missing
 * everything published before it does. Only a live cluster proves the create
 * takes the position pulsaradmin sends and that the walk finds it afterwards.
 */
func TestLiveSubscriptionCreateThenDelete(t *testing.T) {
	conn := liveConn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	ref := model.DestinationRef{Namespace: "public/default", Name: "mq-studio-e2e-subs"}
	_ = conn.RemoveDestination(ctx, ref)
	if err := conn.CreateDestination(ctx, model.DestinationSpec{Ref: ref}); err != nil {
		t.Fatalf("create the topic: %v", err)
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = conn.RemoveDestination(cleanup, ref)
	})
	waitForTopic(t, conn, ref.Name)

	url := topicURL(ref, true)
	subscription := subscriptionRef(url, "mq-studio-e2e-reader")
	if err := conn.CreateSubscription(ctx,
		model.SubscriptionSpec{Ref: subscription}); err != nil {
		t.Fatalf("create the subscription: %v", err)
	}

	found := findSubscription(t, conn, subscription.Name)
	if found == nil {
		t.Fatal("the subscription just created is not in the walk")
	}
	if found.Ref.Namespace != url {
		t.Errorf("ref namespace = %q, want the topic URL", found.Ref.Namespace)
	}
	// Nothing has been published, so an empty backlog here is a fact rather
	// than a figure nobody read.
	if found.Backlog != 0 {
		t.Errorf("backlog = %d on a topic nothing was published to", found.Backlog)
	}
	// No consumer has attached, which is a state the page draws differently
	// from one that is reading.
	if found.Status != model.SubscriptionOffline {
		t.Errorf("status = %q with no consumer attached", found.Status)
	}

	detail, err := conn.SubscriptionDetail(ctx, subscription)
	if err != nil {
		t.Fatalf("SubscriptionDetail: %v", err)
	}
	if detail.Attributes[AttrSubscriptionDurable] != "true" {
		t.Error("a subscription created through the admin API is not durable")
	}

	if err := conn.RemoveSubscription(ctx, subscription); err != nil {
		t.Fatalf("delete the subscription: %v", err)
	}
	if findSubscription(t, conn, subscription.Name) != nil {
		t.Error("the subscription is still listed after being deleted")
	}
}

/*
 * A backlog built by publishing, then moved three different ways.
 *
 * This is the test that would catch the three cursor calls being mapped onto
 * the wrong endpoints: a force that replayed instead of skipping hands a
 * consumer a backlog somebody asked to discard, and neither shows up as an
 * error.
 */
func TestLiveResetCursorMovesTheBacklog(t *testing.T) {
	conn := liveConn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	ref := model.DestinationRef{Namespace: "public/default", Name: "mq-studio-e2e-cursor"}
	_ = conn.RemoveDestination(ctx, ref)
	if err := conn.CreateDestination(ctx, model.DestinationSpec{Ref: ref}); err != nil {
		t.Fatalf("create the topic: %v", err)
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = conn.RemoveDestination(cleanup, ref)
	})
	waitForTopic(t, conn, ref.Name)

	url := topicURL(ref, true)
	subscription := subscriptionRef(url, "mq-studio-e2e-cursor-reader")
	if err := conn.CreateSubscription(ctx,
		model.SubscriptionSpec{Ref: subscription}); err != nil {
		t.Fatalf("create the subscription: %v", err)
	}

	// The subscription exists before anything is published, so every message
	// below lands in its backlog. That is what makes the reset observable.
	publishForTest(t, conn, url, 10)
	waitForBacklog(t, conn, subscription, 10)

	// Force skips rather than replays: the backlog is discarded.
	if err := conn.ResetOffset(ctx, model.ResetOffsetRequest{
		Group: subscription.Name, Topic: url, Force: true,
	}); err != nil {
		t.Fatalf("clear the backlog: %v", err)
	}
	waitForBacklog(t, conn, subscription, 0)

	// And a reset to the earliest brings all ten back, which is the operation
	// an operator reaches for when a consumer processed something wrongly.
	if err := conn.ResetOffset(ctx, model.ResetOffsetRequest{
		Group: subscription.Name, Topic: url,
	}); err != nil {
		t.Fatalf("reset to the earliest: %v", err)
	}
	waitForBacklog(t, conn, subscription, 10)
}

// publishForTest puts messages on a topic through the data plane client.
//
// The driver's own publish path arrives in a later commit; this needs only
// something on the topic for the cursor to move over.
func publishForTest(t *testing.T, conn *Conn, topic string, count int) {
	t.Helper()

	producer, err := conn.client.CreateProducer(pulsarclient.ProducerOptions{Topic: topic})
	if err != nil {
		t.Fatalf("create a producer on %s: %v", topic, err)
	}
	defer producer.Close()

	for i := 0; i < count; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		_, err := producer.Send(ctx, &pulsarclient.ProducerMessage{
			Payload: []byte(fmt.Sprintf("message-%d", i)),
		})
		cancel()
		if err != nil {
			t.Fatalf("send message %d: %v", i, err)
		}
	}
}

// waitForBacklog gives the broker a bounded moment to publish updated stats.
//
// The figures behind a subscription are refreshed on the broker's own timer,
// so a read immediately after a reset can still report the previous value.
func waitForBacklog(t *testing.T, conn *Conn, ref model.SubscriptionRef, want int64) {
	t.Helper()

	deadline := time.Now().Add(30 * time.Second)
	var last int64 = -1
	for {
		found := findSubscription(t, conn, ref.Name)
		if found != nil {
			last = found.Backlog
			if last == want {
				return
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("backlog of %s settled at %d, want %d", ref.Name, last, want)
		}
		time.Sleep(500 * time.Millisecond)
	}
}

func findSubscription(t *testing.T, conn *Conn, name string) *model.Subscription {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	subscriptions, err := conn.ListSubscriptions(ctx)
	if err != nil {
		t.Fatalf("ListSubscriptions: %v", err)
	}
	for _, subscription := range subscriptions {
		if subscription.Ref.Name == name {
			return subscription
		}
	}
	return nil
}

/*
 * A browse finds what was published, and finds it by key.
 *
 * Every filter on this family is applied after reading, because Pulsar has no
 * message-search endpoint - so a live test is the only thing that proves the
 * Reader actually walks the log rather than the filter quietly matching
 * nothing.
 */
func TestLiveBrowseFindsAProducedMessage(t *testing.T) {
	conn := liveConn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	ref := model.DestinationRef{Namespace: "public/default", Name: "mq-studio-e2e-browse"}
	url := prepareTopic(t, conn, ref)

	publishKeyed(t, conn, url, []keyedMessage{
		{key: "alpha", body: "first"},
		{key: "beta", body: "second"},
		{key: "alpha", body: "third"},
	})

	all, err := conn.QueryMessages(ctx, model.MessageQueryParams{Topic: url, MaxResults: 50})
	if err != nil {
		t.Fatalf("QueryMessages: %v", err)
	}
	if len(all) != 3 {
		t.Fatalf("browsed %d messages, want the 3 that were published", len(all))
	}
	// Oldest first, which is the order the board appends in and the order the
	// log is written in.
	if all[0].Body != "first" || all[2].Body != "third" {
		t.Errorf("browse returned %q then %q, want first then third",
			all[0].Body, all[2].Body)
	}
	if all[0].MessageID == "" {
		t.Error("a browsed message carries no id")
	}

	byKey, err := conn.QueryMessages(ctx, model.MessageQueryParams{
		Topic: url, MessageKey: "alpha", MaxResults: 50,
	})
	if err != nil {
		t.Fatalf("QueryMessages by key: %v", err)
	}
	if len(byKey) != 2 {
		t.Fatalf("browsing by key found %d, want the 2 with that key", len(byKey))
	}

	// And the id round-trips: what the browse printed can be looked up again,
	// which is the whole point of printing Pulsar's own form.
	found, err := conn.MessageByID(ctx, url, all[1].MessageID)
	if err != nil {
		t.Fatalf("MessageByID(%s): %v", all[1].MessageID, err)
	}
	if found.Body != "second" {
		t.Errorf("looking up %s gave %q, want second", all[1].MessageID, found.Body)
	}
}

// A property filter is how this family narrows a browse, because Pulsar has no
// tag - what RocketMQ puts in one, a Pulsar producer puts in a property.
func TestLiveBrowseFiltersOnAProperty(t *testing.T) {
	conn := liveConn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	ref := model.DestinationRef{Namespace: "public/default", Name: "mq-studio-e2e-props"}
	url := prepareTopic(t, conn, ref)

	publishKeyed(t, conn, url, []keyedMessage{
		{body: "paid", properties: map[string]string{"stage": "paid"}},
		{body: "shipped", properties: map[string]string{"stage": "shipped"}},
		{body: "plain"},
	})

	matched, err := conn.QueryMessages(ctx, model.MessageQueryParams{
		Topic:      url,
		MaxResults: 50,
		Filters:    map[string]string{FilterProperty: "stage=paid"},
	})
	if err != nil {
		t.Fatalf("QueryMessages by property: %v", err)
	}
	if len(matched) != 1 || matched[0].Body != "paid" {
		t.Fatalf("filtering on stage=paid gave %d messages", len(matched))
	}

	// A bare name asks "which messages carry this at all", which is a
	// different and useful question.
	present, err := conn.QueryMessages(ctx, model.MessageQueryParams{
		Topic:      url,
		MaxResults: 50,
		Filters:    map[string]string{FilterProperty: "stage"},
	})
	if err != nil {
		t.Fatalf("QueryMessages by property presence: %v", err)
	}
	if len(present) != 2 {
		t.Errorf("filtering on the property name gave %d, want the 2 that carry it",
			len(present))
	}
}

/*
 * A tail shows what arrives next and never shows it twice.
 *
 * This is the invariant the whole cursor design exists for. A tail that
 * returned an empty cursor would send the next poll back to the end of the
 * topic and silently skip whatever arrived in between; one that resumed
 * inclusively would repeat its last line on every poll. Both look like working
 * software on a quiet topic.
 */
func TestLiveTailDoesNotReplayWhatItAlreadyReturned(t *testing.T) {
	conn := liveConn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	ref := model.DestinationRef{Namespace: "public/default", Name: "mq-studio-e2e-tail"}
	url := prepareTopic(t, conn, ref)
	tailRef := model.DestinationRef{Namespace: ref.Namespace, Name: url}

	// Published before the tail opens, and therefore never shown: a tail is
	// what arrives from now on, which is what makes it different from a
	// browse.
	publishKeyed(t, conn, url, []keyedMessage{{body: "before"}})

	first, err := conn.TailMessages(ctx, tailRef, model.TailCursor{}, 50)
	if err != nil {
		t.Fatalf("open the tail: %v", err)
	}
	for _, message := range first.Messages {
		if message.Body == "before" {
			t.Error("the tail replayed a message published before it opened")
		}
	}

	publishKeyed(t, conn, url, []keyedMessage{{body: "one"}, {body: "two"}})

	second, err := conn.TailMessages(ctx, tailRef, first.Cursor, 50)
	if err != nil {
		t.Fatalf("second poll: %v", err)
	}
	seen := bodies(second.Messages)
	if len(seen) != 2 {
		t.Fatalf("the second poll returned %v, want one and two", seen)
	}

	// The third poll has nothing to show, and must still hand back somewhere
	// to resume from.
	third, err := conn.TailMessages(ctx, tailRef, second.Cursor, 50)
	if err != nil {
		t.Fatalf("third poll: %v", err)
	}
	if len(third.Messages) != 0 {
		t.Errorf("a quiet poll replayed %v", bodies(third.Messages))
	}
	if len(third.Cursor.Positions) == 0 {
		t.Fatal("a poll with no messages returned no cursor, so the next one would restart")
	}

	// And a fourth poll from that cursor still sees what arrives after it.
	publishKeyed(t, conn, url, []keyedMessage{{body: "three"}})
	fourth, err := conn.TailMessages(ctx, tailRef, third.Cursor, 50)
	if err != nil {
		t.Fatalf("fourth poll: %v", err)
	}
	if got := bodies(fourth.Messages); len(got) != 1 || got[0] != "three" {
		t.Errorf("the fourth poll returned %v, want three", got)
	}
}

type keyedMessage struct {
	key        string
	body       string
	properties map[string]string
}

// prepareTopic creates a topic for one test and removes it afterwards.
func prepareTopic(t *testing.T, conn *Conn, ref model.DestinationRef) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	_ = conn.RemoveDestination(ctx, ref)
	if err := conn.CreateDestination(ctx, model.DestinationSpec{Ref: ref}); err != nil {
		t.Fatalf("create %s: %v", ref.Name, err)
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_ = conn.RemoveDestination(cleanup, ref)
	})
	waitForTopic(t, conn, ref.Name)
	return topicURL(ref, true)
}

func publishKeyed(t *testing.T, conn *Conn, topic string, messages []keyedMessage) {
	t.Helper()

	producer, err := conn.client.CreateProducer(pulsarclient.ProducerOptions{Topic: topic})
	if err != nil {
		t.Fatalf("create a producer on %s: %v", topic, err)
	}
	defer producer.Close()

	for i, message := range messages {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		_, err := producer.Send(ctx, &pulsarclient.ProducerMessage{
			Key:        message.key,
			Payload:    []byte(message.body),
			Properties: message.properties,
		})
		cancel()
		if err != nil {
			t.Fatalf("send message %d: %v", i, err)
		}
	}
}

func bodies(messages []*model.MessageItem) []string {
	out := make([]string, 0, len(messages))
	for _, message := range messages {
		out = append(out, message.Body)
	}
	return out
}

/*
 * A dead-letter topic is found by its name, and traced back to the
 * subscription that gave up.
 *
 * Nothing on the broker records the link, so this is the test that proves the
 * walk finds real topics rather than the pattern matching nothing: the topics
 * below are created exactly as the client library would name them.
 */
func TestLiveDeadLetterTopicIsFoundFromItsName(t *testing.T) {
	conn := liveConn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	origin := model.DestinationRef{Namespace: "public/default", Name: "mq-studio-e2e-dlq-src"}
	dead := model.DestinationRef{
		Namespace: "public/default", Name: "mq-studio-e2e-dlq-src-worker-DLQ",
	}
	orphan := model.DestinationRef{
		Namespace: "public/default", Name: "mq-studio-e2e-nothing-reader-DLQ",
	}
	prepareTopic(t, conn, origin)
	deadURL := prepareTopic(t, conn, dead)
	prepareTopic(t, conn, orphan)

	// Something in the dead-letter topic, so the depth column is not zero for
	// the trivial reason.
	publishKeyed(t, conn, deadURL, []keyedMessage{{body: "failed once"}})

	queues, err := conn.DeadLetterQueues(ctx, "public/default")
	if err != nil {
		t.Fatalf("DeadLetterQueues: %v", err)
	}

	byName := make(map[string]*model.DeadLetterQueue, len(queues))
	for _, queue := range queues {
		byName[queue.Name] = queue
	}

	found, ok := byName[dead.Name]
	if !ok {
		t.Fatalf("the dead-letter topic was not found; got %v", byName)
	}
	if len(found.Sources) != 1 || found.Sources[0].Queue != origin.Name {
		t.Errorf("sources = %+v, want the origin topic", found.Sources)
	}
	if len(found.Sources) == 1 && found.Sources[0].Subscription != "worker" {
		t.Errorf("subscription = %q, want worker", found.Sources[0].Subscription)
	}

	// The orphan is on the page and says it has no source, which is the row an
	// operator most needs to see.
	stray, ok := byName[orphan.Name]
	if !ok {
		t.Fatal("a dead-letter topic with no origin was dropped from the walk")
	}
	if len(stray.Sources) != 0 {
		t.Errorf("an orphan claims a source: %+v", stray.Sources)
	}

	// And the origin topic itself is not on this page.
	if _, ok := byName[origin.Name]; ok {
		t.Error("an ordinary topic is listed as a dead-letter queue")
	}
}

/*
 * Producers are cached per topic and released on close.
 *
 * Not an optimisation, and the failure it prevents is not slow but total:
 * every Pulsar producer registers a name the broker holds until it is closed,
 * so one per send climbs to maxProducersPerTopic and the topic then refuses
 * every further send - from this app and from the application publishing
 * beside it. Only a real broker completes the handshake this needs.
 */
func TestLiveProducersAreReusedAndReleased(t *testing.T) {
	conn := liveConn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	first := model.DestinationRef{Namespace: "public/default", Name: "mq-studio-e2e-send"}
	second := model.DestinationRef{Namespace: "public/default", Name: "mq-studio-e2e-send-2"}
	firstURL := prepareTopic(t, conn, first)
	secondURL := prepareTopic(t, conn, second)

	for i := 0; i < 3; i++ {
		if _, err := conn.Publish(ctx, PublishRequest{Topic: firstURL, Body: "x"}); err != nil {
			t.Fatalf("send %d: %v", i, err)
		}
	}
	if _, err := conn.Publish(ctx, PublishRequest{Topic: secondURL, Body: "y"}); err != nil {
		t.Fatalf("send to the second topic: %v", err)
	}

	if len(conn.producers) != 2 {
		t.Errorf("four sends across two topics opened %d producers, want 2",
			len(conn.producers))
	}

	// And the broker agrees there is one, not three.
	publishers, err := conn.ProducerClients(ctx, "", firstURL)
	if err != nil {
		t.Fatalf("ProducerClients: %v", err)
	}
	console := 0
	for _, publisher := range publishers {
		if publisher.ClientID == producerName {
			console++
		}
	}
	if console != 1 {
		t.Errorf("the broker sees %d console producers on one topic, want 1", console)
	}

	if err := conn.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	if conn.producers != nil {
		t.Error("closing the connection left producers registered on the broker")
	}
}

/*
 * A send lands, and the id it returns finds it again.
 *
 * The whole point of returning Pulsar's own printed form is that it can be
 * pasted back into the browse box, so the round trip is the assertion.
 */
func TestLiveSendThenBrowseFindsIt(t *testing.T) {
	conn := liveConn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	ref := model.DestinationRef{Namespace: "public/default", Name: "mq-studio-e2e-console"}
	url := prepareTopic(t, conn, ref)

	result, err := conn.Publish(ctx, PublishRequest{
		Topic:       url,
		Key:         "customer-7",
		OrderingKey: "customer-7",
		Properties:  map[string]string{"stage": "paid"},
		Body:        "from the console",
		Count:       2,
	})
	if err != nil {
		t.Fatalf("Publish: %v", err)
	}
	if len(result.MessageIDs) != 2 {
		t.Fatalf("two messages produced %d ids", len(result.MessageIDs))
	}

	found, err := conn.MessageByID(ctx, url, result.MessageIDs[0])
	if err != nil {
		t.Fatalf("MessageByID(%s): %v", result.MessageIDs[0], err)
	}
	if found.Body != "from the console" {
		t.Errorf("body = %q", found.Body)
	}
	if found.Properties["stage"] != "paid" {
		t.Errorf("properties = %v, want the one that was sent", found.Properties)
	}

	// The canonical port's tag becomes a property, and the browse filter that
	// replaces the tag search has to find it.
	if _, err := conn.SendMessage(ctx, url, "shipped", "customer-9", "tagged", 0); err != nil {
		t.Fatalf("SendMessage: %v", err)
	}
	tagged, err := conn.QueryMessages(ctx, model.MessageQueryParams{
		Topic:      url,
		MaxResults: 50,
		Filters:    map[string]string{FilterProperty: "tag=shipped"},
	})
	if err != nil {
		t.Fatalf("QueryMessages: %v", err)
	}
	if len(tagged) != 1 || tagged[0].Body != "tagged" {
		t.Fatalf("filtering on the mapped tag found %d messages", len(tagged))
	}
}

/*
 * A delayed message is withheld, and that is the whole feature.
 *
 * Asserted by consuming rather than by reading a stat: the broker's msgDelayed
 * counter only populates once a dispatcher is running, so a subscription with
 * nothing attached reports zero for a message it is genuinely holding back.
 * What a consumer receives is the behaviour anybody actually depends on.
 *
 * The unit matters and nothing else pins it: ports.go fixes none, so a driver
 * reading the delay as milliseconds would deliver at once and one reading it
 * as a RocketMQ level would schedule it for a wildly different time. Both look
 * like a working send.
 */
func TestLiveDelayedMessageIsWithheld(t *testing.T) {
	conn := liveConn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	ref := model.DestinationRef{Namespace: "public/default", Name: "mq-studio-e2e-delayed"}
	url := prepareTopic(t, conn, ref)

	// Shared, because Pulsar only honours a per-message delay on a
	// subscription type that dispatches individually.
	consumer, err := conn.client.Subscribe(pulsarclient.ConsumerOptions{
		Topic:            url,
		SubscriptionName: "delayed-reader",
		Type:             pulsarclient.Shared,
	})
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	defer consumer.Close()

	if _, err := conn.Publish(ctx, PublishRequest{
		Topic: url, Body: "later", DeliverAfter: time.Hour,
	}); err != nil {
		t.Fatalf("send a delayed message: %v", err)
	}
	if _, err := conn.Publish(ctx, PublishRequest{Topic: url, Body: "now"}); err != nil {
		t.Fatalf("send an immediate message: %v", err)
	}

	// The immediate one arrives.
	receive, cancelReceive := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancelReceive()
	first, err := consumer.Receive(receive)
	if err != nil {
		t.Fatalf("receive the immediate message: %v", err)
	}
	if string(first.Payload()) != "now" {
		t.Fatalf("received %q first, want the undelayed message", first.Payload())
	}
	consumer.Ack(first)

	// The delayed one does not, within a window far shorter than its delay.
	// A driver that sent the delay in the wrong unit would deliver it here.
	quiet, cancelQuiet := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelQuiet()
	if early, err := consumer.Receive(quiet); err == nil {
		t.Errorf("a message delayed by an hour arrived immediately: %q", early.Payload())
	}
}

/*
 * A grant, read back, then revoked - at both scopes.
 *
 * Pulsar's grant replaces a role's whole action list rather than adding to it,
 * so the round trip is what proves the fold onto the canonical three is right
 * in both directions. And the two revokes reach different endpoints: a topic
 * revoke that hit the namespace one would take away far more than was asked,
 * and nothing about the response would say so.
 */
func TestLiveGrantThenRevokeRoundTrip(t *testing.T) {
	conn := liveConn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	ref := model.DestinationRef{Namespace: "public/default", Name: "mq-studio-e2e-grants"}
	url := prepareTopic(t, conn, ref)
	const role = "mq-studio-e2e-role"

	_ = conn.RemovePermission(ctx, "public/default", role)
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		_ = conn.RemovePermission(cleanup, "public/default", role)
	})

	if err := conn.SetPermission(ctx, model.NamespacePermission{
		Namespace: "public/default",
		Identity:  role,
		Configure: permissionAllow,
		Read:      permissionAllow,
	}); err != nil {
		t.Fatalf("grant on the namespace: %v", err)
	}

	granted := findGrant(t, conn, role)
	if granted == nil {
		t.Fatal("the grant just made is not in the listing")
	}
	// Configure grants all four deploy actions, and reading them back must
	// still say Configure rather than something else.
	if granted.Configure != permissionAllow {
		t.Errorf("configure = %q after granting it", granted.Configure)
	}
	if granted.Read != permissionAllow {
		t.Errorf("read = %q after granting it", granted.Read)
	}
	if granted.Write != permissionNone {
		t.Errorf("write = %q, which was never granted", granted.Write)
	}

	// A topic grant is narrower and stored separately.
	if err := conn.SetTopicPermission(ctx, model.TopicPermission{
		Identity: role, Exchange: url, Write: permissionAllow,
	}); err != nil {
		t.Fatalf("grant on the topic: %v", err)
	}
	topicGrants, err := conn.ListTopicPermissions(ctx)
	if err != nil {
		t.Fatalf("ListTopicPermissions: %v", err)
	}
	found := false
	for _, permission := range topicGrants {
		if permission.Identity == role && permission.Exchange == url {
			found = true
			if permission.Write != permissionAllow {
				t.Errorf("topic write = %q after granting it", permission.Write)
			}
		}
	}
	if !found {
		t.Error("the topic grant is not in the listing")
	}

	// Revoking the topic leaves the namespace grant standing, which is the
	// whole reason they are two calls.
	if err := conn.RemoveTopicPermission(ctx, url, role); err != nil {
		t.Fatalf("revoke on the topic: %v", err)
	}
	if findGrant(t, conn, role) == nil {
		t.Error("revoking a topic grant took the namespace grant with it")
	}

	if err := conn.RemovePermission(ctx, "public/default", role); err != nil {
		t.Fatalf("revoke on the namespace: %v", err)
	}
	if findGrant(t, conn, role) != nil {
		t.Error("the namespace grant survived being revoked")
	}
}

func findGrant(t *testing.T, conn *Conn, role string) *model.NamespacePermission {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	permissions, err := conn.NamespacePermissions(ctx, "public/default")
	if err != nil {
		t.Fatalf("NamespacePermissions: %v", err)
	}
	for _, permission := range permissions {
		if permission.Identity == role {
			return permission
		}
	}
	return nil
}
