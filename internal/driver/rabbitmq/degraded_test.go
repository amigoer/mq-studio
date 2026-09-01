package rabbitmq

import (
	"context"
	"testing"

	"github.com/amigoer/mq-studio/internal/e2e"
	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * The optional plugins, against a broker that does not have them.
 *
 * Shovel, federation and the stream protocol are plugins, and a broker without
 * them is a deployment choice rather than a broken one. The difference has to
 * survive all the way to the sidebar: the page is offered greyed out with a
 * reason, not missing, and not failing when someone opens it.
 *
 * This needs its own broker - the main environment turns those plugins on so
 * their pages have something to read - which is what tests/e2e/rabbitmq-plain
 * is. The unit tests cover what a wrong password or an unreachable host
 * degrades to; only a real broker answers a real 404 from a real plugin that
 * is not loaded.
 */
const plainEndpoint = "http://127.0.0.1:15682"

func requirePlainBroker(t *testing.T) {
	t.Helper()
	e2e.Require(t, e2e.Env{
		Name:  "the plugin-free rabbitmq",
		Start: "npm run e2e:rabbitmq:plain:up",
		Probe: e2e.HTTPGet(plainEndpoint + "/api/overview"),
	})
}

func plainConn(t *testing.T) *Conn {
	t.Helper()
	requirePlainBroker(t)

	profile := model.ConnectionProfile{
		Kind:      model.KindRabbitMQ,
		Name:      t.Name(),
		Endpoints: plainEndpoint,
		Auth:      model.AuthConfig{Mechanism: model.AuthPlain},
	}
	profile.SetSecret(SecretUsername, "mqstudio")
	profile.SetSecret(SecretPassword, "mqstudio")

	conn, err := New().Open(context.Background(), profile)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn.(*Conn)
}

/*
 * The bug this pins: the probe used to ask /api/parameters/shovel, which is
 * the parameter store rather than the plugin. That endpoint answers on a
 * broker with no shovel plugin at all, so the capability stayed supported and
 * the page opened onto an error.
 */
func TestPlainBrokerDegradesReplicationWithAReason(t *testing.T) {
	conn := plainConn(t)
	capabilities := conn.Capabilities()

	if capabilities.Has(model.CapReplication) {
		t.Error("replication is supported on a broker with neither plugin loaded")
	}
	reason, degraded := capabilities.DegradedReason(model.CapReplication)
	if !degraded {
		t.Fatal("replication is absent rather than degraded, so the page vanishes with no reason")
	}
	if reason != replicationPluginMissing {
		t.Errorf("reason = %q, want %q", reason, replicationPluginMissing)
	}
}

func TestPlainBrokerDegradesStreamClientsWithAReason(t *testing.T) {
	conn := plainConn(t)
	capabilities := conn.Capabilities()

	if capabilities.Has(model.CapStreamClients) {
		t.Error("stream clients are supported on a broker with no stream plugin")
	}
	reason, degraded := capabilities.DegradedReason(model.CapStreamClients)
	if !degraded {
		t.Fatal("stream clients are absent rather than degraded")
	}
	if reason != streamPluginMissing {
		t.Errorf("reason = %q, want %q", reason, streamPluginMissing)
	}
}

/*
 * A missing plugin must cost exactly its own page. Degrading anything else
 * would turn an optional extra into a broken connection.
 */
func TestPlainBrokerKeepsEverythingElseSupported(t *testing.T) {
	conn := plainConn(t)
	capabilities := conn.Capabilities()

	for _, capability := range []model.Capability{
		model.CapDestinationList,
		model.CapDestinationCreate,
		model.CapRouting,
		model.CapRoutingAdmin,
		model.CapSubscriptionList,
		model.CapClusterTopology,
		model.CapClusterCensus,
		model.CapClusterHealth,
		model.CapClientInspect,
		model.CapNamespaceList,
		model.CapNamespaceAdmin,
		model.CapIdentityList,
		model.CapPolicyList,
		model.CapDefinitionsExport,
		model.CapDefinitionsImport,
	} {
		if !capabilities.Has(capability) {
			reason, _ := capabilities.DegradedReason(capability)
			t.Errorf("%s was lost with the optional plugins: %q", capability, reason)
		}
	}
}

/*
 * And the pages themselves still work. A broker missing its optional plugins
 * is an ordinary broker, so the reads every page depends on have to answer.
 */
func TestPlainBrokerStillServesItsCorePages(t *testing.T) {
	conn := plainConn(t)
	ctx := context.Background()

	if _, err := conn.ListDestinations(ctx, model.DestinationFilter{}); err != nil {
		t.Errorf("list queues: %v", err)
	}
	if _, err := conn.ListExchanges(ctx, "/"); err != nil {
		t.Errorf("list exchanges: %v", err)
	}
	if _, err := conn.Census(ctx); err != nil {
		t.Errorf("census: %v", err)
	}
	if _, err := conn.ListNamespaces(ctx); err != nil {
		t.Errorf("list vhosts: %v", err)
	}
}

// The service layer turns a degraded capability into a refusal that names it,
// which is what lets the page explain itself instead of showing a raw 404.
func TestPlainBrokerRefusesTheShovelReadByCapability(t *testing.T) {
	conn := plainConn(t)

	if conn.Capabilities().Has(model.CapReplication) {
		t.Skip("the plugins are loaded on this broker after all")
	}
	// The driver itself will still try, because the gate is above it. What
	// matters is that it fails rather than reporting an empty list, which
	// would read as "no shovels are configured".
	if _, err := conn.ListShovels(context.Background()); err == nil {
		t.Error("listing shovels succeeded on a broker with no shovel plugin")
	}
}
