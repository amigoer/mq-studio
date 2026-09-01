package redisstream

import (
	"context"
	"testing"

	"github.com/redis/go-redis/v9"

	"github.com/amigoer/mq-studio/internal/model"
)

func TestSubscriptionOf(t *testing.T) {
	got := subscriptionOf("orders:events", redis.XInfoGroup{
		Name:            "settle-group",
		Consumers:       2,
		Pending:         29,
		LastDeliveredID: "1756454641773-2",
		EntriesRead:     1204742,
		Lag:             29,
	})

	// A group name is unique only within its stream, so the reference has to
	// carry both or two streams' "settle-group" become one row.
	if got.Ref.Namespace != "orders:events" || got.Ref.Name != "settle-group" {
		t.Errorf("ref = %+v", got.Ref)
	}
	if got.Members != 2 {
		t.Errorf("members = %d, want 2", got.Members)
	}
	if got.Backlog != 29 {
		t.Errorf("backlog = %d, want the lag", got.Backlog)
	}
	if got.Destinations != 1 {
		t.Errorf("destinations = %d; a redis group reads exactly one stream", got.Destinations)
	}
	if got.RateOut != model.UnknownMetric {
		t.Errorf("rateOut = %d, want UnknownMetric: redis keeps no per-group rate", got.RateOut)
	}
	if got.Attributes[AttrPending] != "29" {
		t.Errorf("pending = %q", got.Attributes[AttrPending])
	}
	if got.Attributes[AttrEntriesRead] != "1204742" {
		t.Errorf("entries-read = %q", got.Attributes[AttrEntriesRead])
	}
}

/*
 * Redis reports lag and entries-read together and reports both as nil when it
 * cannot work them out, which happens once entries a group had not read are
 * deleted. go-redis passes the lag through as -1; entries-read would arrive as
 * a 0 that reads as "this group has read nothing", which is a different and
 * much more alarming claim.
 */
func TestSubscriptionOfAnUndeterminableLag(t *testing.T) {
	got := subscriptionOf("orders:events", redis.XInfoGroup{
		Name: "settle-group",
		Lag:  -1,
	})

	if got.Backlog != model.UnknownMetric {
		t.Errorf("backlog = %d, want UnknownMetric", got.Backlog)
	}
	if value, present := got.Attributes[AttrEntriesRead]; present {
		t.Errorf("entries-read = %q, want it absent when the lag is unknown", value)
	}
}

/*
 * The middle status is the one worth having. A group with nothing attached and
 * nothing pending is an application that is not running, which is often fine.
 * One with nothing attached and entries still pending is work handed out and
 * never acknowledged, and nothing is coming back for it on its own.
 */
func TestGroupStatus(t *testing.T) {
	cases := []struct {
		name  string
		group redis.XInfoGroup
		want  model.SubscriptionStatus
	}{
		{
			name:  "consumers attached",
			group: redis.XInfoGroup{Consumers: 3},
			want:  model.SubscriptionOnline,
		},
		{
			name:  "consumers attached and work outstanding is still online",
			group: redis.XInfoGroup{Consumers: 3, Pending: 40},
			want:  model.SubscriptionOnline,
		},
		{
			name:  "nothing attached, entries still owed",
			group: redis.XInfoGroup{Pending: 12},
			want:  model.SubscriptionWarning,
		},
		{
			name:  "nothing attached, nothing owed",
			group: redis.XInfoGroup{},
			want:  model.SubscriptionOffline,
		},
	}
	for _, tc := range cases {
		if got := groupStatus(tc.group); got != tc.want {
			t.Errorf("%s: status = %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestListSubscriptionsAcrossStreams(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()
	seedStream(t, conn, "orders:events", 4)
	seedStream(t, conn, "payments:captured", 2)
	// No group reads this one, so it must contribute no rows.
	seedStream(t, conn, "audit:trail", 1)

	for _, group := range []struct{ stream, name string }{
		{"orders:events", "settle-group"},
		{"orders:events", "notify-group"},
		{"payments:captured", "capture-group"},
		// The same name on another stream. These are unrelated objects, and a
		// listing keyed on the name alone would show one row for both.
		{"payments:captured", "settle-group"},
	} {
		if err := conn.client.XGroupCreate(ctx, group.stream, group.name, "0").Err(); err != nil {
			t.Fatalf("create %s/%s: %v", group.stream, group.name, err)
		}
	}

	listed, err := conn.ListSubscriptions(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 4 {
		t.Fatalf("listed %d groups, want 4", len(listed))
	}
	seen := map[string]bool{}
	for _, subscription := range listed {
		seen[subscription.Ref.Namespace+"/"+subscription.Ref.Name] = true
	}
	for _, want := range []string{
		"orders:events/settle-group",
		"orders:events/notify-group",
		"payments:captured/capture-group",
		"payments:captured/settle-group",
	} {
		if !seen[want] {
			t.Errorf("%s was not listed", want)
		}
	}
}

func TestListSubscriptionsWithNoGroups(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	seedStream(t, conn, "orders:events", 2)

	listed, err := conn.ListSubscriptions(context.Background())
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 0 {
		t.Errorf("listed %d groups on a stream nothing reads", len(listed))
	}
}

func TestSubscriptionDetail(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()
	seedStream(t, conn, "orders:events", 5)
	if err := conn.client.XGroupCreate(ctx, "orders:events", "settle-group", "0").Err(); err != nil {
		t.Fatalf("create group: %v", err)
	}

	got, err := conn.SubscriptionDetail(ctx, model.SubscriptionRef{
		Namespace: "orders:events",
		Name:      "settle-group",
	})
	if err != nil {
		t.Fatalf("detail: %v", err)
	}
	if got.Ref.Name != "settle-group" {
		t.Errorf("name = %q", got.Ref.Name)
	}

	if _, err := conn.SubscriptionDetail(ctx, model.SubscriptionRef{
		Namespace: "orders:events",
		Name:      "not-a-group",
	}); err == nil {
		t.Error("describing a group that does not exist succeeded")
	}
}

/*
 * Both ways of starting a group are accepted, and an unspecified one takes the
 * safer default.
 *
 * What each start actually does - the position it lands on and the backlog
 * that follows - is asserted against a real server in live_test.go. The
 * in-process one does not model either faithfully: it reports 0 rather than
 * 0-0 for a group created at the beginning, and computes a lag from an
 * entries-added it does not set when a group is created at the end.
 */
func TestCreateSubscriptionAcceptsBothStarts(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()
	seedStream(t, conn, "orders:events", 10)

	if err := conn.CreateSubscription(ctx, model.SubscriptionSpec{
		Ref:        model.SubscriptionRef{Namespace: "orders:events", Name: "from-start"},
		Attributes: map[string]string{AttrStartID: "0"},
	}); err != nil {
		t.Fatalf("create from the beginning: %v", err)
	}
	// Nothing specified defaults to the end, which is the answer that cannot
	// flood a consumer with history it was not expecting.
	if err := conn.CreateSubscription(ctx, model.SubscriptionSpec{
		Ref: model.SubscriptionRef{Namespace: "orders:events", Name: "from-now"},
	}); err != nil {
		t.Fatalf("create with no start: %v", err)
	}

	listed, err := conn.ListSubscriptions(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 2 {
		t.Fatalf("listed %d groups, want both", len(listed))
	}
	for _, subscription := range listed {
		if subscription.Attributes[AttrLastDeliveredID] == "" {
			t.Errorf("%s carries no last-delivered-id", subscription.Ref.Name)
		}
	}
}

// A group asked for on a stream that does not exist is a typo far more often
// than an intention, and MKSTREAM would leave a stream nobody meant to make.
func TestCreateSubscriptionDoesNotCreateTheStream(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()

	err := conn.CreateSubscription(ctx, model.SubscriptionSpec{
		Ref: model.SubscriptionRef{Namespace: "orders:typo", Name: "settle-group"},
	})
	if err == nil {
		t.Fatal("creating a group on a missing stream succeeded")
	}
	listed, err := conn.ListDestinations(ctx, model.DestinationFilter{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 0 {
		t.Errorf("a stream was created as a side effect: %+v", listed)
	}
}

func TestRemoveSubscription(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()
	seedStream(t, conn, "orders:events", 3)
	ref := model.SubscriptionRef{Namespace: "orders:events", Name: "settle-group"}
	if err := conn.CreateSubscription(ctx, model.SubscriptionSpec{Ref: ref}); err != nil {
		t.Fatalf("create: %v", err)
	}

	if err := conn.RemoveSubscription(ctx, ref); err != nil {
		t.Fatalf("remove: %v", err)
	}
	// Destroying a group that is not there returns zero rather than an error,
	// so without the check a second delete would report success.
	if err := conn.RemoveSubscription(ctx, ref); err == nil {
		t.Error("deleting a group that does not exist succeeded")
	}

	// The stream itself is untouched: the entries were never the group's.
	listed, err := conn.ListDestinations(ctx, model.DestinationFilter{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 1 || listed[0].Depth != 3 {
		t.Errorf("the stream changed when its group was removed: %+v", listed)
	}
}

func TestGroupOperationsNeedBothHalvesOfTheReference(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()
	for name, ref := range map[string]model.SubscriptionRef{
		"no stream": {Name: "settle-group"},
		"no group":  {Namespace: "orders:events"},
		"neither":   {},
	} {
		if _, err := conn.SubscriptionDetail(ctx, ref); err == nil {
			t.Errorf("detail with %s succeeded", name)
		}
		if err := conn.RemoveSubscription(ctx, ref); err == nil {
			t.Errorf("remove with %s succeeded", name)
		}
		if err := conn.CreateSubscription(ctx, model.SubscriptionSpec{Ref: ref}); err == nil {
			t.Errorf("create with %s succeeded", name)
		}
	}
}

func TestUpdateSubscriptionIsRefused(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	if err := conn.UpdateSubscription(context.Background(), model.SubscriptionSpec{}); err == nil {
		t.Fatal("updating a group succeeded, but a group has no settings")
	}
}
