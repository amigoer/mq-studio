package pulsar

import (
	"context"
	"net/http"
	"testing"

	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * Where "<topic>-<subscription>-DLQ" divides.
 *
 * Both halves may contain hyphens, so no fixed split is right. What resolves
 * it is the namespace's own topic list, and the cases below are the ones a
 * naive split gets wrong - each of them would address a topic that exists but
 * is not the origin.
 */
func TestSplitDeadLetterName(t *testing.T) {
	existing := map[string]bool{
		"orders":      true,
		"orders-eu":   true,
		"audit":       true,
		"metrics-DLQ": true,
		"a-b-c":       true,
	}

	cases := []struct {
		name         string
		dlq          string
		topic        string
		subscription string
		found        bool
	}{
		{
			name: "the ordinary case", dlq: "orders-worker-DLQ",
			topic: "orders", subscription: "worker", found: true,
		},
		{
			// Both "orders" and "orders-eu" exist, and the longer one is the
			// real origin. Splitting on the first hyphen would file this
			// under "orders" with a subscription called "eu-worker".
			name: "the longest matching topic wins", dlq: "orders-eu-worker-DLQ",
			topic: "orders-eu", subscription: "worker", found: true,
		},
		{
			// Splitting on the last hyphen before the suffix would file this
			// under a topic called "orders-archive" that does not exist.
			name: "a subscription containing hyphens", dlq: "orders-archive-worker-DLQ",
			topic: "orders", subscription: "archive-worker", found: true,
		},
		{
			name: "retries follow the same convention", dlq: "audit-slow-RETRY",
			topic: "audit", subscription: "slow", found: true,
		},
		{
			name: "a topic whose own name ends in the suffix", dlq: "a-b-c-reader-DLQ",
			topic: "a-b-c", subscription: "reader", found: true,
		},
		{
			// The origin was deleted. This is the case most worth surfacing -
			// a backlog nothing will ever drain - so it is reported without a
			// source rather than dropped.
			name: "an orphan whose origin is gone", dlq: "deleted-worker-DLQ", found: false,
		},
		{
			name: "a name that only looks like the convention", dlq: "metrics-DLQ", found: false,
		},
		{
			name: "an ordinary topic", dlq: "orders", found: false,
		},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			topic, subscription, ok := splitDeadLetterName(test.dlq, existing)
			if ok != test.found {
				t.Fatalf("splitDeadLetterName(%q) found = %t, want %t", test.dlq, ok, test.found)
			}
			if !ok {
				return
			}
			if topic != test.topic || subscription != test.subscription {
				t.Errorf("splitDeadLetterName(%q) = %q / %q, want %q / %q",
					test.dlq, topic, subscription, test.topic, test.subscription)
			}
		})
	}
}

func dlqRoutes() map[string]string {
	routes := namespaceRoutes()
	routes["/admin/v2/persistent/public/default/partitioned"] = `[]`
	routes["/admin/v2/persistent/public/default"] = `[
		"persistent://public/default/orders",
		"persistent://public/default/orders-worker-DLQ",
		"persistent://public/default/orders-worker-RETRY",
		"persistent://public/default/gone-reader-DLQ"
	]`
	routes["/admin/v2/non-persistent/public/default/partitioned"] = `[]`
	routes["/admin/v2/non-persistent/public/default"] = `[]`

	routes["/admin/v2/persistent/public/default/orders-worker-DLQ/stats"] = `{
		"publishers": [],
		"subscriptions": {"cleanup": {"msgBacklog": 12, "consumers": [{"consumerName": "c1"}]}}
	}`
	routes["/admin/v2/persistent/public/default/orders-worker-RETRY/stats"] = `{
		"publishers": [], "subscriptions": {}
	}`
	routes["/admin/v2/persistent/public/default/gone-reader-DLQ/stats"] = `{
		"publishers": [], "subscriptions": {"x": {"msgBacklog": 500}}
	}`
	return routes
}

func dlqConn(t *testing.T) *Conn {
	t.Helper()
	cluster := newFakeCluster(t, dlqRoutes(), http.StatusNotFound)
	return probedConn(t, cluster.config())
}

func listDLQ(t *testing.T, conn *Conn) map[string]*model.DeadLetterQueue {
	t.Helper()
	queues, err := conn.DeadLetterQueues(context.Background(), "")
	if err != nil {
		t.Fatalf("DeadLetterQueues: %v", err)
	}
	byName := make(map[string]*model.DeadLetterQueue, len(queues))
	for _, queue := range queues {
		byName[queue.Name] = queue
	}
	return byName
}

/*
 * Only the topics named by the convention appear, and each is traced back to
 * the subscription that gave up on it.
 *
 * The subscription is the answer the page exists for: one topic read by five
 * subscriptions has five separate dead-letter topics, and naming only the
 * topic would not say which reader is failing.
 */
func TestDeadLetterQueuesFindTheirSource(t *testing.T) {
	queues := listDLQ(t, dlqConn(t))

	if _, ok := queues["orders"]; ok {
		t.Error("an ordinary topic is listed as a dead-letter queue")
	}

	dlq, ok := queues["orders-worker-DLQ"]
	if !ok {
		t.Fatal("the dead-letter topic is missing")
	}
	if len(dlq.Sources) != 1 {
		t.Fatalf("%d sources, want 1", len(dlq.Sources))
	}
	if dlq.Sources[0].Queue != "orders" {
		t.Errorf("source topic = %q, want orders", dlq.Sources[0].Queue)
	}
	if dlq.Sources[0].Subscription != "worker" {
		t.Errorf("source subscription = %q, want worker", dlq.Sources[0].Subscription)
	}
	if dlq.Depth != 12 {
		t.Errorf("depth = %d, want 12", dlq.Depth)
	}
	if dlq.Consumers != 1 {
		t.Errorf("consumers = %d, want 1", dlq.Consumers)
	}

	// Retries follow the same convention and belong on the same page: one is
	// a pipeline and one is where it ends up.
	if _, ok := queues["orders-worker-RETRY"]; !ok {
		t.Error("the retry topic is missing")
	}
}

/*
 * An orphan is reported, not dropped.
 *
 * A "-DLQ" topic whose origin was deleted holds a backlog nothing will ever
 * drain and nobody will ever look at, which is the single most useful row on
 * this page. Dropping it because the link could not be resolved would hide
 * exactly that.
 */
func TestOrphanedDeadLetterTopicIsStillListed(t *testing.T) {
	queues := listDLQ(t, dlqConn(t))

	orphan, ok := queues["gone-reader-DLQ"]
	if !ok {
		t.Fatal("a dead-letter topic whose origin is gone was dropped")
	}
	if len(orphan.Sources) != 0 {
		t.Errorf("an orphan claims a source: %+v", orphan.Sources)
	}
	if orphan.Depth != 500 {
		t.Errorf("depth = %d, want the 500 it is holding", orphan.Depth)
	}
}

// A dead-letter topic whose stats could not be read reports unknown, not zero:
// one shown as empty is one nobody investigates.
func TestDeadLetterDepthIsUnknownWhenStatsAreRefused(t *testing.T) {
	routes := dlqRoutes()
	delete(routes, "/admin/v2/persistent/public/default/orders-worker-DLQ/stats")
	cluster := newFakeCluster(t, routes, http.StatusForbidden)
	queues := listDLQ(t, probedConn(t, cluster.config()))

	dlq, ok := queues["orders-worker-DLQ"]
	if !ok {
		t.Fatal("the dead-letter topic was dropped when its stats were refused")
	}
	if dlq.Depth != model.UnknownMetric {
		t.Errorf("depth = %d with no stats, want unknown", dlq.Depth)
	}
}
