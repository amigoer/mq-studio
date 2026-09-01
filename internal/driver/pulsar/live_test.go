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
