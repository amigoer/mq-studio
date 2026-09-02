package pulsar

import (
	"context"
	"net/http"
	"testing"

	"github.com/apache/pulsar-client-go/pulsaradmin/pkg/utils"

	"github.com/amigoer/mq-studio/internal/model"
)

func action(t *testing.T, name string) utils.AuthAction {
	t.Helper()
	parsed, err := utils.ParseAuthAction(name)
	if err != nil {
		t.Fatalf("ParseAuthAction(%q): %v", name, err)
	}
	return parsed
}

/*
 * Pulsar's six actions fold onto the model's three, and the fold has to be
 * exact in the read direction.
 *
 * produce and consume are the two that map one to one; the other four are all
 * "may deploy things into this namespace", which is what Configure means on
 * every family that has it. Reading any of them as a write would tell an
 * operator a role can publish when it cannot.
 */
func TestAuthActionsFoldOntoTheCanonicalThree(t *testing.T) {
	cases := []struct {
		name                   string
		actions                []string
		configure, write, read string
	}{
		{name: "produce is write", actions: []string{"produce"}, write: permissionAllow},
		{name: "consume is read", actions: []string{"consume"}, read: permissionAllow},
		{
			name: "both", actions: []string{"produce", "consume"},
			write: permissionAllow, read: permissionAllow,
		},
		{
			name:    "functions is configure and nothing else",
			actions: []string{"functions"}, configure: permissionAllow,
		},
		{name: "so are sinks", actions: []string{"sinks"}, configure: permissionAllow},
		{name: "so are sources", actions: []string{"sources"}, configure: permissionAllow},
		{name: "so are packages", actions: []string{"packages"}, configure: permissionAllow},
		{
			name:      "all four configure actions still read as one",
			actions:   []string{"functions", "sinks", "sources", "packages"},
			configure: permissionAllow,
		},
		{name: "nothing granted is nothing set", actions: nil},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			actions := make([]utils.AuthAction, 0, len(test.actions))
			for _, name := range test.actions {
				actions = append(actions, action(t, name))
			}
			configure, write, read := permissionOf(actions)
			if configure != test.configure || write != test.write || read != test.read {
				t.Errorf("permissionOf(%v) = %q/%q/%q, want %q/%q/%q",
					test.actions, configure, write, read,
					test.configure, test.write, test.read)
			}
		})
	}
}

/*
 * Granting Configure grants all four, and the round trip has to survive it.
 *
 * A UI with four checkboxes for what an operator thinks of as one permission
 * would be worse than granting slightly more than asked, so the write
 * direction is deliberately lossy - but reading it back must still say
 * Configure and not something else.
 */
func TestGrantingConfigureRoundTrips(t *testing.T) {
	actions, err := authActions(permissionAllow, permissionAllow, permissionNone)
	if err != nil {
		t.Fatalf("authActions: %v", err)
	}
	if len(actions) != 5 {
		t.Fatalf("configure + write produced %d actions, want produce plus the four", len(actions))
	}

	configure, write, read := permissionOf(actions)
	if configure != permissionAllow || write != permissionAllow || read != permissionNone {
		t.Errorf("round trip = %q/%q/%q, want allow/allow/none", configure, write, read)
	}
}

/*
 * A grant with nothing in it is refused rather than sent.
 *
 * Pulsar's grant replaces the whole action list for a role instead of adding
 * to it, so an empty one silently revokes - which is a different button with a
 * different confirmation.
 */
func TestGrantWithNoPermissionIsRefused(t *testing.T) {
	conn := probedConn(t, healthyCluster(t).config())
	ctx := context.Background()

	err := conn.SetPermission(ctx, model.NamespacePermission{
		Namespace: "public/default", Identity: "reader",
	})
	if err == nil {
		t.Error("a namespace grant with no permission was accepted")
	}

	err = conn.SetTopicPermission(ctx, model.TopicPermission{
		Identity: "reader", Exchange: "persistent://public/default/orders",
	})
	if err == nil {
		t.Error("a topic grant with no permission was accepted")
	}

	// And a grant with no role, which would reach the broker as a URL with an
	// empty segment.
	err = conn.SetPermission(ctx, model.NamespacePermission{
		Namespace: "public/default", Read: permissionAllow,
	})
	if err == nil {
		t.Error("a grant with no role was accepted")
	}
}

func permissionRoutes() map[string]string {
	routes := topicRoutes()
	routes["/admin/v2/namespaces/public/default/permissions"] = `{
		"orders-reader": ["consume"],
		"orders-writer": ["produce", "consume"],
		"deployer": ["functions", "sinks"]
	}`
	routes["/admin/v2/persistent/public/default/orders/permissions"] = `{
		"audit-tool": ["consume"]
	}`
	routes["/admin/v2/persistent/public/default/audit/permissions"] = `{}`
	return routes
}

/*
 * A namespace's grants are read as roles, not users.
 *
 * Pulsar keeps no directory: a grant names a role that may not exist yet and
 * is honoured when a token carrying it turns up. That is exactly why this
 * family implements IdentityPermissions and refuses IdentityList - there are
 * grants to read, and nothing to enumerate them from.
 */
func TestNamespacePermissionsAreReadAsRoles(t *testing.T) {
	cluster := newFakeCluster(t, permissionRoutes(), http.StatusNotFound)
	conn := probedConn(t, cluster.config())

	permissions, err := conn.NamespacePermissions(context.Background(), "public/default")
	if err != nil {
		t.Fatalf("NamespacePermissions: %v", err)
	}
	if len(permissions) != 3 {
		t.Fatalf("%d grants, want 3", len(permissions))
	}
	// Sorted, so the board draws them in a stable order rather than whatever
	// order the map iterated in.
	if permissions[0].Identity != "deployer" {
		t.Errorf("first grant is %q, want the list sorted", permissions[0].Identity)
	}

	byRole := map[string]*model.NamespacePermission{}
	for _, permission := range permissions {
		byRole[permission.Identity] = permission
	}
	if got := byRole["orders-reader"]; got.Read != permissionAllow || got.Write != permissionNone {
		t.Errorf("a consume-only role reads as %q/%q", got.Write, got.Read)
	}
	if got := byRole["deployer"]; got.Configure != permissionAllow ||
		got.Write != permissionNone || got.Read != permissionNone {
		t.Errorf("a functions role reads as %q/%q/%q", got.Configure, got.Write, got.Read)
	}
}

/*
 * Topic grants are read per topic, and carry the topic they apply to.
 *
 * A topic grant is narrower than the namespace's and stored separately - it is
 * the difference between "this role may read the namespace" and "this role may
 * read one topic in it", which is the whole reason the page shows both.
 */
func TestTopicPermissionsCarryTheirTopic(t *testing.T) {
	cluster := newFakeCluster(t, permissionRoutes(), http.StatusNotFound)
	conn := probedConn(t, cluster.config())

	permissions, err := conn.ListTopicPermissions(context.Background())
	if err != nil {
		t.Fatalf("ListTopicPermissions: %v", err)
	}
	if len(permissions) != 1 {
		t.Fatalf("%d topic grants, want the one that is set: %+v", len(permissions), permissions)
	}
	if permissions[0].Identity != "audit-tool" {
		t.Errorf("role = %q", permissions[0].Identity)
	}
	if permissions[0].Exchange != "persistent://public/default/orders" {
		t.Errorf("topic = %q, want the full URL", permissions[0].Exchange)
	}
	if permissions[0].Read != permissionAllow || permissions[0].Write != permissionNone {
		t.Errorf("a consume-only topic grant reads as %q/%q",
			permissions[0].Write, permissions[0].Read)
	}
}

// Revoking is its own call at its own scope: a topic revoke must not reach the
// namespace endpoint, which would take away far more than was asked.
func TestRevokeUsesTheScopeItWasGiven(t *testing.T) {
	var called []string
	cluster := newRecordingCluster(t, permissionRoutes(), &called)
	conn := probedConn(t, cluster.config())
	ctx := context.Background()

	if err := conn.RemovePermission(ctx, "public/default", "orders-reader"); err != nil {
		t.Fatalf("RemovePermission: %v", err)
	}
	if err := conn.RemoveTopicPermission(
		ctx, "persistent://public/default/orders", "audit-tool"); err != nil {
		t.Fatalf("RemoveTopicPermission: %v", err)
	}

	want := []string{
		"/admin/v2/namespaces/public/default/permissions/orders-reader",
		"/admin/v2/persistent/public/default/orders/permissions/audit-tool",
	}
	if len(called) != len(want) {
		t.Fatalf("called %v, want %v", called, want)
	}
	for i, path := range want {
		if called[i] != path {
			t.Errorf("call %d went to %q, want %q", i, called[i], path)
		}
	}
}
