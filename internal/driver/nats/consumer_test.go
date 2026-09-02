package nats

import (
	"strings"
	"testing"

	"github.com/nats-io/nats.go/jetstream"

	"github.com/amigoer/mq-studio/internal/model"
)

// addConsumer declares one the way the board would, through the driver.
func addConsumer(t *testing.T, conn *Conn, stream, name string, attributes map[string]string) {
	t.Helper()
	spec := model.SubscriptionSpec{
		Ref:        model.SubscriptionRef{Namespace: stream, Name: name},
		Attributes: attributes,
	}
	if err := conn.CreateSubscription(testContext(t), spec); err != nil {
		t.Fatalf("CreateSubscription(%s/%s): %v", stream, name, err)
	}
}

func TestConsumersAreListedAcrossEveryStream(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	declare(t, conn, "EVENTS", map[string]string{AttrSubjects: "events.>"})
	addConsumer(t, conn, "ORDERS", "worker", nil)
	addConsumer(t, conn, "EVENTS", "watcher", nil)

	subscriptions, err := conn.ListSubscriptions(testContext(t))
	if err != nil {
		t.Fatalf("ListSubscriptions: %v", err)
	}
	if len(subscriptions) != 2 {
		t.Fatalf("listed %d consumers, want 2", len(subscriptions))
	}
	// Sorted by stream then name, so the listing is stable between refreshes.
	if subscriptions[0].Ref.Namespace != "EVENTS" || subscriptions[1].Ref.Namespace != "ORDERS" {
		t.Errorf("order = %s/%s, want EVENTS then ORDERS",
			subscriptions[0].Ref.Namespace, subscriptions[1].Ref.Namespace)
	}
	// The stream is half the address. Two streams may both have a "worker".
	for _, subscription := range subscriptions {
		if subscription.Ref.Namespace == "" {
			t.Errorf("%s carries no stream, so it cannot be looked up again", subscription.Ref.Name)
		}
	}
}

// The backlog is what an operator opens the page for: how far behind the
// consumer is, not how many messages the stream holds.
func TestABacklogIsWhatIsLeftForThisConsumer(t *testing.T) {
	conn := jetStreamConn(t)
	ctx := testContext(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	fill(t, conn, "orders.created", 40)
	addConsumer(t, conn, "ORDERS", "worker", nil)

	// Take twenty and acknowledge them, so the consumer is genuinely halfway.
	consumer, err := conn.js.Consumer(ctx, "ORDERS", "worker")
	if err != nil {
		t.Fatalf("Consumer: %v", err)
	}
	batch, err := consumer.Fetch(20)
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	for message := range batch.Messages() {
		if err := message.Ack(); err != nil {
			t.Fatalf("Ack: %v", err)
		}
	}
	if err := batch.Error(); err != nil {
		t.Fatalf("Fetch: %v", err)
	}

	subscription, err := conn.SubscriptionDetail(ctx,
		model.SubscriptionRef{Namespace: "ORDERS", Name: "worker"})
	if err != nil {
		t.Fatalf("SubscriptionDetail: %v", err)
	}
	if subscription.Backlog != 20 {
		t.Errorf("backlog = %d, want 20 of the 40 in the stream", subscription.Backlog)
	}
	if got := subscription.Attributes[AttrAckFloorSeq]; got != "20" {
		t.Errorf("ack floor = %q, want 20", got)
	}
}

/*
 * A pull consumer has no members to count.
 *
 * Clients ask for messages when they want them and hold nothing open in
 * between, so there is nobody attached to count - and reporting zero would say
 * a working consumer is unattended. A push consumer can be answered, and only
 * yes or no: it delivers to one subject and something either listens on it or
 * does not.
 */
func TestAPullConsumerReportsNoMemberCount(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	addConsumer(t, conn, "ORDERS", "puller", nil)
	addConsumer(t, conn, "ORDERS", "pusher", map[string]string{AttrDeliverTo: "deliver.orders"})

	subscriptions, err := conn.ListSubscriptions(testContext(t))
	if err != nil {
		t.Fatalf("ListSubscriptions: %v", err)
	}
	byName := map[string]*model.Subscription{}
	for _, subscription := range subscriptions {
		byName[subscription.Ref.Name] = subscription
	}

	if got := byName["puller"].Members; got != model.UnknownMetric {
		t.Errorf("pull consumer members = %d, want UnknownMetric - there is nobody to count", got)
	}
	if got := byName["pusher"].Members; got != 0 {
		t.Errorf("push consumer members = %d, want 0 - nothing is listening on its subject", got)
	}
	// And the pull consumer reports the one figure it does have, labelled for
	// what it is rather than dressed up as a client count.
	if _, ok := byName["puller"].Attributes[AttrWaiting]; !ok {
		t.Error("pull consumer reports no waiting-request count")
	}
	if _, ok := byName["pusher"].Attributes[AttrWaiting]; ok {
		t.Error("push consumer reports waiting requests, which it does not have")
	}
}

/*
 * A pull consumer with nothing attached is not offline - that is how pull
 * works. What is worth flagging is work handed out and not acknowledged, and
 * redeliveries: both mean something is running and not finishing.
 */
func TestStatusFlagsUnfinishedWorkRatherThanAbsentClients(t *testing.T) {
	conn := jetStreamConn(t)
	ctx := testContext(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	fill(t, conn, "orders.created", 5)
	addConsumer(t, conn, "ORDERS", "idle", nil)
	addConsumer(t, conn, "ORDERS", "stuck", map[string]string{AttrAckWait: "1h"})

	idle, err := conn.SubscriptionDetail(ctx, model.SubscriptionRef{Namespace: "ORDERS", Name: "idle"})
	if err != nil {
		t.Fatalf("SubscriptionDetail(idle): %v", err)
	}
	if idle.Status != model.SubscriptionOnline {
		t.Errorf("an untouched pull consumer is %q, want online", idle.Status)
	}

	// Take messages without acknowledging them. The hour-long ack wait is what
	// keeps that state around long enough to assert on.
	consumer, err := conn.js.Consumer(ctx, "ORDERS", "stuck")
	if err != nil {
		t.Fatalf("Consumer: %v", err)
	}
	batch, err := consumer.Fetch(3)
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	for range batch.Messages() {
		// Deliberately unacknowledged.
	}

	stuck, err := conn.SubscriptionDetail(ctx, model.SubscriptionRef{Namespace: "ORDERS", Name: "stuck"})
	if err != nil {
		t.Fatalf("SubscriptionDetail(stuck): %v", err)
	}
	if stuck.Status != model.SubscriptionWarning {
		t.Errorf("a consumer holding unacknowledged work is %q, want warning", stuck.Status)
	}
	if got := stuck.Attributes[AttrAckPending]; got != "3" {
		t.Errorf("ack pending = %q, want 3", got)
	}
}

// A durable consumer keeps its position across a restart; an ephemeral one is
// cleaned up when nothing is using it. A form that always set durable would
// offer no way to make the other kind.
func TestDurableIsAChoiceRatherThanADefault(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	addConsumer(t, conn, "ORDERS", "keeps", nil)
	addConsumer(t, conn, "ORDERS", "temporary", map[string]string{AttrDurable: "false"})

	ctx := testContext(t)
	keeps, err := conn.SubscriptionDetail(ctx, model.SubscriptionRef{Namespace: "ORDERS", Name: "keeps"})
	if err != nil {
		t.Fatalf("SubscriptionDetail: %v", err)
	}
	if keeps.Attributes[AttrDurable] != "keeps" {
		t.Errorf("durable = %q, want the consumer's name", keeps.Attributes[AttrDurable])
	}

	temporary, err := conn.SubscriptionDetail(ctx,
		model.SubscriptionRef{Namespace: "ORDERS", Name: "temporary"})
	if err != nil {
		t.Fatalf("SubscriptionDetail: %v", err)
	}
	if _, ok := temporary.Attributes[AttrDurable]; ok {
		t.Error("an ephemeral consumer reports a durable name")
	}
}

// A filter is what makes one consumer read part of a stream. Several are
// allowed, and the API refuses both fields at once - which is a detail this
// file has to get right rather than the caller.
func TestAConsumerCanFilterSeveralSubjects(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	addConsumer(t, conn, "ORDERS", "shipped", map[string]string{
		AttrFilterSubject: "orders.shipped, orders.delivered",
	})

	subscription, err := conn.SubscriptionDetail(testContext(t),
		model.SubscriptionRef{Namespace: "ORDERS", Name: "shipped"})
	if err != nil {
		t.Fatalf("SubscriptionDetail: %v", err)
	}
	if got := subscription.Attributes[AttrFilterSubject]; got != "orders.shipped, orders.delivered" {
		t.Errorf("filter = %q, want both subjects", got)
	}
}

// A name alone is not an address: two streams may both have a "worker".
func TestAConsumerReferenceWithoutItsStreamIsRefused(t *testing.T) {
	conn := jetStreamConn(t)
	ctx := testContext(t)
	ref := model.SubscriptionRef{Name: "worker"}

	if _, err := conn.SubscriptionDetail(ctx, ref); err == nil {
		t.Error("SubscriptionDetail accepted a reference with no stream")
	}
	if err := conn.RemoveSubscription(ctx, ref); err == nil {
		t.Error("RemoveSubscription accepted a reference with no stream")
	}
	err := conn.CreateSubscription(ctx, model.SubscriptionSpec{Ref: ref})
	if err == nil {
		t.Error("CreateSubscription accepted a reference with no stream")
	}
}

// A consumer name is not a subject, and the server's own message does not say
// which character it objected to.
func TestConsumerNamesRefuseSubjectPunctuation(t *testing.T) {
	for _, name := range []string{"orders.worker", "worker*", "worker>", "my worker", "a/b", ""} {
		_, err := consumerConfigOf(model.SubscriptionSpec{
			Ref: model.SubscriptionRef{Namespace: "ORDERS", Name: name},
		})
		if err == nil {
			t.Errorf("consumerConfigOf(%q) was accepted", name)
		}
	}
}

func TestCreatingAConsumerThatExistsIsRefused(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	addConsumer(t, conn, "ORDERS", "worker", nil)

	err := conn.CreateSubscription(testContext(t), model.SubscriptionSpec{
		Ref:        model.SubscriptionRef{Namespace: "ORDERS", Name: "worker"},
		Attributes: map[string]string{AttrFilterSubject: "orders.shipped"},
	})
	if err == nil {
		t.Fatal("creating an existing consumer succeeded and would have moved its position")
	}
}

func TestRemovingAConsumerTakesItOutOfTheListing(t *testing.T) {
	conn := jetStreamConn(t)
	ctx := testContext(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	addConsumer(t, conn, "ORDERS", "worker", nil)

	if err := conn.RemoveSubscription(ctx,
		model.SubscriptionRef{Namespace: "ORDERS", Name: "worker"}); err != nil {
		t.Fatalf("RemoveSubscription: %v", err)
	}
	subscriptions, err := conn.ListSubscriptions(ctx)
	if err != nil {
		t.Fatalf("ListSubscriptions: %v", err)
	}
	if len(subscriptions) != 0 {
		t.Errorf("listed %d consumers after removing the only one", len(subscriptions))
	}
}

// A consumer that is not there has to name both halves, or a board showing
// several streams has nothing to attach the failure to.
func TestAMissingConsumerNamesBothHalves(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})

	_, err := conn.SubscriptionDetail(testContext(t),
		model.SubscriptionRef{Namespace: "ORDERS", Name: "absent"})
	if err == nil {
		t.Fatal("reading a consumer that does not exist succeeded")
	}
	if !strings.Contains(err.Error(), "absent") || !strings.Contains(err.Error(), "ORDERS") {
		t.Errorf("error %q does not name both the consumer and its stream", err)
	}
}

// The KV bucket's own consumers are not somebody's work queue, and listing
// them would put rows nobody made among the ones they did.
func TestInternalStreamsContributeNoConsumers(t *testing.T) {
	conn := jetStreamConn(t)
	ctx := testContext(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	if _, err := conn.js.CreateKeyValue(ctx, jetstream.KeyValueConfig{Bucket: "settings"}); err != nil {
		t.Fatalf("CreateKeyValue: %v", err)
	}

	subscriptions, err := conn.ListSubscriptions(ctx)
	if err != nil {
		t.Fatalf("ListSubscriptions: %v", err)
	}
	for _, subscription := range subscriptions {
		if strings.HasPrefix(subscription.Ref.Namespace, "KV_") {
			t.Errorf("%s/%s came from an internal stream",
				subscription.Ref.Namespace, subscription.Ref.Name)
		}
	}
}

func TestConsumerCallsOnAServerWithoutJetStreamSayWhy(t *testing.T) {
	conn := open(t, startServer(t, serverOptions{}), false, false)
	ctx := testContext(t)
	ref := model.SubscriptionRef{Namespace: "ORDERS", Name: "worker"}

	calls := map[string]func() error{
		"list":   func() error { _, err := conn.ListSubscriptions(ctx); return err },
		"detail": func() error { _, err := conn.SubscriptionDetail(ctx, ref); return err },
		"create": func() error {
			return conn.CreateSubscription(ctx, model.SubscriptionSpec{Ref: ref})
		},
		"update": func() error {
			return conn.UpdateSubscription(ctx, model.SubscriptionSpec{Ref: ref})
		},
		"remove": func() error { return conn.RemoveSubscription(ctx, ref) },
	}
	for name, call := range calls {
		t.Run(name, func(t *testing.T) {
			err := call()
			if err == nil {
				t.Fatal("succeeded against a server that stores nothing")
			}
			if err.Error() != jetStreamDisabled {
				t.Errorf("error = %q, want the bare key %q", err, jetStreamDisabled)
			}
		})
	}
}
