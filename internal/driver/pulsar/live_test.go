package pulsar

import (
	"context"
	"testing"
	"time"

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
