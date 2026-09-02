package pulsar

import (
	"context"
	"net/http"
	"testing"

	"github.com/apache/pulsar-client-go/pulsaradmin/pkg/utils"

	"github.com/amigoer/mq-studio/internal/model"
)

// topicRoutes is a namespace holding one partitioned topic, one
// non-partitioned one, one non-persistent one and one of Pulsar's own.
func topicRoutes() map[string]string {
	routes := namespaceRoutes()
	// Four paths, because pulsaradmin's List asks all four: partitioned and
	// non-partitioned, each for both storage kinds.
	routes["/admin/v2/persistent/public/default/partitioned"] =
		`["persistent://public/default/orders"]`
	routes["/admin/v2/persistent/public/default"] = `[
		"persistent://public/default/audit",
		"persistent://public/default/__change_events"
	]`
	routes["/admin/v2/non-persistent/public/default/partitioned"] = `[]`
	routes["/admin/v2/non-persistent/public/default"] =
		`["non-persistent://public/default/telemetry"]`

	routes["/admin/v2/persistent/public/default/orders/partitioned-stats"] = `{
		"metadata": {"partitions": 3},
		"msgRateIn": 12.7, "msgRateOut": 9.2, "storageSize": 4096,
		"averageMsgSize": 512,
		"publishers": [{}, {}],
		"subscriptions": {"shared": {"msgBacklog": 40}, "exclusive": {"msgBacklog": 7}},
		"lastPublishTimestamp": 1788290590668
	}`
	// A non-partitioned topic answers 404 at partitioned-stats and 200 at
	// stats, which is what a real broker does - the fake said 200 to both and
	// hid a driver that never read the second endpoint at all.
	routes["/admin/v2/persistent/public/default/audit/stats"] = `{
		"msgRateIn": 0, "msgRateOut": 0, "storageSize": 128,
		"publishers": [],
		"subscriptions": {}
	}`
	routes["/admin/v2/non-persistent/public/default/telemetry/stats"] = `{
		"publishers": [],
		"subscriptions": {}
	}`

	// A ref does not carry which scheme a topic was declared with, so a detail
	// or a delete asks the cluster. Persistent is tried first; only the
	// non-persistent one pays for the extra 404.
	routes["/admin/v2/persistent/public/default/orders/partitions"] = `{"partitions": 3}`
	routes["/admin/v2/persistent/public/default/audit/partitions"] = `{"partitions": 0}`
	routes["/admin/v2/non-persistent/public/default/telemetry/partitions"] = `{"partitions": 0}`
	return routes
}

func topicConn(t *testing.T) *Conn {
	t.Helper()
	cluster := newFakeCluster(t, topicRoutes(), http.StatusNotFound)
	return probedConn(t, cluster.config())
}

func listTopics(t *testing.T, conn *Conn, includeInternal bool) map[string]*model.Destination {
	t.Helper()
	destinations, err := conn.ListDestinations(
		context.Background(), model.DestinationFilter{IncludeInternal: includeInternal})
	if err != nil {
		t.Fatalf("ListDestinations: %v", err)
	}
	byName := make(map[string]*model.Destination, len(destinations))
	for _, destination := range destinations {
		byName[destination.Ref.Name] = destination
	}
	return byName
}

/*
 * Persistent and non-persistent topics are one page.
 *
 * Pulsar returns them as two lists from one call. An operator looking for a
 * topic does not know which storage it was declared with, and a page that
 * showed only one of them would report a topic as missing that is right there.
 */
func TestListDestinationsMergesBothStorageKinds(t *testing.T) {
	topics := listTopics(t, topicConn(t), false)

	if _, ok := topics["orders"]; !ok {
		t.Error("the persistent topic is missing")
	}
	telemetry, ok := topics["telemetry"]
	if !ok {
		t.Fatal("the non-persistent topic is missing")
	}
	if telemetry.Attributes[AttrTopicPersistent] != "false" {
		t.Error("a non-persistent topic is not marked as one, so a delete would use the wrong scheme")
	}
}

// Pulsar's own bookkeeping topics are real topics in the listing, and an
// operator browsing their namespace did not create them.
func TestListDestinationsHidesPulsarsOwnTopicsUnlessAsked(t *testing.T) {
	hidden := listTopics(t, topicConn(t), false)
	if _, ok := hidden["__change_events"]; ok {
		t.Error("an internal topic is listed without the filter asking for it")
	}

	shown := listTopics(t, topicConn(t), true)
	if _, ok := shown["__change_events"]; !ok {
		t.Error("an internal topic is hidden even when the filter asks for it")
	}
}

/*
 * A non-partitioned topic reports zero partitions, and that is a fact rather
 * than a missing figure.
 *
 * Pulsar's two shapes are genuinely different: a non-partitioned topic has no
 * partitions at all, and a topic with one partition is addressed as
 * name-partition-0 and can grow. Reporting the first as unknown would hide
 * that difference on the one page where it decides what an operator can do
 * next.
 */
func TestPartitionCountsDistinguishTheTwoShapes(t *testing.T) {
	topics := listTopics(t, topicConn(t), false)

	if got := topics["orders"].Partitions; got != 3 {
		t.Errorf("the partitioned topic reports %d partitions, want 3", got)
	}
	if got := topics["audit"].Partitions; got != 0 {
		t.Errorf("the non-partitioned topic reports %d partitions, want an explicit 0", got)
	}
}

/*
 * A topic whose stats were refused reports nothing, not zero.
 *
 * The listing succeeded, so the topic exists; only its figures are missing. A
 * zero backlog on a topic nobody could measure is the kind of number an
 * operator acts on.
 */
func TestTopicWithNoStatsKeepsTheUnknownSentinel(t *testing.T) {
	routes := topicRoutes()
	delete(routes, "/admin/v2/persistent/public/default/orders/partitioned-stats")
	cluster := newFakeCluster(t, routes, http.StatusForbidden)
	topics := listTopics(t, probedConn(t, cluster.config()), false)

	orders, ok := topics["orders"]
	if !ok {
		t.Fatal("a topic whose stats were refused was dropped from the listing")
	}
	for name, value := range map[string]int{
		"partitions":  orders.Partitions,
		"subscribers": orders.Subscribers,
		"rateIn":      orders.RateIn,
		"rateOut":     orders.RateOut,
	} {
		if value != model.UnknownMetric {
			t.Errorf("%s = %d on a topic with no stats, want unknown", name, value)
		}
	}
	if orders.Depth != model.UnknownMetric {
		t.Errorf("depth = %d on a topic with no stats, want unknown", orders.Depth)
	}
}

/*
 * A topic's backlog is its deepest subscription, not the sum of them.
 *
 * A Pulsar topic holds one copy of each message and every subscription reads
 * it independently. Two subscriptions forty and seven messages behind means
 * forty messages are still owed - not forty-seven, which is more than the
 * topic holds.
 */
func TestBacklogIsTheDeepestSubscription(t *testing.T) {
	if got := listTopics(t, topicConn(t), false)["orders"].Depth; got != 40 {
		t.Errorf("backlog = %d, want the deepest subscription's 40", got)
	}

	cases := []struct {
		name          string
		subscriptions map[string]utils.SubscriptionStats
		want          int64
	}{
		{
			name:          "no subscription is genuinely no backlog",
			subscriptions: map[string]utils.SubscriptionStats{},
			want:          0,
		},
		{
			name: "one caught up is zero",
			subscriptions: map[string]utils.SubscriptionStats{
				"shared": {MsgBacklog: 0},
			},
			want: 0,
		},
		{
			name: "the deepest wins, not the total",
			subscriptions: map[string]utils.SubscriptionStats{
				"a": {MsgBacklog: 10}, "b": {MsgBacklog: 3}, "c": {MsgBacklog: 25},
			},
			want: 25,
		},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := backlogOf(test.subscriptions); got != test.want {
				t.Errorf("backlogOf = %d, want %d", got, test.want)
			}
		})
	}
}

/*
 * Partition counts only go up, and the driver says so rather than the broker.
 *
 * Pulsar refuses both a reduction and a partitioned-topic edit on a
 * non-partitioned one, but its 409 names metadata rather than the field the
 * operator typed in. Refusing here means the form can point at the input.
 */
func TestUpdateRefusesWhatPulsarCannotDo(t *testing.T) {
	conn := topicConn(t)
	ctx := context.Background()

	partitioned := model.DestinationSpec{
		Ref:        model.DestinationRef{Namespace: "public/default", Name: "orders"},
		Partitions: 2,
	}
	if err := conn.UpdateDestination(ctx, partitioned); err == nil {
		t.Error("lowering a partition count from 3 to 2 was accepted")
	}

	same := partitioned
	same.Partitions = 3
	if err := conn.UpdateDestination(ctx, same); err == nil {
		t.Error("setting a partition count to what it already is was accepted")
	}

	nonPartitioned := model.DestinationSpec{
		Ref:        model.DestinationRef{Namespace: "public/default", Name: "audit"},
		Partitions: 4,
	}
	if err := conn.UpdateDestination(ctx, nonPartitioned); err == nil {
		t.Error("partitioning a non-partitioned topic was accepted")
	}
}

// A negative partition count is refused by name rather than sent, where it
// would come back as a 412 that quotes a URL.
func TestCreateRefusesANegativePartitionCount(t *testing.T) {
	err := topicConn(t).CreateDestination(context.Background(), model.DestinationSpec{
		Ref:        model.DestinationRef{Namespace: "public/default", Name: "orders"},
		Partitions: -1,
	})
	if err == nil {
		t.Error("a topic with a negative partition count was accepted")
	}
}

// The stats panel breaks a partitioned topic down per partition, which is the
// only view that shows one partition carrying the whole topic.
func TestDestinationStatsBreaksDownByPartition(t *testing.T) {
	routes := topicRoutes()
	routes["/admin/v2/persistent/public/default/orders/partitioned-stats"] = `{
		"metadata": {"partitions": 2},
		"storageSize": 4096,
		"publishers": [{}],
		"subscriptions": {"shared": {"msgBacklog": 40}},
		"partitions": {
			"persistent://public/default/orders-partition-0": {
				"storageSize": 4000, "subscriptions": {"shared": {"msgBacklog": 39}}
			},
			"persistent://public/default/orders-partition-1": {
				"storageSize": 96, "subscriptions": {"shared": {"msgBacklog": 1}}
			}
		}
	}`
	cluster := newFakeCluster(t, routes, http.StatusNotFound)
	conn := probedConn(t, cluster.config())

	stats, err := conn.DestinationStats(context.Background(),
		model.DestinationRef{Namespace: "public/default", Name: "orders"})
	if err != nil {
		t.Fatalf("DestinationStats: %v", err)
	}

	partitions, ok := stats["partitions"].([]map[string]interface{})
	if !ok {
		t.Fatalf("partitions is %T", stats["partitions"])
	}
	if len(partitions) != 2 {
		t.Fatalf("%d partitions broken down, want 2", len(partitions))
	}
	// Sorted, so the panel draws them in a stable order rather than whatever
	// order the map happened to iterate in.
	if partitions[0]["name"] != "persistent://public/default/orders-partition-0" {
		t.Errorf("first partition is %v", partitions[0]["name"])
	}
	if partitions[0]["backlog"] != int64(39) {
		t.Errorf("partition 0 backlog = %v, want 39", partitions[0]["backlog"])
	}
}

/*
 * A partitioned topic is one row, not one plus its partitions.
 *
 * On the wire "orders" with three partitions is stored as orders-partition-0,
 * -1 and -2, and Pulsar's non-partitioned listing returns all three as topics
 * in their own right. An operator created one topic and expects one row - and
 * the cross-check against pulsar-admin's own list-partitioned-topics is what
 * caught this listing four.
 */
func TestPartitionsAreNotListedAsTopics(t *testing.T) {
	routes := topicRoutes()
	routes["/admin/v2/persistent/public/default"] = `[
		"persistent://public/default/audit",
		"persistent://public/default/orders-partition-0",
		"persistent://public/default/orders-partition-1",
		"persistent://public/default/orders-partition-2"
	]`
	cluster := newFakeCluster(t, routes, http.StatusNotFound)
	topics := listTopics(t, probedConn(t, cluster.config()), true)

	if _, ok := topics["orders"]; !ok {
		t.Error("the partitioned topic itself is missing")
	}
	for _, partition := range []string{
		"orders-partition-0", "orders-partition-1", "orders-partition-2",
	} {
		if _, ok := topics[partition]; ok {
			t.Errorf("%s is listed as a topic of its own", partition)
		}
	}
	if _, ok := topics["audit"]; !ok {
		t.Error("an ordinary topic was dropped with the partitions")
	}
}

/*
 * A topic that only looks like a partition is still a topic.
 *
 * Matching on the suffix alone would hide a topic somebody genuinely named
 * "orders-partition-0" when there is no partitioned "orders" beside it, and
 * the page would then disagree with the cluster about what exists.
 */
func TestATopicNamedLikeAPartitionSurvivesWithNoParent(t *testing.T) {
	routes := topicRoutes()
	routes["/admin/v2/persistent/public/default/partitioned"] = `[]`
	routes["/admin/v2/persistent/public/default"] =
		`["persistent://public/default/orders-partition-0"]`
	routes["/admin/v2/persistent/public/default/orders-partition-0/stats"] = `{
		"publishers": [], "subscriptions": {}
	}`
	cluster := newFakeCluster(t, routes, http.StatusNotFound)
	topics := listTopics(t, probedConn(t, cluster.config()), true)

	if _, ok := topics["orders-partition-0"]; !ok {
		t.Error("a topic named like a partition was hidden with no parent to belong to")
	}
}
