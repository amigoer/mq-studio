package pulsar

import (
	"context"
	"net/http"
	"testing"

	"github.com/apache/pulsar-client-go/pulsaradmin/pkg/utils"

	"github.com/amigoer/mq-studio/internal/model"
)

// subscriptionRoutes gives the partitioned topic three subscriptions, one of
// each state a page has to tell apart: reading, idle, and blocked.
func subscriptionRoutes() map[string]string {
	routes := topicRoutes()
	routes["/admin/v2/persistent/public/default/orders/partitioned-stats"] = `{
		"metadata": {"partitions": 3},
		"msgRateIn": 12.7, "msgRateOut": 9.2, "storageSize": 4096,
		"publishers": [{}, {}],
		"subscriptions": {
			"reading": {
				"type": "Shared", "msgBacklog": 40, "msgRateOut": 9.2,
				"unackedMessages": 5, "backlogSize": 20480, "isDurable": true,
				"lastConsumedTimestamp": 1788290590668,
				"consumers": [
					{"consumerName": "worker-1", "availablePermits": 900,
					 "address": "10.0.0.4:51234", "clientVersion": "Pulsar-Go-4.0",
					 "msgRateOut": 9.2, "messageAckRate": 9.0}
				]
			},
			"idle": {
				"type": "Exclusive", "msgBacklog": 0, "isDurable": true,
				"consumers": []
			},
			"stuck": {
				"type": "Key_Shared", "msgBacklog": 900,
				"blockedSubscriptionOnUnackedMsgs": true,
				"unackedMessages": 50000, "isDurable": true,
				"consumers": [{"consumerName": "worker-2", "availablePermits": 0,
				  "blockedConsumerOnUnackedMsgs": true}]
			}
		}
	}`
	routes["/admin/v2/persistent/public/default/audit/stats"] = `{
		"publishers": [],
		"subscriptions": {"archive": {"type": "Failover", "msgBacklog": 3,
			"isDurable": true, "activeConsumerName": "archiver-a",
			"consumers": [{"consumerName": "archiver-a"}, {"consumerName": "archiver-b"}]}}
	}`
	return routes
}

func subscriptionConn(t *testing.T) *Conn {
	t.Helper()
	cluster := newFakeCluster(t, subscriptionRoutes(), http.StatusNotFound)
	return probedConn(t, cluster.config())
}

func listSubscriptions(t *testing.T, conn *Conn) map[string]*model.Subscription {
	t.Helper()
	subscriptions, err := conn.ListSubscriptions(context.Background())
	if err != nil {
		t.Fatalf("ListSubscriptions: %v", err)
	}
	byName := make(map[string]*model.Subscription, len(subscriptions))
	for _, subscription := range subscriptions {
		byName[subscription.Ref.Name] = subscription
	}
	return byName
}

/*
 * A subscription's ref carries the topic it belongs to.
 *
 * Two topics can each have a subscription called "shared" and they are
 * unrelated. Without the topic in the ref the consumers page would show them
 * as one row, and a reset aimed at either would hit whichever the driver
 * happened to find first.
 */
func TestSubscriptionsCarryTheirTopic(t *testing.T) {
	subscriptions := listSubscriptions(t, subscriptionConn(t))

	reading, ok := subscriptions["reading"]
	if !ok {
		t.Fatal("the subscription on the partitioned topic is missing")
	}
	if reading.Ref.Namespace != "persistent://public/default/orders" {
		t.Errorf("ref namespace = %q, want the topic URL", reading.Ref.Namespace)
	}
	if reading.Attributes[AttrSubscriptionTopic] != "persistent://public/default/orders" {
		t.Errorf("topic attribute = %q", reading.Attributes[AttrSubscriptionTopic])
	}

	// The walk covers both topic shapes, because a subscription on a
	// non-partitioned topic is not a lesser kind of subscription.
	if _, ok := subscriptions["archive"]; !ok {
		t.Error("the subscription on the non-partitioned topic is missing")
	}
}

/*
 * Blocked is its own state, not a deep backlog.
 *
 * A blocked subscription has hit the broker's unacked limit and delivery has
 * stopped entirely. From the backlog alone it looks identical to a slow
 * consumer, and the two are fixed in completely different places - one by
 * looking at the consumer, the other by raising a limit or acknowledging.
 */
func TestSubscriptionStatusTellsBlockedFromIdle(t *testing.T) {
	subscriptions := listSubscriptions(t, subscriptionConn(t))

	if got := subscriptions["reading"].Status; got != model.SubscriptionOnline {
		t.Errorf("a subscription with a consumer reads as %q", got)
	}
	if got := subscriptions["idle"].Status; got != model.SubscriptionOffline {
		t.Errorf("a subscription with no consumer reads as %q", got)
	}
	if got := subscriptions["stuck"].Status; got != model.SubscriptionWarning {
		t.Errorf("a blocked subscription reads as %q, want a warning", got)
	}
	if subscriptions["stuck"].Attributes[AttrSubscriptionBlocked] != "true" {
		t.Error("a blocked subscription does not say so in its attributes")
	}
}

/*
 * The subscription type is reported, never edited.
 *
 * Exclusive, Shared, Failover and Key_Shared are chosen by the consumers that
 * attach, not stored as configuration. A form that offered to change it would
 * be offering something the broker has no call for.
 */
func TestSubscriptionTypeIsCarriedAsReported(t *testing.T) {
	subscriptions := listSubscriptions(t, subscriptionConn(t))

	for name, want := range map[string]string{
		"reading": "Shared",
		"idle":    "Exclusive",
		"stuck":   "Key_Shared",
		"archive": "Failover",
	} {
		if got := subscriptions[name].Attributes[AttrSubscriptionType]; got != want {
			t.Errorf("%s type = %q, want %q", name, got, want)
		}
	}

	// And an edit is refused rather than quietly doing nothing.
	err := subscriptionConn(t).UpdateSubscription(context.Background(), model.SubscriptionSpec{
		Ref: subscriptionRef("persistent://public/default/orders", "reading"),
	})
	if err == nil {
		t.Error("editing a pulsar subscription was accepted")
	}
}

// A Failover subscription has one consumer receiving and the rest standing by,
// and which one it is is the question the page is opened to answer.
func TestFailoverSubscriptionNamesItsActiveConsumer(t *testing.T) {
	archive := listSubscriptions(t, subscriptionConn(t))["archive"]

	if archive.Members != 2 {
		t.Errorf("members = %d, want both consumers counted", archive.Members)
	}
	if got := archive.Attributes[AttrSubscriptionActiveConsumer]; got != "archiver-a" {
		t.Errorf("active consumer = %q, want archiver-a", got)
	}
}

/*
 * The broker answers who is attached, so no round trip to a consumer is needed.
 *
 * Pulsar reports every consumer's permits, unacked count and redelivery rate
 * inside the topic's stats. A consumer with zero permits has stopped asking
 * for messages, which looks identical to a slow one from the rate alone - so
 * it is carried rather than dropped.
 */
func TestSubscriptionClientsComeFromTheBroker(t *testing.T) {
	conn := subscriptionConn(t)
	ref := subscriptionRef("persistent://public/default/orders", "reading")

	clients, err := conn.SubscriptionClients(context.Background(), ref)
	if err != nil {
		t.Fatalf("SubscriptionClients: %v", err)
	}
	if len(clients) != 1 {
		t.Fatalf("%d clients, want 1", len(clients))
	}
	client := clients[0]
	if client.ClientID != "worker-1" {
		t.Errorf("client = %q", client.ClientID)
	}
	if client.Properties["availablePermits"] != "900" {
		t.Errorf("permits = %q", client.Properties["availablePermits"])
	}
	if client.Properties["clientVersion"] != "Pulsar-Go-4.0" {
		t.Errorf("version = %q", client.Properties["clientVersion"])
	}

	/*
	 * Assignments and Throughput stay empty rather than being filled in
	 * approximately. Assignments describes queues a consumer holds, which a
	 * Shared subscription has no equivalent of, and Throughput is pull
	 * latencies the broker does not measure per consumer. Inventing either
	 * would put a figure on the page that nothing measured.
	 */
	if len(client.Assignments) != 0 {
		t.Errorf("assignments were invented: %+v", client.Assignments)
	}
	if len(client.Throughput) != 0 {
		t.Errorf("throughput was invented: %+v", client.Throughput)
	}
}

/*
 * A cursor reset means three different things and reaches three different
 * endpoints.
 *
 * All three arrive through one ResetOffsetRequest, so getting the mapping
 * wrong is silent: a force that replayed instead of skipping would hand a
 * consumer a backlog somebody asked to discard.
 */
func TestResetOffsetChoosesTheRightCall(t *testing.T) {
	var called []string
	routes := subscriptionRoutes()
	cluster := newRecordingCluster(t, routes, &called)
	conn := probedConn(t, cluster.config())

	ctx := context.Background()
	const topic = "persistent://public/default/orders"

	if err := conn.ResetOffset(ctx, model.ResetOffsetRequest{
		Group: "reading", Topic: topic, Timestamp: 1788290590668,
	}); err != nil {
		t.Fatalf("reset to a timestamp: %v", err)
	}
	if err := conn.ResetOffset(ctx, model.ResetOffsetRequest{
		Group: "reading", Topic: topic, Force: true,
	}); err != nil {
		t.Fatalf("clear the backlog: %v", err)
	}
	if err := conn.ResetOffset(ctx, model.ResetOffsetRequest{
		Group: "reading", Topic: topic,
	}); err != nil {
		t.Fatalf("reset to the earliest: %v", err)
	}

	want := []string{
		"/admin/v2/persistent/public/default/orders/subscription/reading/resetcursor/1788290590668",
		"/admin/v2/persistent/public/default/orders/subscription/reading/skip_all",
		"/admin/v2/persistent/public/default/orders/subscription/reading/resetcursor/1",
	}
	if len(called) != len(want) {
		t.Fatalf("called %v, want %v", called, want)
	}
	for i, path := range want {
		if called[i] != path {
			t.Errorf("call %d went to %q, want %q", i, called[i], path)
		}
	}

	// A reset with no subscription is refused by name rather than sent as a
	// URL with an empty segment in it.
	if err := conn.ResetOffset(ctx, model.ResetOffsetRequest{Topic: topic}); err == nil {
		t.Error("a reset with no subscription was accepted")
	}
}

// A create starts at the earliest message unless the form asked otherwise: a
// subscription created at the latest position silently discards everything
// already on the topic.
func TestCreateSubscriptionStartsAtTheEarliestByDefault(t *testing.T) {
	var called []string
	cluster := newRecordingCluster(t, subscriptionRoutes(), &called)
	conn := probedConn(t, cluster.config())

	ref := subscriptionRef("persistent://public/default/orders", "fresh")
	if err := conn.CreateSubscription(context.Background(),
		model.SubscriptionSpec{Ref: ref}); err != nil {
		t.Fatalf("CreateSubscription: %v", err)
	}
	if len(called) != 1 {
		t.Fatalf("called %v", called)
	}
	if called[0] != "/admin/v2/persistent/public/default/orders/subscription/fresh" {
		t.Errorf("create went to %q", called[0])
	}
}

// A backlog the broker did not report is not a backlog of zero.
func TestSubscriptionBacklogSurvivesAsReported(t *testing.T) {
	subscriptions := listSubscriptions(t, subscriptionConn(t))

	if got := subscriptions["reading"].Backlog; got != 40 {
		t.Errorf("backlog = %d, want 40", got)
	}
	if got := subscriptions["idle"].Backlog; got != 0 {
		t.Errorf("an idle subscription reports %d, want an explicit 0", got)
	}
}

// A subscription's own attributes distinguish delayed messages from a backlog
// nobody is reading: delayed ones are counted in the backlog and are nobody's
// fault, so a page that could not tell them apart would raise a false alarm.
func TestDelayedMessagesAreReportedSeparately(t *testing.T) {
	stats := utils.SubscriptionStats{MsgBacklog: 100, MsgDelayed: 90, IsDurable: true}
	subscription := newSubscription("persistent://public/default/orders", "s", stats)

	if subscription.Backlog != 100 {
		t.Errorf("backlog = %d, want 100", subscription.Backlog)
	}
	if got := subscription.Attributes[AttrSubscriptionDelayed]; got != "90" {
		t.Errorf("delayed = %q, want 90", got)
	}
}
