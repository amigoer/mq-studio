package rocketmq

import (
	"strings"
	"testing"

	"github.com/amigoer/mq-studio/internal/model"

	admin "github.com/amigoer/rocketmq-admin-go"
	"github.com/apache/rocketmq-client-go/v2/primitive"
)

func namespacedConn(namespace string) *Conn {
	return &Conn{config: ClientConfig{Namespace: namespace}}
}

func TestConfigOfReadsTheNamespaceOption(t *testing.T) {
	profile := model.ConnectionProfile{
		Kind:      model.KindRocketMQ,
		Endpoints: "ns:9876",
		Options:   map[string]string{OptionNamespace: "  MQ_INST_1  "},
	}
	config, err := configOf(profile)
	if err != nil {
		t.Fatalf("configOf() error = %v", err)
	}
	if config.Namespace != "MQ_INST_1" {
		t.Fatalf("Namespace = %q, want %q", config.Namespace, "MQ_INST_1")
	}

	// The separator would produce a name nothing could take apart again.
	profile.Options[OptionNamespace] = "bad%ns"
	if _, err := configOf(profile); err == nil {
		t.Fatal("a namespace carrying the separator must be refused")
	}

	// The overwhelmingly common case, and the one that has to stay free.
	delete(profile.Options, OptionNamespace)
	config, err = configOf(profile)
	if err != nil || config.Namespace != "" {
		t.Fatalf("no option should mean no namespace: %#v, %v", config, err)
	}
}

func TestConnWithoutNamespaceTouchesNothing(t *testing.T) {
	conn := namespacedConn("")
	for _, name := range []string{"orders", "ns%orders", "%RETRY%GID", "TBW102", ""} {
		if got := conn.wrap(name); got != name {
			t.Fatalf("wrap(%q) = %q on an unscoped connection", name, got)
		}
		if got := conn.unwrap(name); got != name {
			t.Fatalf("unwrap(%q) = %q on an unscoped connection", name, got)
		}
		if !conn.owns(name) {
			t.Fatalf("an unscoped connection must own %q", name)
		}
	}
}

func TestDestinationRoundTripsThroughTheNamespace(t *testing.T) {
	conn := namespacedConn("ns")

	destination := conn.destinationFromTopic(&model.TopicItem{
		Topic:       "ns%orders",
		Cluster:     "DefaultCluster",
		Subscribers: []string{"ns%GID_orders", "ns%GID_audit"},
	})
	if destination.Ref.Name != "orders" {
		t.Fatalf("Ref.Name = %q, want %q", destination.Ref.Name, "orders")
	}
	// Ref.Namespace stays the cluster: RocketMQ has no namespace object to put
	// there, and the destination list filters on it.
	if destination.Ref.Namespace != "DefaultCluster" {
		t.Fatalf("Ref.Namespace = %q, want the cluster", destination.Ref.Namespace)
	}
	if got := destination.Attribute(AttrSubscribers); got != `["GID_orders","GID_audit"]` {
		t.Fatalf("subscribers = %s, want the short names", got)
	}
}

func TestSubscriptionRoundTripsThroughTheNamespace(t *testing.T) {
	conn := namespacedConn("ns")

	subscription := conn.subscriptionFromGroup(&model.ConsumerGroupItem{
		Group:         "ns%GID_orders",
		Cluster:       "DefaultCluster",
		Subscriptions: []model.GroupSubscription{{Topic: "ns%orders"}},
	})
	if subscription.Ref.Name != "GID_orders" {
		t.Fatalf("Ref.Name = %q, want %q", subscription.Ref.Name, "GID_orders")
	}
	if got := subscription.Attribute(AttrSubscriptions); !strings.Contains(got, `"topic":"orders"`) {
		t.Fatalf("subscriptions = %s, want the short topic", got)
	}
}

func TestMessageDropsTheNamespaceIncludingItsOriginProperties(t *testing.T) {
	conn := namespacedConn("ns")

	item := conn.convertMessageExt(&admin.MessageExt{
		Topic: "%DLQ%ns%GID_orders",
		MsgId: "id",
		Properties: map[string]string{
			primitive.PropertyRetryTopic: "ns%orders",
			primitive.PropertyRealTopic:  "ns%orders",
			"KEYS":                       "order-1",
		},
	})
	if item.Topic != "%DLQ%GID_orders" {
		t.Fatalf("Topic = %q, want %q", item.Topic, "%DLQ%GID_orders")
	}
	if item.Status != model.MsgDLQ {
		t.Fatalf("Status = %v, want the dead-letter status", item.Status)
	}
	for _, key := range []string{primitive.PropertyRetryTopic, primitive.PropertyRealTopic} {
		if got := item.Properties[key]; got != "orders" {
			t.Fatalf("%s = %q, want %q", key, got, "orders")
		}
	}
	if item.Properties["KEYS"] != "order-1" {
		t.Fatal("only the topic properties may be rewritten")
	}
}

func TestMessagePropertiesAreNotMutatedInPlace(t *testing.T) {
	// The tail path reuses the MessageExt it decoded, so unwrapping has to copy.
	properties := map[string]string{primitive.PropertyRealTopic: "ns%orders"}
	namespacedConn("ns").convertMessageExt(&admin.MessageExt{Topic: "ns%orders", Properties: properties})
	if properties[primitive.PropertyRealTopic] != "ns%orders" {
		t.Fatal("the caller's properties map was rewritten")
	}
}

func TestNamespaceScopesWhatAListShows(t *testing.T) {
	conn := namespacedConn("ns")
	cases := []struct {
		name string
		want bool
	}{
		{"ns%orders", true},
		{"%RETRY%ns%GID_orders", true},
		{"other%orders", false},
		{"orders", false},
		// Shared with every namespace, so still visible.
		{"TBW102", true},
	}
	for _, tc := range cases {
		if got := conn.owns(tc.name); got != tc.want {
			t.Fatalf("owns(%q) = %v, want %v", tc.name, got, tc.want)
		}
	}
}
