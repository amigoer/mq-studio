package pulsar

import (
	"testing"

	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * A topic URL and a ref have to round-trip, including the names that break a
 * naive split.
 *
 * DestinationRef has two fields and a Pulsar topic has four parts, so the
 * split is chosen rather than derived. The part that is allowed to contain a
 * slash is the short name - a topic called "v2/orders" is legal - so cutting
 * on the last separator would move "v2" into the namespace and address a topic
 * that does not exist.
 */
func TestTopicURLRoundTrip(t *testing.T) {
	cases := []struct {
		name       string
		url        string
		ref        model.DestinationRef
		persistent bool
	}{
		{
			name:       "an ordinary persistent topic",
			url:        "persistent://public/default/orders",
			ref:        model.DestinationRef{Namespace: "public/default", Name: "orders"},
			persistent: true,
		},
		{
			name:       "a non-persistent topic keeps its scheme",
			url:        "non-persistent://public/default/telemetry",
			ref:        model.DestinationRef{Namespace: "public/default", Name: "telemetry"},
			persistent: false,
		},
		{
			name:       "a name containing a slash stays in the name",
			url:        "persistent://public/default/v2/orders",
			ref:        model.DestinationRef{Namespace: "public/default", Name: "v2/orders"},
			persistent: true,
		},
		{
			name:       "a partition suffix is part of the name",
			url:        "persistent://public/default/orders-partition-0",
			ref:        model.DestinationRef{Namespace: "public/default", Name: "orders-partition-0"},
			persistent: true,
		},
		{
			name:       "a tenant and namespace with hyphens",
			url:        "persistent://shop-eu/order-events/created",
			ref:        model.DestinationRef{Namespace: "shop-eu/order-events", Name: "created"},
			persistent: true,
		},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			ref, persistent, err := parseTopicURL(test.url)
			if err != nil {
				t.Fatalf("parseTopicURL(%q): %v", test.url, err)
			}
			if ref != test.ref {
				t.Errorf("parseTopicURL(%q) = %+v, want %+v", test.url, ref, test.ref)
			}
			if persistent != test.persistent {
				t.Errorf("parseTopicURL(%q) persistent = %t, want %t",
					test.url, persistent, test.persistent)
			}
			if got := topicURL(ref, persistent); got != test.url {
				t.Errorf("topicURL round trip = %q, want %q", got, test.url)
			}
		})
	}
}

// A name the driver cannot read must be refused rather than half-parsed into a
// ref that addresses some other topic.
func TestParseTopicURLRefusesWhatItCannotRead(t *testing.T) {
	for _, raw := range []string{
		"",
		"public/default/orders",         // no scheme
		"kafka://public/default/orders", // a scheme Pulsar does not have
		"persistent://public",           // no namespace
		"persistent://public/default",   // no topic
		"persistent://public/default/",  // an empty topic name
	} {
		if _, _, err := parseTopicURL(raw); err == nil {
			t.Errorf("parseTopicURL(%q) was accepted", raw)
		}
	}
}

/*
 * A subscription ref carries its topic, because a subscription has no identity
 * without one.
 *
 * Two topics may each have a subscription called "shared" and they are
 * unrelated. SubscriptionAdmin.ListSubscriptions takes no scope, so the topic
 * has to travel in the ref itself or the consumers page cannot tell them apart.
 */
func TestSubscriptionRefCarriesItsTopic(t *testing.T) {
	const url = "persistent://public/default/orders"
	ref := subscriptionRef(url, "shared")

	if ref.Name != "shared" {
		t.Errorf("name = %q, want shared", ref.Name)
	}
	topic, err := subscriptionTopic(ref)
	if err != nil {
		t.Fatalf("subscriptionTopic: %v", err)
	}
	if topic != url {
		t.Errorf("topic = %q, want %q", topic, url)
	}

	if _, err := subscriptionTopic(model.SubscriptionRef{Name: "shared"}); err == nil {
		t.Error("a subscription ref with no topic was accepted")
	}
}

// A page that has not narrowed the scope reads the connection's own, which is
// what the connection form collected the tenant and namespace for.
func TestNamespaceScopeFallsBackToTheConnection(t *testing.T) {
	conn := &Conn{config: clientConfig{Tenant: "public", Namespace: "default"}}

	if got := conn.namespaceScope(""); got != "public/default" {
		t.Errorf("an unscoped filter = %q, want the connection's own", got)
	}
	if got := conn.namespaceScope("  "); got != "public/default" {
		t.Errorf("a blank filter = %q, want the connection's own", got)
	}
	if got := conn.namespaceScope("shop/orders"); got != "shop/orders" {
		t.Errorf("a scoped filter = %q, want it honoured", got)
	}
}
