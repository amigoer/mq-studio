package pulsar

import (
	"context"
	"net/http"
	"testing"
)

// namespaceRoutes is a tenant with two namespaces, one of which has limits set
// and one of which has none. Both cases have to render, and only one of them
// is allowed to show numbers.
func namespaceRoutes() map[string]string {
	routes := clusterRoutes()
	routes["/admin/v2/namespaces/public"] = `["public/default","public/orders"]`
	routes["/admin/v2/namespaces/public/default"] = `{}`
	routes["/admin/v2/namespaces/public/orders"] = `{
		"message_ttl_in_seconds": 3600,
		"max_producers_per_topic": 0,
		"retention_policies": {"retentionTimeInMinutes": 60, "retentionSizeInMB": 512}
	}`
	return routes
}

func namespaceConn(t *testing.T) *Conn {
	t.Helper()
	cluster := newFakeCluster(t, namespaceRoutes(), http.StatusNotFound)
	return probedConn(t, cluster.config())
}

/*
 * A limit nobody set is absent, and a limit set to zero is zero.
 *
 * Pulsar makes every one of these a nullable field precisely because the two
 * are different: no limit is the broker's own setting deciding, and zero
 * producers is a namespace nothing can publish to. Reading an absent limit as
 * 0 would tell an operator their namespace is closed for writing; reading a
 * zero as absent would hide that it actually is.
 */
func TestNamespaceLimitsDistinguishAbsentFromZero(t *testing.T) {
	namespaces, err := namespaceConn(t).ListNamespaces(context.Background())
	if err != nil {
		t.Fatalf("ListNamespaces: %v", err)
	}
	if len(namespaces) != 2 {
		t.Fatalf("listed %d namespaces, want 2", len(namespaces))
	}

	byName := map[string]map[string]int{}
	for _, namespace := range namespaces {
		byName[namespace.Name] = namespace.Limits
	}

	bare := byName["public/default"]
	if len(bare) != 0 {
		t.Errorf("a namespace with no policies carries limits %v", bare)
	}

	orders := byName["public/orders"]
	if got, ok := orders[LimitMessageTTLSeconds]; !ok || got != 3600 {
		t.Errorf("message TTL = %d (set %t), want 3600", got, ok)
	}
	// Explicitly zero, and it has to survive as zero.
	if got, ok := orders[LimitMaxProducersPerTopic]; !ok || got != 0 {
		t.Errorf("max producers = %d (set %t), want an explicit 0", got, ok)
	}
	// Never set, so absent rather than zero.
	if _, ok := orders[LimitMaxConsumersPerTopic]; ok {
		t.Error("max consumers is reported as set on a namespace that never set it")
	}
	if got := orders[LimitRetentionTimeMinutes]; got != 60 {
		t.Errorf("retention minutes = %d, want 60", got)
	}
	if got := orders[LimitRetentionSizeMB]; got != 512 {
		t.Errorf("retention MB = %d, want 512", got)
	}
}

/*
 * A namespace whose policies cannot be read is still listed.
 *
 * The tenant just said it exists. Dropping it because a second request was
 * refused would make a namespace this credential can only partly read look
 * like one that is not there, and the topics page would then offer no scope
 * for it.
 */
func TestNamespaceSurvivesPoliciesItCannotRead(t *testing.T) {
	routes := namespaceRoutes()
	delete(routes, "/admin/v2/namespaces/public/orders")
	cluster := newFakeCluster(t, routes, http.StatusForbidden)
	conn := probedConn(t, cluster.config())

	namespaces, err := conn.ListNamespaces(context.Background())
	if err != nil {
		t.Fatalf("ListNamespaces: %v", err)
	}

	found := false
	for _, namespace := range namespaces {
		if namespace.Name == "public/orders" {
			found = true
			if len(namespace.Limits) != 0 {
				t.Errorf("a namespace whose policies were refused reports limits %v",
					namespace.Limits)
			}
		}
	}
	if !found {
		t.Error("a namespace whose policies were refused was dropped from the listing")
	}
}

// Counting a namespace's messages means walking its topics, so the header says
// unknown. A zero would read as an empty namespace.
func TestNamespaceDepthIsUnknownRatherThanZero(t *testing.T) {
	namespaces, err := namespaceConn(t).ListNamespaces(context.Background())
	if err != nil {
		t.Fatalf("ListNamespaces: %v", err)
	}
	for _, namespace := range namespaces {
		if namespace.Messages != -1 {
			t.Errorf("%s reports %d messages without counting any",
				namespace.Name, namespace.Messages)
		}
	}
}

/*
 * A bare name is qualified with the connection's tenant, and a qualified one
 * is left alone.
 *
 * The form collects a short name and an import carries a full one. Qualifying
 * unconditionally would produce public/public/orders, which Pulsar accepts as
 * a namespace called "public/orders" under no tenant anybody meant.
 */
func TestQualifyNamespace(t *testing.T) {
	conn := &Conn{config: clientConfig{Tenant: "public"}}

	cases := []struct {
		name string
		raw  string
		want string
	}{
		{name: "a bare name takes the connection's tenant", raw: "orders", want: "public/orders"},
		{name: "an already-qualified name is left alone", raw: "shop/orders", want: "shop/orders"},
		{name: "surrounding space is not part of a name", raw: "  orders  ", want: "public/orders"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			got, err := conn.qualifyNamespace(test.raw)
			if err != nil {
				t.Fatalf("qualifyNamespace(%q): %v", test.raw, err)
			}
			if got != test.want {
				t.Errorf("qualifyNamespace(%q) = %q, want %q", test.raw, got, test.want)
			}
		})
	}

	for _, raw := range []string{"", "   ", "a/b/c"} {
		if _, err := conn.qualifyNamespace(raw); err == nil {
			t.Errorf("qualifyNamespace(%q) was accepted", raw)
		}
	}
}

// A limit this family does not have is refused by name rather than sent to the
// broker, which would answer with a 404 that names a URL instead of a field.
func TestUnknownLimitIsRefusedByName(t *testing.T) {
	conn := namespaceConn(t)

	err := conn.SetNamespaceLimit(context.Background(), "public/orders", "maxQueues", 10)
	if err == nil {
		t.Fatal("a limit Pulsar does not have was accepted")
	}
	if err := conn.RemoveNamespaceLimit(context.Background(), "public/orders", "maxQueues"); err == nil {
		t.Fatal("removing a limit Pulsar does not have was accepted")
	}
}
