package nats

import (
	"context"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/e2e"
	"github.com/amigoer/mq-studio/internal/model"
)

// The two live environments, and what each is for.
//
// The addresses are the ones tests/e2e/nats/compose.yaml publishes. Note the
// probe reads /healthz rather than dialling 4222: a JetStream server binds its
// client port well before the meta group has elected a leader, and a driver
// connecting in that window finds a cluster that cannot answer anything about
// its own streams.
const (
	liveServers    = "nats://127.0.0.1:4222,nats://127.0.0.1:4223,nats://127.0.0.1:4224"
	liveMonitorURL = "http://127.0.0.1:8222"
	liveUser       = "mqstudio"
	livePassword   = "mqstudio"
	liveSystemUser = "sys"
	liveSystemPass = "sys"
	liveNoJSUser   = "nojs"
	liveNoJSPass   = "nojs"

	plainServer     = "nats://127.0.0.1:4225"
	plainMonitorURL = "http://127.0.0.1:8225"
)

func requireCluster(t *testing.T) {
	t.Helper()
	e2e.Require(t, e2e.Env{
		Name:  "the nats cluster",
		Start: "npm run e2e:nats:up",
		Probe: e2e.HTTPGet(liveMonitorURL + "/healthz"),
	})
}

func requirePlain(t *testing.T) {
	t.Helper()
	e2e.Require(t, e2e.Env{
		Name:  "the jetstream-free nats",
		Start: "npm run e2e:nats:plain:up",
		Probe: e2e.HTTPGet(plainMonitorURL + "/healthz"),
	})
}

// liveProfile points at the cluster as the APP account.
func liveProfile(withMonitor, withSystem bool) model.ConnectionProfile {
	profile := model.ConnectionProfile{
		ID:        1,
		Name:      "nats e2e",
		Kind:      model.KindNATS,
		Endpoints: liveServers,
		Auth:      model.AuthConfig{Mechanism: model.AuthPlain},
		Options:   map[string]string{},
		Secrets:   map[string]string{},
	}
	profile.SetSecret(SecretUsername, liveUser)
	profile.SetSecret(SecretPassword, livePassword)
	if withMonitor {
		profile.SetOption(OptionMonitorURL, liveMonitorURL)
	}
	if withSystem {
		profile.SetSecret(SecretSystemUser, liveSystemUser)
		profile.SetSecret(SecretSystemPassword, liveSystemPass)
	}
	return profile
}

func openLive(t *testing.T, profile model.ConnectionProfile) *Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	opened, err := New().Open(ctx, profile)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = opened.Close() })

	conn, ok := opened.(*Conn)
	if !ok {
		t.Fatalf("Open returned %T, want *Conn", opened)
	}
	return conn
}

// All four tiers answer on the seeded cluster, and the connection says so.
func TestLiveConnectFindsEveryTier(t *testing.T) {
	requireCluster(t)
	conn := openLive(t, liveProfile(true, true))

	if !conn.tiers.jetStream {
		t.Errorf("jetstream tier missing: %s", conn.tiers.jetStreamReason)
	}
	if !conn.tiers.monitor {
		t.Errorf("monitoring tier missing: %s", conn.tiers.monitorReason)
	}
	if !conn.tiers.system {
		t.Errorf("system tier missing: %s", conn.tiers.systemReason)
	}
	for _, problem := range driver.CheckConformance(conn) {
		t.Error(problem)
	}
}

// The system account reaches every server in the cluster in one request.
//
// This is the whole reason it is on the connection form: the monitoring
// endpoint below answers for the single server whose port was named, and a
// three-server cluster reached that way would report a cluster of one.
func TestLiveSystemAccountReachesEveryServer(t *testing.T) {
	requireCluster(t)
	conn := openLive(t, liveProfile(true, true))
	if conn.system == nil {
		e2e.Missing(t, "the system account did not answer: %s", conn.tiers.systemReason)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	replies, err := conn.system.ping(ctx, endpointVarz, 0)
	if err != nil {
		t.Fatalf("$SYS VARZ fan-out: %v", err)
	}
	// Names rather than a count against the cluster's own figure: the reply
	// set is what this asserts, and comparing two cluster-wide numbers taken
	// moments apart is how the other families' suites learned to flake.
	names := map[string]bool{}
	for _, reply := range replies {
		names[reply.Server.Name] = true
	}
	for _, want := range []string{"nats-1", "nats-2", "nats-3"} {
		if !names[want] {
			t.Errorf("%s did not answer the fan-out; got %v", want, names)
		}
	}
}

// The monitoring endpoint answers for the one server it belongs to, and the
// figures it reports are that server's own.
func TestLiveMonitoringEndpointDescribesItsOwnServer(t *testing.T) {
	requireCluster(t)
	conn := openLive(t, liveProfile(true, true))
	if conn.monitor == nil {
		e2e.Missing(t, "the monitoring endpoint did not answer: %s", conn.tiers.monitorReason)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	varz, err := conn.monitor.varz(ctx)
	if err != nil {
		t.Fatalf("/varz: %v", err)
	}
	if varz.Name != "nats-1" {
		t.Errorf("server name = %q, want nats-1 - %s is the port nats-1 publishes",
			varz.Name, liveMonitorURL)
	}
	if varz.Cluster.Name != "mqstudio" {
		t.Errorf("cluster name = %q, want mqstudio", varz.Cluster.Name)
	}
	if varz.JetStream == nil {
		t.Error("/varz reports no jetstream on a server that has it")
	}
	// Three servers, so two routes out of this one. A cluster that has not
	// formed reports zero here and looks healthy everywhere else.
	if varz.Remotes != 2 {
		t.Errorf("remotes = %d, want 2 - the cluster has not formed", varz.Remotes)
	}
}

// An account the server withheld JetStream from is not a server without
// JetStream, and the two must not arrive as one reason.
func TestLiveAccountWithoutJetStreamSaysSo(t *testing.T) {
	requireCluster(t)

	profile := liveProfile(true, true)
	profile.SetSecret(SecretUsername, liveNoJSUser)
	profile.SetSecret(SecretPassword, liveNoJSPass)
	conn := openLive(t, profile)

	if conn.tiers.jetStream {
		t.Fatal("the nojs account reported jetstream available")
	}
	if conn.tiers.jetStreamReason != jetStreamNoAccount {
		t.Errorf("reason = %q, want %q - a withheld grant is not a server built without the subsystem",
			conn.tiers.jetStreamReason, jetStreamNoAccount)
	}
}

// Credentials that are not the system account's are refused, and that is a
// different state from never having been asked for.
func TestLiveOrdinaryCredentialsCannotReachTheSystemAccount(t *testing.T) {
	requireCluster(t)

	profile := liveProfile(true, true)
	profile.SetSecret(SecretSystemUser, liveUser)
	profile.SetSecret(SecretSystemPassword, livePassword)
	conn := openLive(t, profile)

	if conn.tiers.system {
		t.Fatal("an ordinary account reached $SYS")
	}
	if conn.tiers.systemReason != systemForbidden {
		t.Errorf("reason = %q, want %q", conn.tiers.systemReason, systemForbidden)
	}
}

// A server built without JetStream reports the other reason, and the tiers
// that remain keep working.
func TestPlainBrokerHasNoJetStreamAndNoSystemAccount(t *testing.T) {
	requirePlain(t)

	profile := model.ConnectionProfile{
		ID:        2,
		Name:      "nats plain e2e",
		Kind:      model.KindNATS,
		Endpoints: plainServer,
		Auth:      model.AuthConfig{Mechanism: model.AuthPlain},
		Options:   map[string]string{OptionMonitorURL: plainMonitorURL},
		Secrets:   map[string]string{},
	}
	profile.SetSecret(SecretUsername, liveUser)
	profile.SetSecret(SecretPassword, livePassword)
	profile.SetSecret(SecretSystemUser, liveSystemUser)
	profile.SetSecret(SecretSystemPassword, liveSystemPass)

	conn := openLive(t, profile)

	if conn.tiers.jetStream {
		t.Error("a server built without jetstream reported it available")
	}
	if conn.tiers.jetStreamReason != jetStreamDisabled {
		t.Errorf("jetstream reason = %q, want %q", conn.tiers.jetStreamReason, jetStreamDisabled)
	}
	if conn.tiers.system {
		t.Error("a server with no system account accepted system credentials")
	}
	if conn.tiers.systemReason != systemForbidden {
		t.Errorf("system reason = %q, want %q", conn.tiers.systemReason, systemForbidden)
	}
	// The point of this environment: with two tiers gone, the two that remain
	// still have to work.
	if !conn.tiers.monitor {
		t.Errorf("monitoring tier missing: %s", conn.tiers.monitorReason)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := conn.Ping(ctx); err != nil {
		t.Errorf("Ping: %v", err)
	}
}

// A monitoring address nobody entered and one that does not answer are
// different states on the same live server.
func TestLiveMonitoringReasonsAreToldApart(t *testing.T) {
	requireCluster(t)

	t.Run("no address on the form", func(t *testing.T) {
		conn := openLive(t, liveProfile(false, true))
		if conn.tiers.monitorReason != monitorAbsent {
			t.Errorf("reason = %q, want %q", conn.tiers.monitorReason, monitorAbsent)
		}
	})

	t.Run("an address that does not answer", func(t *testing.T) {
		profile := liveProfile(false, true)
		// Port 1 refuses rather than hangs, so this measures the probe rather
		// than the dial timeout.
		profile.SetOption(OptionMonitorURL, "http://127.0.0.1:1")
		conn := openLive(t, profile)
		if conn.tiers.monitorReason != monitorUnreachable {
			t.Errorf("reason = %q, want %q", conn.tiers.monitorReason, monitorUnreachable)
		}
	})
}
