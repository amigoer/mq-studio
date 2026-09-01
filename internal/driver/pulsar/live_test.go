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
