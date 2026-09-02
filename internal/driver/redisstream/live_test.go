package redisstream

import (
	"context"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/amigoer/mq-studio/internal/e2e"
	"github.com/amigoer/mq-studio/internal/model"
)

// The addresses and credentials tests/e2e/redis and tests/e2e/redis-cluster
// publish. They are constants rather than environment variables because the
// compose files are the source of truth and a second place to configure them
// is a second place to get them wrong.
const (
	liveAddr        = "127.0.0.1:6479"
	liveClusterAddr = "127.0.0.1:6500"
	liveUser        = "mqstudio"
	livePassword    = "mqstudio"
	// liveReadonlyUser is declared in tests/e2e/redis/users.acl with
	// +@read +@connection and ~mqs-seed:*, which is what makes a real NOPERM
	// reachable.
	liveReadonlyUser     = "mqs-seed-readonly"
	liveReadonlyPassword = "readonly"
)

// requireRedis gates on the standalone environment.
//
// Locally it skips with the command that starts it; in CI it fails, because a
// contract test that can silently not run asserts nothing. See internal/e2e.
func requireRedis(t *testing.T) {
	t.Helper()
	e2e.Require(t, e2e.Env{
		Name:   "redis",
		Family: e2e.Redis,
		Start:  "npm run e2e:redis:up",
		Probe:  e2e.DialTCP(liveAddr),
	})
}

func requireRedisCluster(t *testing.T) {
	t.Helper()
	e2e.Require(t, e2e.Env{
		Name:   "the redis cluster",
		Family: e2e.Redis,
		Start:  "npm run e2e:redis:cluster:up",
		Probe:  e2e.DialTCP(liveClusterAddr),
	})
}

// liveConn opens a connection to the standalone environment, through the same
// Open the app uses.
func liveConn(t *testing.T, options map[string]string, secrets map[string]string) *Conn {
	t.Helper()
	requireRedis(t)
	return openLive(t, liveAddr, options, secrets)
}

func openLive(t *testing.T, addr string, options map[string]string, secrets map[string]string) *Conn {
	t.Helper()
	p := model.ConnectionProfile{
		Name:      "redis-live",
		Kind:      model.KindRedisStream,
		Endpoints: addr,
		Options:   map[string]string{},
		Secrets:   map[string]string{},
	}
	for key, value := range options {
		p.Options[key] = value
	}
	if secrets == nil {
		secrets = map[string]string{SecretUsername: liveUser, SecretPassword: livePassword}
	}
	for key, value := range secrets {
		p.SetSecret(key, value)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	opened, err := New().Open(ctx, p)
	if err != nil {
		t.Fatalf("open %s: %v", addr, err)
	}
	t.Cleanup(func() { _ = opened.Close() })
	return opened.(*Conn)
}

func liveContext(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func TestLiveConnectionPings(t *testing.T) {
	conn := liveConn(t, nil, nil)
	if err := conn.Ping(liveContext(t)); err != nil {
		t.Fatalf("ping: %v", err)
	}
}

// The cluster is dialled through one address, which is the case the
// IsClusterMode flag exists for: without it go-redis would build a plain
// client that answers MOVED for most of the keyspace and never follows it.
func TestLiveClusterConnectionPings(t *testing.T) {
	requireRedisCluster(t)
	conn := openLive(t, liveClusterAddr,
		map[string]string{OptionDeployment: string(DeploymentCluster)},
		// The cluster runs on requirepass, so the default user with a
		// password is the whole credential.
		map[string]string{SecretPassword: livePassword})

	ctx := liveContext(t)
	if err := conn.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}

	// Six nodes, not one. A plain client dialled at the same address answers
	// PING just as happily, so the ping above does not on its own prove the
	// cluster client was built.
	nodes, err := conn.client.ClusterNodes(ctx).Result()
	if err != nil {
		t.Fatalf("cluster nodes: %v", err)
	}
	if lines := strings.Count(strings.TrimSpace(nodes), "\n") + 1; lines != 6 {
		t.Errorf("cluster reports %d nodes, want 6:\n%s", lines, nodes)
	}
}

// A key that does not live on the node dialled has to come back through a
// MOVED redirect the client follows. This is what the announced addresses in
// tests/e2e/redis-cluster/cluster.sh exist for, and it is the one thing a
// single-server environment cannot check.
func TestLiveClusterFollowsRedirects(t *testing.T) {
	requireRedisCluster(t)
	conn := openLive(t, liveClusterAddr,
		map[string]string{OptionDeployment: string(DeploymentCluster)},
		map[string]string{SecretPassword: livePassword})
	ctx := liveContext(t)

	// Six keys that hash to different slots between them, so at least some
	// are owned by a node other than the one the client dialled.
	for _, suffix := range []string{"a", "b", "c", "d", "e", "f"} {
		key := "mqs-live-redirect:" + suffix
		if err := conn.client.Set(ctx, key, suffix, time.Minute).Err(); err != nil {
			t.Fatalf("set %s: %v", key, err)
		}
		t.Cleanup(func() { _ = conn.client.Del(context.Background(), key).Err() })
	}
}

/*
 * The degrade classification, against errors a real server produced.
 *
 * degradeReason is pinned by a table in degrade_test.go, and that table builds
 * its own error values - so it proves the branches are wired to the right
 * reasons and nothing about whether those prefixes are what Redis actually
 * sends. This is the other half, and it is the half that would catch a server
 * release rewording a reply.
 */
func TestLiveRejectedCredentialReadsAsTheCredential(t *testing.T) {
	conn := liveConn(t, nil, map[string]string{
		SecretUsername: liveUser,
		SecretPassword: "not-the-password",
	})

	err := conn.Ping(liveContext(t))
	if err == nil {
		t.Fatal("ping succeeded with the wrong password")
	}
	if got := degradeReason(err); got != credentialsRejected {
		t.Errorf("degradeReason(%v) = %q, want %q", err, got, credentialsRejected)
	}
}

func TestLiveUnknownUserReadsAsTheCredential(t *testing.T) {
	conn := liveConn(t, nil, map[string]string{
		SecretUsername: "nobody",
		SecretPassword: "whatever",
	})

	err := conn.Ping(liveContext(t))
	if err == nil {
		t.Fatal("ping succeeded as a user that does not exist")
	}
	if got := degradeReason(err); got != credentialsRejected {
		t.Errorf("degradeReason(%v) = %q, want %q", err, got, credentialsRejected)
	}
}

// A credential the server accepts, with an ACL that refuses the command. It is
// a different fix in a different place from a wrong password, and the only way
// to be sure Redis still says NOPERM is to make it say so.
func TestLiveForbiddenCommandReadsAsForbidden(t *testing.T) {
	conn := liveConn(t, nil, map[string]string{
		SecretUsername: liveReadonlyUser,
		SecretPassword: liveReadonlyPassword,
	})
	ctx := liveContext(t)

	// The readonly user connects and reads; it holds +@read, so a write is
	// what it cannot do.
	if err := conn.Ping(ctx); err != nil {
		e2e.Missing(t, "the %s user cannot connect; check tests/e2e/redis/users.acl (%v)", liveReadonlyUser, err)
	}
	err := conn.client.XAdd(ctx, &redis.XAddArgs{
		Stream: "mqs-live-denied",
		Values: map[string]any{"denied": "1"},
	}).Err()
	if err == nil {
		t.Fatal("the readonly user was allowed to write")
	}
	if got := degradeReason(err); got != credentialsForbidden {
		t.Errorf("degradeReason(%v) = %q, want %q", err, got, credentialsForbidden)
	}
}

// A healthy connection declares the family's whole best case and degrades
// nothing. The interesting half is the second: a capability quietly degraded
// against a working server takes a finished page out of the sidebar, and the
// user is told the broker cannot do something it can.
func TestLiveConnectionDeclaresTheFullCapabilitySet(t *testing.T) {
	conn := liveConn(t, nil, nil)
	declared := conn.Capabilities()
	for _, capability := range capabilities() {
		if !declared.Has(capability) {
			t.Errorf("%s is not supported against a healthy server", capability)
		}
	}
	if got := len(declared.Degraded); got != 0 {
		t.Errorf("a healthy connection degrades %d capabilities: %v", got, declared.Degraded)
	}
}

// liveStreams is a key prefix outside the seed's, so a test's own fixtures
// never collide with what `npm run e2e:redis:seed` left for a person to look
// at, and a failed run cannot delete it.
const liveStreams = "mqs-live:"

// seedLiveStream writes entries and removes the key afterwards, whatever the
// test did with it.
func seedLiveStream(t *testing.T, conn *Conn, key string, count int) {
	t.Helper()
	ctx := liveContext(t)
	t.Cleanup(func() { _ = conn.client.Del(context.Background(), key).Err() })
	for i := range count {
		err := conn.client.XAdd(ctx, &redis.XAddArgs{
			Stream: key,
			Values: map[string]any{"seq": strconv.Itoa(i)},
		}).Err()
		if err != nil {
			t.Fatalf("seed %s: %v", key, err)
		}
	}
}

func TestLiveListDestinations(t *testing.T) {
	conn := liveConn(t, map[string]string{OptionStreamFilter: liveStreams + "list:*"}, nil)
	ctx := liveContext(t)

	seedLiveStream(t, conn, liveStreams+"list:orders", 5)
	seedLiveStream(t, conn, liveStreams+"list:payments", 2)
	// A key of another type inside the same pattern. The scan is filtered by
	// the server, and this is what proves the filter is on the wire rather
	// than applied afterwards.
	if err := conn.client.Set(ctx, liveStreams+"list:counter", "7", time.Minute).Err(); err != nil {
		t.Fatalf("seed string: %v", err)
	}
	t.Cleanup(func() { _ = conn.client.Del(context.Background(), liveStreams+"list:counter").Err() })

	listed, err := conn.ListDestinations(ctx, model.DestinationFilter{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	byName := map[string]*model.Destination{}
	for _, destination := range listed {
		byName[destination.Ref.Name] = destination
	}
	if len(listed) != 2 {
		t.Fatalf("listed %d entries, want the two streams: %v", len(listed), byName)
	}
	orders := byName[liveStreams+"list:orders"]
	if orders == nil {
		t.Fatalf("the orders stream was not listed")
	}
	if orders.Depth != 5 {
		t.Errorf("depth = %d, want 5", orders.Depth)
	}
	if orders.Attributes[AttrLastEntryID] == "" {
		t.Errorf("no last entry id on a stream with entries")
	}
	// MEMORY USAGE is not something the in-process server answers, so this is
	// the only place the column is known to be filled at all.
	if orders.Attributes[AttrMemoryBytes] == "" {
		t.Errorf("no memory figure; the list column would be empty")
	}
}

// XINFO STREAM's own group count is what the listing uses, and the in-process
// server does not fill it in - so this is the only test that can catch it
// being read from the wrong field.
func TestLiveListDestinationsCountsGroups(t *testing.T) {
	conn := liveConn(t, map[string]string{OptionStreamFilter: liveStreams + "groups:*"}, nil)
	ctx := liveContext(t)
	key := liveStreams + "groups:orders"
	seedLiveStream(t, conn, key, 3)
	for _, group := range []string{"settle-group", "notify-group"} {
		if err := conn.client.XGroupCreate(ctx, key, group, "0").Err(); err != nil {
			t.Fatalf("create group %s: %v", group, err)
		}
	}

	listed, err := conn.ListDestinations(ctx, model.DestinationFilter{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 1 {
		t.Fatalf("listed %d streams, want 1", len(listed))
	}
	if listed[0].Subscribers != 2 {
		t.Errorf("subscribers = %d, want 2", listed[0].Subscribers)
	}
}

func TestLiveCreateAndRemoveDestination(t *testing.T) {
	conn := liveConn(t, map[string]string{OptionStreamFilter: liveStreams + "lifecycle:*"}, nil)
	ctx := liveContext(t)
	key := liveStreams + "lifecycle:orders"
	t.Cleanup(func() { _ = conn.client.Del(context.Background(), key).Err() })

	if err := conn.CreateDestination(ctx, model.DestinationSpec{
		Ref: model.DestinationRef{Name: key},
	}); err != nil {
		t.Fatalf("create: %v", err)
	}

	listed, err := conn.ListDestinations(ctx, model.DestinationFilter{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 1 || listed[0].Ref.Name != key {
		t.Fatalf("listed %d streams after creating one", len(listed))
	}
	// The bootstrap group MKSTREAM needed must not survive: an operator
	// opening the new stream would find a consumer group they did not make.
	if listed[0].Subscribers != 0 {
		t.Errorf("the new stream reports %d groups, want none", listed[0].Subscribers)
	}
	if listed[0].Depth != 0 {
		t.Errorf("the new stream holds %d entries, want none", listed[0].Depth)
	}

	if err := conn.RemoveDestination(ctx, model.DestinationRef{Name: key}); err != nil {
		t.Fatalf("remove: %v", err)
	}
	listed, err = conn.ListDestinations(ctx, model.DestinationFilter{})
	if err != nil {
		t.Fatalf("list after remove: %v", err)
	}
	if len(listed) != 0 {
		t.Errorf("the stream is still listed after being deleted")
	}
}

// A cluster keeps its keyspace on several masters and SCAN answers for one
// node, so a driver that asked the node it dialled would list a third of the
// streams and look entirely correct doing it.
func TestLiveClusterListsStreamsFromEveryMaster(t *testing.T) {
	requireRedisCluster(t)
	conn := openLive(t, liveClusterAddr, map[string]string{
		OptionDeployment:   string(DeploymentCluster),
		OptionStreamFilter: liveStreams + "cluster:*",
	}, map[string]string{SecretPassword: livePassword})
	ctx := liveContext(t)

	// Twelve keys, so the hash slots spread them across all three masters.
	// With one per node the test would pass on a driver that got lucky.
	const count = 12
	for i := range count {
		key := liveStreams + "cluster:" + strconv.Itoa(i)
		seedLiveStream(t, conn, key, 1)
	}

	listed, err := conn.ListDestinations(ctx, model.DestinationFilter{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != count {
		t.Fatalf("listed %d of %d streams; a scan that asked one master would look like this", len(listed), count)
	}
	for _, destination := range listed {
		if destination.Depth != 1 {
			t.Errorf("%s depth = %d, want 1", destination.Ref.Name, destination.Depth)
		}
	}
}

func TestLiveTrimByLength(t *testing.T) {
	conn := liveConn(t, map[string]string{OptionStreamFilter: liveStreams + "trim:*"}, nil)
	ctx := liveContext(t)
	key := liveStreams + "trim:orders"
	seedLiveStream(t, conn, key, 20)

	result, err := conn.Trim(ctx, model.TrimRequest{
		Ref:      model.DestinationRef{Name: key},
		Strategy: model.TrimMaxLen,
		MaxLen:   5,
	})
	if err != nil {
		t.Fatalf("trim: %v", err)
	}
	if result.Removed != 15 {
		t.Errorf("removed = %d, want 15", result.Removed)
	}

	length, err := conn.client.XLen(ctx, key).Result()
	if err != nil {
		t.Fatalf("xlen: %v", err)
	}
	if length != 5 {
		t.Errorf("kept %d entries, want exactly 5", length)
	}
}

/*
 * The approximate form, which only a real server models.
 *
 * Redis stops at a macro node boundary rather than splitting one, so the
 * stream keeps at least the length asked for and possibly more. That is the
 * contract the dialog promises, and the direction of the inequality is the
 * whole of it: keeping fewer than asked would be data lost that the user was
 * told would be kept.
 */
func TestLiveApproximateTrimNeverKeepsFewerThanAsked(t *testing.T) {
	conn := liveConn(t, map[string]string{OptionStreamFilter: liveStreams + "approx:*"}, nil)
	ctx := liveContext(t)
	key := liveStreams + "approx:orders"
	seedLiveStream(t, conn, key, 200)

	if _, err := conn.Trim(ctx, model.TrimRequest{
		Ref:      model.DestinationRef{Name: key},
		Strategy: model.TrimMaxLen,
		MaxLen:   50,
		Approx:   true,
	}); err != nil {
		t.Fatalf("trim: %v", err)
	}

	length, err := conn.client.XLen(ctx, key).Result()
	if err != nil {
		t.Fatalf("xlen: %v", err)
	}
	if length < 50 {
		t.Errorf("kept %d entries after asking to keep at least 50", length)
	}
}

// Emptying a stream is a trim to zero, and it must leave the key and every
// group's read position where they were. A page that reached for DEL here
// would take the consumers' progress with it.
func TestLiveTrimToZeroKeepsTheKeyAndTheGroups(t *testing.T) {
	conn := liveConn(t, map[string]string{OptionStreamFilter: liveStreams + "empty:*"}, nil)
	ctx := liveContext(t)
	key := liveStreams + "empty:orders"
	seedLiveStream(t, conn, key, 12)
	if err := conn.client.XGroupCreate(ctx, key, "settle-group", "0").Err(); err != nil {
		t.Fatalf("create group: %v", err)
	}
	if err := conn.client.XReadGroup(ctx, &redis.XReadGroupArgs{
		Group:    "settle-group",
		Consumer: "worker-1",
		Streams:  []string{key, ">"},
		Count:    4,
	}).Err(); err != nil {
		t.Fatalf("read: %v", err)
	}
	before, err := conn.client.XInfoGroups(ctx, key).Result()
	if err != nil {
		t.Fatalf("groups before: %v", err)
	}

	if _, err := conn.Trim(ctx, model.TrimRequest{
		Ref:      model.DestinationRef{Name: key},
		Strategy: model.TrimMaxLen,
		MaxLen:   0,
	}); err != nil {
		t.Fatalf("trim: %v", err)
	}

	after, err := conn.client.XInfoGroups(ctx, key).Result()
	if err != nil {
		t.Fatalf("groups after: %v", err)
	}
	if len(after) != 1 {
		t.Fatalf("the group did not survive emptying the stream: %+v", after)
	}
	if after[0].LastDeliveredID != before[0].LastDeliveredID {
		t.Errorf("last-delivered-id moved from %s to %s; a trim is not a reset",
			before[0].LastDeliveredID, after[0].LastDeliveredID)
	}
}

// XDEL moves max-deleted-entry-id, which is the only record that a gap in the
// ids was deliberate. Without it, a reader finding a missing id cannot tell a
// deletion from a read that went wrong.
func TestLiveDeleteEntriesRecordsTheGap(t *testing.T) {
	conn := liveConn(t, map[string]string{OptionStreamFilter: liveStreams + "xdel:*"}, nil)
	ctx := liveContext(t)
	key := liveStreams + "xdel:orders"
	seedLiveStream(t, conn, key, 6)

	entries, err := conn.client.XRange(ctx, key, "-", "+").Result()
	if err != nil {
		t.Fatalf("xrange: %v", err)
	}
	target := entries[2].ID

	result, err := conn.DeleteEntries(ctx, model.DestinationRef{Name: key}, []string{target})
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	if result.Removed != 1 {
		t.Errorf("removed = %d, want 1", result.Removed)
	}

	listed, err := conn.ListDestinations(ctx, model.DestinationFilter{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 1 {
		t.Fatalf("listed %d streams", len(listed))
	}
	if got := listed[0].Attributes[AttrMaxDeletedEntryID]; got != target {
		t.Errorf("max-deleted-entry-id = %q, want %q", got, target)
	}
}

/*
 * Where a group starts, against a server that computes it properly.
 *
 * Both answers are destructive in opposite directions and neither is
 * reversible without a reposition: "$" on a stream with history means the
 * group never sees any of it, "0" replays all of it into whatever attaches
 * next. The backlog each produces is the thing an operator reads to tell which
 * one they got.
 */
func TestLiveCreateSubscriptionStartPosition(t *testing.T) {
	conn := liveConn(t, map[string]string{OptionStreamFilter: liveStreams + "groupstart:*"}, nil)
	ctx := liveContext(t)
	key := liveStreams + "groupstart:orders"
	seedLiveStream(t, conn, key, 10)

	for name, start := range map[string]string{"from-start": "0", "from-now": "$"} {
		if err := conn.CreateSubscription(ctx, model.SubscriptionSpec{
			Ref:        model.SubscriptionRef{Namespace: key, Name: name},
			Attributes: map[string]string{AttrStartID: start},
		}); err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
	}

	byName := map[string]*model.Subscription{}
	listed, err := conn.ListSubscriptions(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	for _, subscription := range listed {
		if subscription.Ref.Namespace == key {
			byName[subscription.Ref.Name] = subscription
		}
	}
	if len(byName) != 2 {
		t.Fatalf("listed %d groups on %s, want 2", len(byName), key)
	}

	if got := byName["from-start"].Backlog; got != 10 {
		t.Errorf("a group created at 0 has a backlog of %d, want the whole stream", got)
	}
	if got := byName["from-start"].Attributes[AttrLastDeliveredID]; got != "0-0" {
		t.Errorf("a group created at 0 starts at %q, want 0-0", got)
	}
	if got := byName["from-now"].Backlog; got != 0 {
		t.Errorf("a group created at the end has a backlog of %d, want 0", got)
	}
	// Offline, not online: nothing has attached to either yet, and neither
	// owes anything.
	if got := byName["from-now"].Status; got != model.SubscriptionOffline {
		t.Errorf("status = %q, want offline", got)
	}
}

/*
 * A group with nothing attached and entries still pending is the state worth
 * separating from idle: work was handed out and never acknowledged, and
 * nothing is coming back for it until something attaches or claims it.
 */
func TestLiveGroupWithUnacknowledgedWorkAndNoConsumerReadsAsWarning(t *testing.T) {
	conn := liveConn(t, map[string]string{OptionStreamFilter: liveStreams + "warn:*"}, nil)
	ctx := liveContext(t)
	key := liveStreams + "warn:orders"
	seedLiveStream(t, conn, key, 6)
	if err := conn.client.XGroupCreate(ctx, key, "settle-group", "0").Err(); err != nil {
		t.Fatalf("create group: %v", err)
	}
	// Read without acknowledging, then drop the consumer. The entries stay in
	// the group's pending list with nobody holding them.
	if err := conn.client.XReadGroup(ctx, &redis.XReadGroupArgs{
		Group:    "settle-group",
		Consumer: "worker-1",
		Streams:  []string{key, ">"},
		Count:    3,
	}).Err(); err != nil {
		t.Fatalf("read: %v", err)
	}

	before, err := conn.SubscriptionDetail(ctx, model.SubscriptionRef{Namespace: key, Name: "settle-group"})
	if err != nil {
		t.Fatalf("detail: %v", err)
	}
	if before.Status != model.SubscriptionOnline {
		t.Errorf("status with a consumer attached = %q, want online", before.Status)
	}
	if before.Members != 1 {
		t.Errorf("members = %d, want 1", before.Members)
	}

	if err := conn.client.XGroupDelConsumer(ctx, key, "settle-group", "worker-1").Err(); err != nil {
		t.Fatalf("remove consumer: %v", err)
	}
	after, err := conn.SubscriptionDetail(ctx, model.SubscriptionRef{Namespace: key, Name: "settle-group"})
	if err != nil {
		t.Fatalf("detail after: %v", err)
	}
	// Removing the consumer discards its pending entries back to nobody, so
	// what is left is a group with no members. Whether it warns depends on
	// what the server did with the pending list, and either answer is a real
	// state - what must not happen is a group reporting members it has not.
	if after.Members != 0 {
		t.Errorf("members after removing the consumer = %d, want 0", after.Members)
	}
	if after.Status == model.SubscriptionOnline {
		t.Errorf("status = online with no consumer attached")
	}
}

// Deleting entries a group had not read leaves Redis unable to work out the
// lag, and it says so with nil rather than with a number. A zero there would
// read as "fully caught up" on a group that is anything but.
func TestLiveUndeterminableLagIsNotZero(t *testing.T) {
	conn := liveConn(t, map[string]string{OptionStreamFilter: liveStreams + "lag:*"}, nil)
	ctx := liveContext(t)
	key := liveStreams + "lag:orders"
	seedLiveStream(t, conn, key, 10)
	if err := conn.client.XGroupCreate(ctx, key, "settle-group", "0").Err(); err != nil {
		t.Fatalf("create group: %v", err)
	}

	entries, err := conn.client.XRange(ctx, key, "-", "+").Result()
	if err != nil {
		t.Fatalf("xrange: %v", err)
	}
	// Delete entries the group has not read. Redis then cannot count what is
	// between its position and the end.
	if _, err := conn.DeleteEntries(ctx, model.DestinationRef{Name: key},
		[]string{entries[2].ID, entries[3].ID}); err != nil {
		t.Fatalf("delete entries: %v", err)
	}

	detail, err := conn.SubscriptionDetail(ctx, model.SubscriptionRef{Namespace: key, Name: "settle-group"})
	if err != nil {
		t.Fatalf("detail: %v", err)
	}
	if detail.Backlog == 0 {
		t.Errorf("backlog = 0 after deleting unread entries; an unknown lag must not read as caught up")
	}
	if detail.Backlog != model.UnknownMetric {
		// Redis may still manage to count it, which is a fine outcome - what
		// is not fine is a zero. Record which happened so a server release
		// changing this is visible rather than silent.
		t.Logf("the server still computed a lag of %d", detail.Backlog)
	} else if _, present := detail.Attributes[AttrEntriesRead]; present {
		t.Errorf("entries-read travelled alongside an unknown lag")
	}
}

func TestLiveRemoveSubscriptionLeavesTheStream(t *testing.T) {
	conn := liveConn(t, map[string]string{OptionStreamFilter: liveStreams + "groupdel:*"}, nil)
	ctx := liveContext(t)
	key := liveStreams + "groupdel:orders"
	seedLiveStream(t, conn, key, 5)
	ref := model.SubscriptionRef{Namespace: key, Name: "settle-group"}
	if err := conn.CreateSubscription(ctx, model.SubscriptionSpec{
		Ref:        ref,
		Attributes: map[string]string{AttrStartID: "0"},
	}); err != nil {
		t.Fatalf("create: %v", err)
	}

	if err := conn.RemoveSubscription(ctx, ref); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if err := conn.RemoveSubscription(ctx, ref); err == nil {
		t.Error("deleting a group twice succeeded the second time")
	}

	// The entries were never the group's, so they stay.
	length, err := conn.client.XLen(ctx, key).Result()
	if err != nil {
		t.Fatalf("xlen: %v", err)
	}
	if length != 5 {
		t.Errorf("the stream holds %d entries after its group was removed, want 5", length)
	}
}

/*
 * Repositioning a group, and the two things it does not do.
 *
 * Both surprises cost someone a debugging session. Moving a group forward does
 * not clear the entries it has already been handed and not acknowledged - they
 * stay owed to the consumers holding them - and nothing is redelivered on its
 * own. A page that called this a "reset" would send an operator looking for
 * messages that were never going to arrive.
 */
func TestLiveSetSubscriptionPosition(t *testing.T) {
	conn := liveConn(t, map[string]string{OptionStreamFilter: liveStreams + "setid:*"}, nil)
	ctx := liveContext(t)
	key := liveStreams + "setid:orders"
	seedLiveStream(t, conn, key, 10)
	ref := model.SubscriptionRef{Namespace: key, Name: "settle-group"}
	if err := conn.CreateSubscription(ctx, model.SubscriptionSpec{
		Ref:        ref,
		Attributes: map[string]string{AttrStartID: "0"},
	}); err != nil {
		t.Fatalf("create group: %v", err)
	}
	// Hand out four entries and acknowledge none, so there is a pending list
	// to watch across the reposition.
	if err := conn.client.XReadGroup(ctx, &redis.XReadGroupArgs{
		Group:    "settle-group",
		Consumer: "worker-1",
		Streams:  []string{key, ">"},
		Count:    4,
	}).Err(); err != nil {
		t.Fatalf("read: %v", err)
	}

	entries, err := conn.client.XRange(ctx, key, "-", "+").Result()
	if err != nil {
		t.Fatalf("xrange: %v", err)
	}
	target := entries[7].ID

	if err := conn.SetSubscriptionPosition(ctx, model.PositionRequest{
		Ref:      ref,
		Position: target,
	}); err != nil {
		t.Fatalf("reposition: %v", err)
	}

	detail, err := conn.SubscriptionDetail(ctx, ref)
	if err != nil {
		t.Fatalf("detail: %v", err)
	}
	if got := detail.Attributes[AttrLastDeliveredID]; got != target {
		t.Errorf("last-delivered-id = %q, want %q", got, target)
	}
	// The pending list is untouched. This is the assertion worth having: a
	// reposition that silently discarded unacknowledged work would look like
	// it had succeeded and would have lost four entries' worth of state.
	if got := detail.Attributes[AttrPending]; got != "4" {
		t.Errorf("pending = %q after repositioning, want the four still owed", got)
	}
}

// Moving a group to the end is how an operator abandons a backlog they have
// decided not to process. The lag has to reflect it, or the page would keep
// reporting work that is never coming.
func TestLiveRepositionToTheEndClearsTheLag(t *testing.T) {
	conn := liveConn(t, map[string]string{OptionStreamFilter: liveStreams + "skip:*"}, nil)
	ctx := liveContext(t)
	key := liveStreams + "skip:orders"
	seedLiveStream(t, conn, key, 25)
	ref := model.SubscriptionRef{Namespace: key, Name: "settle-group"}
	if err := conn.CreateSubscription(ctx, model.SubscriptionSpec{
		Ref:        ref,
		Attributes: map[string]string{AttrStartID: "0"},
	}); err != nil {
		t.Fatalf("create group: %v", err)
	}

	before, err := conn.SubscriptionDetail(ctx, ref)
	if err != nil {
		t.Fatalf("detail before: %v", err)
	}
	if before.Backlog != 25 {
		t.Fatalf("backlog before = %d, want the whole stream", before.Backlog)
	}

	if err := conn.SetSubscriptionPosition(ctx, model.PositionRequest{
		Ref:      ref,
		Position: PositionEnd,
	}); err != nil {
		t.Fatalf("reposition: %v", err)
	}
	after, err := conn.SubscriptionDetail(ctx, ref)
	if err != nil {
		t.Fatalf("detail after: %v", err)
	}
	if after.Backlog != 0 {
		t.Errorf("backlog after moving to the end = %d, want 0", after.Backlog)
	}
}

// And the other direction: back to the beginning replays what the stream still
// holds, which is not what it ever held - trimmed entries do not come back.
func TestLiveRepositionToTheBeginningReplaysWhatSurvives(t *testing.T) {
	conn := liveConn(t, map[string]string{OptionStreamFilter: liveStreams + "replay:*"}, nil)
	ctx := liveContext(t)
	key := liveStreams + "replay:orders"
	seedLiveStream(t, conn, key, 20)
	ref := model.SubscriptionRef{Namespace: key, Name: "settle-group"}
	if err := conn.CreateSubscription(ctx, model.SubscriptionSpec{
		Ref:        ref,
		Attributes: map[string]string{AttrStartID: "$"},
	}); err != nil {
		t.Fatalf("create group: %v", err)
	}
	// Trim first, so what comes back is what survives rather than everything.
	if _, err := conn.Trim(ctx, model.TrimRequest{
		Ref:      model.DestinationRef{Name: key},
		Strategy: model.TrimMaxLen,
		MaxLen:   12,
	}); err != nil {
		t.Fatalf("trim: %v", err)
	}

	if err := conn.SetSubscriptionPosition(ctx, model.PositionRequest{
		Ref:      ref,
		Position: PositionBeginning,
	}); err != nil {
		t.Fatalf("reposition: %v", err)
	}
	after, err := conn.SubscriptionDetail(ctx, ref)
	if err != nil {
		t.Fatalf("detail: %v", err)
	}
	if after.Backlog != 12 {
		t.Errorf("backlog = %d after moving to the beginning, want the 12 that survived the trim", after.Backlog)
	}
}

/*
 * The time window, against a server that generates the ids from its own clock.
 *
 * This is the one place the canonical query shape fits Redis without a seam,
 * and the sequence bounds are what make it fit: entries written in the same
 * millisecond share the id's first half, and a window that ended at <ms>-0
 * would drop all but the first of them. On a busy stream that is most of the
 * entries, and the loss would be invisible - the page would simply show fewer
 * rows.
 */
func TestLiveQueryMessagesInATimeWindow(t *testing.T) {
	conn := liveConn(t, map[string]string{OptionStreamFilter: liveStreams + "browse:*"}, nil)
	ctx := liveContext(t)
	key := liveStreams + "browse:orders"
	// Written as fast as the loop goes, so several share a millisecond.
	seedLiveStream(t, conn, key, 40)

	all, err := conn.QueryMessages(ctx, model.MessageQueryParams{Topic: key, MaxResults: 100})
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if len(all) != 40 {
		t.Fatalf("read %d entries, want 40", len(all))
	}
	// Newest first.
	if all[0].StoreTimestamp < all[len(all)-1].StoreTimestamp {
		t.Errorf("the newest entry is not first")
	}

	// A window covering exactly the millisecond of the newest entry has to
	// include every entry stamped with it, not only the first.
	newest := all[0].StoreTimestamp
	sameMillisecond := 0
	for _, item := range all {
		if item.StoreTimestamp == newest {
			sameMillisecond++
		}
	}
	window, err := conn.QueryMessages(ctx, model.MessageQueryParams{
		Topic:      key,
		StartTime:  newest,
		EndTime:    newest,
		MaxResults: 100,
	})
	if err != nil {
		t.Fatalf("windowed query: %v", err)
	}
	if len(window) != sameMillisecond {
		t.Errorf("a window on one millisecond returned %d of the %d entries stamped with it",
			len(window), sameMillisecond)
	}
}

// The id is the timestamp: Redis generates it from its own clock, so the store
// time the panel shows is the server's rather than anything derived here.
func TestLiveEntryTimestampComesFromTheID(t *testing.T) {
	conn := liveConn(t, map[string]string{OptionStreamFilter: liveStreams + "stamp:*"}, nil)
	ctx := liveContext(t)
	key := liveStreams + "stamp:orders"
	seedLiveStream(t, conn, key, 1)

	items, err := conn.QueryMessages(ctx, model.MessageQueryParams{Topic: key})
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("read %d entries, want 1", len(items))
	}
	head, _, _ := strings.Cut(items[0].MessageID, "-")
	if strconv.FormatInt(items[0].StoreTimestamp, 10) != head {
		t.Errorf("store timestamp %d does not match the id %q", items[0].StoreTimestamp, items[0].MessageID)
	}
	if items[0].StoreTime == "" {
		t.Error("no formatted store time")
	}
}

func TestLiveMessageByID(t *testing.T) {
	conn := liveConn(t, map[string]string{OptionStreamFilter: liveStreams + "byid:*"}, nil)
	ctx := liveContext(t)
	key := liveStreams + "byid:orders"
	seedLiveStream(t, conn, key, 5)

	all, err := conn.QueryMessages(ctx, model.MessageQueryParams{Topic: key})
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	target := all[2].MessageID

	item, err := conn.MessageByID(ctx, key, target)
	if err != nil {
		t.Fatalf("by id: %v", err)
	}
	if item.MessageID != target {
		t.Errorf("id = %q, want %q", item.MessageID, target)
	}
	if item.Properties["seq"] == "" {
		t.Errorf("the entry came back with no fields: %+v", item.Properties)
	}

	// An entry that was deleted is gone rather than empty, and saying so is
	// what stops the panel rendering a blank message.
	if _, err := conn.DeleteEntries(ctx, model.DestinationRef{Name: key}, []string{target}); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := conn.MessageByID(ctx, key, target); err == nil {
		t.Error("looking up a deleted entry succeeded")
	}
}

/*
 * Field order, which only a real server can show.
 *
 * The in-process server and go-redis both hand fields back as a map, so a
 * write that reordered them would be invisible offline. Here the raw reply is
 * read back over the wire, where the order is still the producer's.
 */
func TestLiveAddEntryKeepsTheFieldOrder(t *testing.T) {
	conn := liveConn(t, map[string]string{OptionStreamFilter: liveStreams + "xadd:*"}, nil)
	ctx := liveContext(t)
	key := liveStreams + "xadd:orders"
	seedLiveStream(t, conn, key, 1)

	result, err := conn.AddEntry(ctx, model.StreamAddRequest{
		Ref: model.DestinationRef{Name: key},
		Fields: []model.StreamField{
			{Name: "zeta", Value: "1"},
			{Name: "alpha", Value: "2"},
			{Name: "mid", Value: "3"},
		},
	})
	if err != nil {
		t.Fatalf("add: %v", err)
	}

	// The raw reply, so the order survives: a typed read would turn it into a
	// map before this test could look.
	reply, err := conn.client.Do(ctx, "XRANGE", key, result.IDs[0], result.IDs[0]).Result()
	if err != nil {
		t.Fatalf("raw xrange: %v", err)
	}
	rendered := fmt.Sprint(reply)
	zeta := strings.Index(rendered, "zeta")
	alpha := strings.Index(rendered, "alpha")
	if zeta < 0 || alpha < 0 {
		t.Fatalf("the entry came back without its fields: %s", rendered)
	}
	if zeta > alpha {
		t.Errorf("the fields were reordered on the way out: %s", rendered)
	}
}

// An explicit id has to be higher than the last, which is what keeps a stream
// ordered. The refusal is Redis's and is worth passing through: an operator
// pasting an old id needs to be told it is too small, not that the send failed.
func TestLiveAddEntryRefusesAnIDThatIsNotHigher(t *testing.T) {
	conn := liveConn(t, map[string]string{OptionStreamFilter: liveStreams + "xaddid:*"}, nil)
	ctx := liveContext(t)
	key := liveStreams + "xaddid:orders"
	seedLiveStream(t, conn, key, 3)

	all, err := conn.QueryMessages(ctx, model.MessageQueryParams{Topic: key})
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	oldest := all[len(all)-1].MessageID

	_, err = conn.AddEntry(ctx, model.StreamAddRequest{
		Ref:    model.DestinationRef{Name: key},
		ID:     oldest,
		Fields: []model.StreamField{{Name: "order", Value: "A-1001"}},
	})
	if err == nil {
		t.Fatal("writing an entry with an id that already exists succeeded")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "equal or smaller") {
		t.Logf("the server's wording for a too-small id has changed: %v", err)
	}
}

// A send of many that fails partway has still written the ones before it. The
// ids come back with the error so the caller knows to go and look.
func TestLiveAddEntryReportsWhatItWroteBeforeFailing(t *testing.T) {
	conn := liveConn(t, map[string]string{OptionStreamFilter: liveStreams + "partial:*"}, nil)
	ctx := liveContext(t)
	key := liveStreams + "partial:orders"
	seedLiveStream(t, conn, key, 1)

	// Deleting the stream mid-send is not something a test can time reliably,
	// so this asserts the shape instead: a successful send returns every id it
	// wrote, which is the same field a partial one reports through.
	result, err := conn.AddEntry(ctx, model.StreamAddRequest{
		Ref:    model.DestinationRef{Name: key},
		Count:  4,
		Fields: []model.StreamField{{Name: "order", Value: "A-1001"}},
	})
	if err != nil {
		t.Fatalf("add: %v", err)
	}
	if len(result.IDs) != 4 {
		t.Fatalf("returned %d ids for a count of 4", len(result.IDs))
	}
	for _, id := range result.IDs {
		if _, err := conn.MessageByID(ctx, key, id); err != nil {
			t.Errorf("id %s was reported but cannot be read back: %v", id, err)
		}
	}
}

// livePendingFixture leaves a group holding work from two consumers.
func livePendingFixture(t *testing.T, suffix string) (*Conn, model.SubscriptionRef) {
	t.Helper()
	conn := liveConn(t, map[string]string{OptionStreamFilter: liveStreams + suffix + ":*"}, nil)
	ctx := liveContext(t)
	key := liveStreams + suffix + ":orders"
	seedLiveStream(t, conn, key, 20)
	if err := conn.client.XGroupCreate(ctx, key, "settle-group", "0").Err(); err != nil {
		t.Fatalf("create group: %v", err)
	}
	for consumer, count := range map[string]int64{"worker-1": 6, "worker-2": 3} {
		err := conn.client.XReadGroup(ctx, &redis.XReadGroupArgs{
			Group:    "settle-group",
			Consumer: consumer,
			Streams:  []string{key, ">"},
			Count:    count,
		}).Err()
		if err != nil {
			t.Fatalf("hand out to %s: %v", consumer, err)
		}
	}
	return conn, model.SubscriptionRef{Namespace: key, Name: "settle-group"}
}

// The idle time is what an operator acts on, and only a real server advances
// it: the in-process one reports whatever it reports, and a filter built on it
// could be inverted without any offline test noticing.
func TestLivePendingEntriesFilterByIdleTime(t *testing.T) {
	conn, ref := livePendingFixture(t, "pel")
	ctx := liveContext(t)

	// Everything was handed out a moment ago, so a minimum idle of a minute
	// must match none of it. Getting this backwards would show a healthy
	// group's whole in-flight list as stuck work.
	stuck, err := conn.PendingEntries(ctx, model.PendingQuery{Ref: ref, MinIdleMs: 60_000})
	if err != nil {
		t.Fatalf("entries: %v", err)
	}
	if len(stuck) != 0 {
		t.Errorf("%d entries were reported idle for a minute moments after being handed out", len(stuck))
	}

	// And with no minimum, all nine.
	all, err := conn.PendingEntries(ctx, model.PendingQuery{Ref: ref})
	if err != nil {
		t.Fatalf("entries: %v", err)
	}
	if len(all) != 9 {
		t.Fatalf("listed %d entries, want 9", len(all))
	}
	for _, entry := range all {
		if entry.IdleMs < 0 {
			t.Errorf("entry %s reports a negative idle time", entry.ID)
		}
	}
}

// The guard that stops a claim taking work from a consumer that is merely
// busy. Without it both consumers believe they own the same entry.
func TestLiveClaimHonoursTheMinimumIdleTime(t *testing.T) {
	conn, ref := livePendingFixture(t, "claimguard")
	ctx := liveContext(t)

	entries, err := conn.PendingEntries(ctx, model.PendingQuery{Ref: ref, Consumer: "worker-1"})
	if err != nil {
		t.Fatalf("entries: %v", err)
	}
	ids := []string{entries[0].ID}

	// Handed out a moment ago, so a minute's guard must refuse it.
	guarded, err := conn.ClaimEntries(ctx, model.ClaimRequest{
		Ref:       ref,
		Consumer:  "worker-3",
		IDs:       ids,
		MinIdleMs: 60_000,
	})
	if err != nil {
		t.Fatalf("guarded claim: %v", err)
	}
	if len(guarded.Claimed) != 0 {
		t.Errorf("a claim guarded by a minute took %v from a consumer that had just been given it", guarded.Claimed)
	}

	// With no guard it moves, which is the deliberate "that consumer is gone"
	// case.
	forced, err := conn.ClaimEntries(ctx, model.ClaimRequest{
		Ref:      ref,
		Consumer: "worker-3",
		IDs:      ids,
	})
	if err != nil {
		t.Fatalf("claim: %v", err)
	}
	if len(forced.Claimed) != 1 {
		t.Errorf("claimed %v, want the one entry", forced.Claimed)
	}
}

/*
 * An auto-claim reports what it found gone as well as what it moved.
 *
 * An entry can be in a pending list and no longer in the stream - trimmed or
 * deleted while owed to somebody - and the auto-claim drops those rather than
 * moving them. That is work lost rather than reassigned, and go-redis's typed
 * helper throws the list away, which is why this driver parses the reply
 * itself. This is the test that would notice if it stopped.
 */
func TestLiveAutoClaimReportsWhatWasLost(t *testing.T) {
	conn, ref := livePendingFixture(t, "autoclaim")
	ctx := liveContext(t)

	entries, err := conn.PendingEntries(ctx, model.PendingQuery{Ref: ref})
	if err != nil {
		t.Fatalf("entries: %v", err)
	}
	// Delete two entries out from under the consumers holding them.
	gone := []string{entries[0].ID, entries[1].ID}
	if _, err := conn.DeleteEntries(ctx, model.DestinationRef{Name: ref.Namespace}, gone); err != nil {
		t.Fatalf("delete: %v", err)
	}

	result, err := conn.AutoClaim(ctx, model.AutoClaimRequest{
		Ref:      ref,
		Consumer: "worker-3",
		Count:    100,
	})
	if err != nil {
		t.Fatalf("auto-claim: %v", err)
	}
	if len(result.Claimed) != 7 {
		t.Errorf("claimed %d entries, want the 7 that still exist", len(result.Claimed))
	}
	if len(result.Deleted) != 2 {
		t.Errorf("reported %v as gone, want the two that were deleted", result.Deleted)
	}
	// "0-0" is the walk having reached the end, which is what a caller needs
	// to know not to ask again.
	if result.NextStart != "0-0" {
		t.Errorf("next start = %q, want 0-0 after covering the whole list", result.NextStart)
	}
}

// Inactive is Redis 7.2 and later, and is not the same as idle: a consumer
// polling an empty stream is idle and not inactive. Reading the wrong one
// would call a busy consumer dead.
func TestLiveGroupConsumersReportIdleAndInactive(t *testing.T) {
	conn, ref := livePendingFixture(t, "consumers")
	ctx := liveContext(t)

	consumers, err := conn.GroupConsumers(ctx, ref)
	if err != nil {
		t.Fatalf("consumers: %v", err)
	}
	if len(consumers) != 2 {
		t.Fatalf("listed %d consumers, want 2", len(consumers))
	}
	byName := map[string]*model.GroupConsumer{}
	for _, consumer := range consumers {
		byName[consumer.Name] = consumer
	}
	if byName["worker-1"].Pending != 6 {
		t.Errorf("worker-1 holds %d, want 6", byName["worker-1"].Pending)
	}
	if byName["worker-2"].Pending != 3 {
		t.Errorf("worker-2 holds %d, want 3", byName["worker-2"].Pending)
	}
	for _, consumer := range consumers {
		if consumer.IdleMs < 0 || consumer.InactiveMs < 0 {
			t.Errorf("%s reports idle %d, inactive %d", consumer.Name, consumer.IdleMs, consumer.InactiveMs)
		}
	}
}

/*
 * INFO against a real server, which is the only place most of it exists: the
 * in-process one answers connected_clients and nothing else, so every other
 * figure on the node board is covered here or by the parser tests over
 * captured output.
 */
func TestLiveListNodesOnAStandaloneServer(t *testing.T) {
	conn := liveConn(t, nil, nil)
	ctx := liveContext(t)

	nodes, err := conn.ListNodes(ctx)
	if err != nil {
		t.Fatalf("list nodes: %v", err)
	}
	if len(nodes) != 1 {
		t.Fatalf("listed %d nodes for a standalone server, want 1", len(nodes))
	}
	node := nodes[0]
	if node.Address != liveAddr {
		t.Errorf("address = %q, want %q", node.Address, liveAddr)
	}
	if node.Version == "" {
		t.Error("no version reported")
	}
	if node.Status != model.NodeOnline {
		t.Errorf("status = %q, want online", node.Status)
	}
	for _, key := range []string{AttrRole, AttrMode, AttrUptimeSeconds, AttrConnectedClients, AttrUsedMemory, AttrOpsPerSec} {
		if node.Attributes[key] == "" {
			t.Errorf("attribute %s is empty; the node board would show a gap", key)
		}
	}
	// Redis reports memory, not disk. A percentage here would be a figure the
	// server never gave.
	if node.DiskUsage != model.UnknownMetric {
		t.Errorf("disk usage = %d, want UnknownMetric", node.DiskUsage)
	}
}

func TestLiveNodeConfig(t *testing.T) {
	conn := liveConn(t, nil, nil)
	ctx := liveContext(t)

	settings, err := conn.NodeConfig(ctx, liveAddr)
	if err != nil {
		t.Fatalf("node config: %v", err)
	}
	if len(settings) < 50 {
		t.Fatalf("read %d settings; CONFIG GET * should answer with hundreds", len(settings))
	}
	// The two this environment sets deliberately, so a config read that
	// silently returned defaults would be caught.
	if settings["appendonly"] != "yes" {
		t.Errorf("appendonly = %q, want yes", settings["appendonly"])
	}
	if settings["slowlog-log-slower-than"] != "0" {
		t.Errorf("slowlog-log-slower-than = %q, want 0", settings["slowlog-log-slower-than"])
	}
}

/*
 * The slow log, which the environment makes assertable by logging every
 * command. What is checked is the shape of an entry rather than that Redis was
 * slow: the client name is this app's own, which is what lets an operator tell
 * their console apart from the service they are debugging.
 */
func TestLiveSlowLog(t *testing.T) {
	conn := liveConn(t, nil, nil)
	ctx := liveContext(t)

	// Run something recognisable, then look for it.
	if err := conn.client.Ping(ctx).Err(); err != nil {
		t.Fatalf("ping: %v", err)
	}

	entries, err := conn.SlowLog(ctx, liveAddr, 50)
	if err != nil {
		t.Fatalf("slow log: %v", err)
	}
	if len(entries) == 0 {
		e2e.Missing(t, "the slow log is empty; this environment sets slowlog-log-slower-than to 0")
	}

	// Newest first: the page is opened after something went wrong.
	for index := 1; index < len(entries); index++ {
		if entries[index-1].ID < entries[index].ID {
			t.Fatalf("entry %d has a lower id than the one after it", index-1)
		}
	}
	newest := entries[0]
	if newest.TimestampMs == 0 {
		t.Error("no timestamp")
	}
	if len(newest.Command) == 0 {
		t.Error("no command recorded")
	}
	if newest.ClientAddress == "" {
		t.Error("no client address; go-redis's typed helper drops this field, which is why the reply is parsed here")
	}
	// The client name is this connection's, set from the profile name at
	// connect time.
	found := false
	for _, entry := range entries {
		if strings.HasPrefix(entry.ClientName, clientName) {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("no entry carries this app's client name; CLIENT SETNAME may not be reaching the server")
	}
}

/*
 * Both of Redis's maintenance tasks are additive - a snapshot writes the
 * dataset down and a rewrite compacts the append-only file - so unlike a
 * retention sweep neither loses anything. What they are is asynchronous: the
 * server accepts the request and the outcome shows up in INFO afterwards.
 */
func TestLiveRunMaintenance(t *testing.T) {
	conn := liveConn(t, nil, nil)
	ctx := liveContext(t)

	for _, task := range []model.MaintenanceTask{model.TaskSnapshot, model.TaskRewriteAppendLog} {
		if err := conn.RunMaintenance(ctx, liveAddr, task); err != nil {
			t.Errorf("%s: %v", task, err)
		}
	}

	// The status the node board reads back. It is the only place the outcome
	// appears, since the commands return as soon as the child process starts.
	node, err := conn.NodeDetail(ctx, liveAddr)
	if err != nil {
		t.Fatalf("node detail: %v", err)
	}
	if node.Attributes[AttrRDBLastStatus] == "" {
		t.Error("no last-snapshot status reported")
	}
}

// A cluster is every master and replica, and the roles come from CLUSTER NODES
// rather than from each node's INFO: during a failover the two disagree, and
// the topology is the authority on which is which.
func TestLiveListNodesOnACluster(t *testing.T) {
	requireRedisCluster(t)
	conn := openLive(t, liveClusterAddr,
		map[string]string{OptionDeployment: string(DeploymentCluster)},
		map[string]string{SecretPassword: livePassword})
	ctx := liveContext(t)

	nodes, err := conn.ListNodes(ctx)
	if err != nil {
		t.Fatalf("list nodes: %v", err)
	}
	if len(nodes) != 6 {
		t.Fatalf("listed %d nodes, want the cluster's 6", len(nodes))
	}

	masters, replicas := 0, 0
	for _, node := range nodes {
		switch node.Attributes[AttrRole] {
		case "master":
			masters++
		case "replica":
			replicas++
		default:
			t.Errorf("node %s has role %q", node.Address, node.Attributes[AttrRole])
		}
		if node.Attributes[AttrNodeID] == "" {
			t.Errorf("node %s carries no cluster id", node.Address)
		}
		// Every node is filled in from its own INFO, which is what a serial
		// walk of a six-node cluster would make slow and a per-node client is
		// what makes possible at all.
		if node.Version == "" {
			t.Errorf("node %s was listed without reaching it", node.Address)
		}
	}
	if masters != 3 || replicas != 3 {
		t.Errorf("read %d masters and %d replicas, want 3 and 3", masters, replicas)
	}
}

func TestLiveClusterOverview(t *testing.T) {
	requireRedisCluster(t)
	conn := openLive(t, liveClusterAddr,
		map[string]string{OptionDeployment: string(DeploymentCluster)},
		map[string]string{SecretPassword: livePassword})

	overview, err := conn.ClusterOverview(liveContext(t))
	if err != nil {
		t.Fatalf("overview: %v", err)
	}
	if overview.TotalNodes != 6 || overview.OnlineNodes != 6 {
		t.Errorf("nodes = %d total, %d online", overview.TotalNodes, overview.OnlineNodes)
	}
	// A cluster that has lost slots cannot serve the keys in them, and nothing
	// in the node list says so.
	if overview.Attributes[AttrClusterState] != "ok" {
		t.Errorf("cluster state = %q", overview.Attributes[AttrClusterState])
	}
	if overview.Attributes[AttrClusterSlots] != "16384" {
		t.Errorf("slots assigned = %q, want the full range", overview.Attributes[AttrClusterSlots])
	}
	// Counting streams and groups would mean scanning the keyspace on every
	// header refresh. The pages that list them count what they list.
	if overview.Destinations != model.UnknownMetric || overview.Subscriptions != model.UnknownMetric {
		t.Errorf("the header counted objects it would have had to scan for: %+v", overview)
	}
}

/*
 * CLIENT LIST against a real server, which is the only place it exists: the
 * in-process one does not implement the command at all.
 */
func TestLiveListClientConnections(t *testing.T) {
	conn := liveConn(t, nil, nil)
	ctx := liveContext(t)
	// Make sure this connection has actually been used, so it appears with a
	// command recorded against it rather than as a bare socket.
	if err := conn.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}

	connections, err := conn.ListClientConnections(ctx, "")
	if err != nil {
		t.Fatalf("list connections: %v", err)
	}
	if len(connections) == 0 {
		t.Fatal("no connections listed; this one is at least there")
	}

	// This app's own, found by the name CLIENT SETNAME set from the profile.
	var mine *model.ClientConnection
	for _, connection := range connections {
		if strings.HasPrefix(connection.ClientName, clientName) {
			mine = connection
			break
		}
	}
	if mine == nil {
		t.Fatalf("this connection is not in the list under %q; CLIENT SETNAME may not be reaching the server", clientName)
	}
	if mine.Name == "" {
		t.Error("no client id, which is what a close request names")
	}
	if mine.PeerHost == "" || mine.PeerPort == 0 {
		t.Errorf("peer = %q:%d", mine.PeerHost, mine.PeerPort)
	}
	if mine.User != liveUser {
		t.Errorf("user = %q, want %q", mine.User, liveUser)
	}
	if mine.Attributes[AttrLastCommand] == "" {
		t.Error("no last command recorded")
	}
	if mine.ConnectedAtMs == 0 {
		t.Error("no connect time derived from the reported age")
	}
}

/*
 * Killing a client by id, and the case that makes the id matter: an address is
 * reused the moment its port is, and an id never repeats. This opens a second
 * connection, kills it, and checks the first one - this test's own - survived.
 */
func TestLiveCloseClientConnection(t *testing.T) {
	conn := liveConn(t, nil, nil)
	ctx := liveContext(t)

	victim := openLive(t, liveAddr, nil, nil)
	if err := victim.Ping(ctx); err != nil {
		t.Fatalf("open the second connection: %v", err)
	}

	before, err := conn.ListClientConnections(ctx, "")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	// The one to kill is any connection that is not the one doing the killing.
	self, err := conn.client.ClientID(ctx).Result()
	if err != nil {
		t.Fatalf("client id: %v", err)
	}
	target := ""
	for _, connection := range before {
		if connection.Name != strconv.FormatInt(self, 10) {
			target = connection.Name
			break
		}
	}
	if target == "" {
		e2e.Missing(t, "only one connection is open; nothing to close")
	}

	if err := conn.CloseClientConnection(ctx, target, "test"); err != nil {
		t.Fatalf("close %s: %v", target, err)
	}
	// Killing an id that has already gone succeeds and closes nothing, which
	// must not read as a second success.
	if err := conn.CloseClientConnection(ctx, target, "test"); err == nil {
		t.Error("closing the same client twice succeeded the second time")
	}
	// And the connection doing the killing is still usable.
	if err := conn.Ping(ctx); err != nil {
		t.Errorf("the connection that issued the kill did not survive it: %v", err)
	}
}

/*
 * The ACL surface against a real server, which is the only place it exists at
 * all: the in-process one has no ACL commands.
 */
func TestLiveListAclUsers(t *testing.T) {
	conn := liveConn(t, nil, nil)
	ctx := liveContext(t)

	users, err := conn.ListAclUsers(ctx)
	if err != nil {
		t.Fatalf("list acl users: %v", err)
	}
	byName := map[string]*model.AclUser{}
	for _, user := range users {
		byName[user.Name] = user
	}

	// The three tests/e2e/redis/users.acl declares.
	for _, name := range []string{"default", liveUser, liveReadonlyUser} {
		if byName[name] == nil {
			e2e.Missing(t, "the acl user %q is not on this broker; check tests/e2e/redis/users.acl", name)
		}
	}

	// default is off with no password at all, which is what makes an
	// anonymous connection refusable and the degraded path assertable.
	if byName["default"].Enabled {
		t.Error("the default user is enabled; an anonymous connection would be accepted")
	}
	if byName["default"].NoPassword {
		t.Error("the default user reads as nopass, which would accept any password")
	}

	// The restricted one is where the rules actually differ, and is why the
	// environment declares it.
	readonly := byName[liveReadonlyUser]
	if !readonly.Enabled || readonly.PasswordCount == 0 {
		t.Errorf("%s = %+v", liveReadonlyUser, readonly)
	}
	if len(readonly.KeyPatterns) == 0 {
		t.Errorf("%s carries no key pattern; the column would be a constant", liveReadonlyUser)
	}
	if !strings.Contains(readonly.CommandRules, "+@read") {
		t.Errorf("command rules = %q, want the read grant", readonly.CommandRules)
	}
	if readonly.Rule == "" {
		t.Error("no rule line, which is the form an operator checks against")
	}
}

func TestLiveAclCategories(t *testing.T) {
	conn := liveConn(t, nil, nil)
	categories, err := conn.AclCategories(liveContext(t))
	if err != nil {
		t.Fatalf("acl categories: %v", err)
	}
	if len(categories) < 10 {
		t.Fatalf("read %d categories; a server reports around twenty", len(categories))
	}
	for _, want := range []string{"read", "write", "admin", "dangerous"} {
		if !slices.Contains(categories, want) {
			t.Errorf("@%s is not among the categories: %v", want, categories)
		}
	}
}

/*
 * The reset, and the reason for it.
 *
 * SETUSER is additive, so an edit that removes a key pattern has to reset the
 * user first or the pattern stays and the form has lied about what it saved.
 * The cost of the reset is the passwords, which is why the save puts the
 * existing hashes back - and this asserts both halves: the removed pattern is
 * gone, and the user can still authenticate afterwards.
 */
func TestLiveSaveAclUserReplacesRatherThanMerges(t *testing.T) {
	conn := liveConn(t, nil, nil)
	ctx := liveContext(t)
	const name = "mqs-live-acl"
	t.Cleanup(func() { _ = conn.RemoveAclUser(context.Background(), name) })

	if err := conn.SaveAclUser(ctx, model.AclUserSpec{
		Name:            name,
		Enabled:         true,
		Password:        "first-password",
		KeyPatterns:     []string{"~one:*", "~two:*"},
		ChannelPatterns: []string{"&*"},
		CommandRules:    []string{"-@all", "+@read"},
	}); err != nil {
		t.Fatalf("create: %v", err)
	}

	created, err := conn.aclUser(ctx, name)
	if err != nil || created == nil {
		t.Fatalf("the user was not created: %v", err)
	}
	if len(created.KeyPatterns) != 2 {
		t.Fatalf("key patterns = %v, want both", created.KeyPatterns)
	}

	// Save again with one pattern removed and no password named.
	if err := conn.SaveAclUser(ctx, model.AclUserSpec{
		Name:            name,
		Enabled:         true,
		KeyPatterns:     []string{"~one:*"},
		ChannelPatterns: []string{"&*"},
		CommandRules:    []string{"-@all", "+@read"},
	}); err != nil {
		t.Fatalf("edit: %v", err)
	}

	edited, err := conn.aclUser(ctx, name)
	if err != nil || edited == nil {
		t.Fatalf("the user disappeared: %v", err)
	}
	if len(edited.KeyPatterns) != 1 || edited.KeyPatterns[0] != "~one:*" {
		t.Errorf("key patterns = %v; the removed one survived the edit", edited.KeyPatterns)
	}
	// The password survived a save that was not about it. Without the hashes
	// being re-applied this would be zero and the application would be locked
	// out by an edit to its key patterns.
	if edited.PasswordCount != 1 {
		t.Errorf("password count = %d after an unrelated edit, want the password kept", edited.PasswordCount)
	}

	// And it still authenticates, which is the thing the count is standing in
	// for. The user is granted @connection as well as @read, because PING is
	// in the first and not the second - a read-only account that cannot ping
	// is the subject of the next test rather than a problem with this one.
	if err := conn.SaveAclUser(ctx, model.AclUserSpec{
		Name:         name,
		Enabled:      true,
		KeyPatterns:  []string{"~one:*"},
		CommandRules: []string{"-@all", "+@read", "+@connection"},
	}); err != nil {
		t.Fatalf("grant connection commands: %v", err)
	}
	check := openLive(t, liveAddr, nil, map[string]string{
		SecretUsername: name,
		SecretPassword: "first-password",
	})
	if err := check.Ping(ctx); err != nil {
		t.Errorf("the user cannot authenticate after the edit: %v", err)
	}
}

/*
 * A restricted account can open a connection at all.
 *
 * This is a regression test for a real defect the ACL work found. The app
 * labels its connections so an operator can tell it apart from their own
 * services in CLIENT LIST - and go-redis's ClientName option issues CLIENT
 * SETNAME during connection setup, where a failure takes the whole connection
 * down. CLIENT SETNAME is in @connection, so a user granted only "-@all
 * +@read" could not connect to this app at all, while working perfectly with
 * redis-cli.
 *
 * The name is now set after the connection is up and its refusal ignored, so
 * the account works and pays for it with an unnamed row on the clients page.
 */
func TestLiveRestrictedUserCanConnectWithoutClientSetname(t *testing.T) {
	admin := liveConn(t, nil, nil)
	ctx := liveContext(t)
	const name = "mqs-live-acl-restricted"
	t.Cleanup(func() { _ = admin.RemoveAclUser(context.Background(), name) })

	// No @connection: this user cannot run CLIENT SETNAME, and cannot PING
	// either. What it can do is read the keys it was granted.
	if err := admin.SaveAclUser(ctx, model.AclUserSpec{
		Name:         name,
		Enabled:      true,
		Password:     "restricted",
		KeyPatterns:  []string{"~mqs-live-restricted:*"},
		CommandRules: []string{"-@all", "+@read"},
	}); err != nil {
		t.Fatalf("create the restricted user: %v", err)
	}

	restricted := openLive(t, liveAddr, nil, map[string]string{
		SecretUsername: name,
		SecretPassword: "restricted",
	})
	// A command the grant allows. If CLIENT SETNAME had taken the connection
	// down this would fail with a connection error rather than with NOPERM.
	if err := restricted.client.Exists(ctx, "mqs-live-restricted:absent").Err(); err != nil {
		t.Fatalf("a read-only account could not use its own grant: %v", err)
	}
	// And PING is genuinely refused, which is what says the account really is
	// restricted rather than the test having granted too much.
	if err := restricted.Ping(ctx); err == nil {
		t.Error("the restricted account could ping; @connection was granted after all")
	}
}

func TestLiveRemoveAclUser(t *testing.T) {
	conn := liveConn(t, nil, nil)
	ctx := liveContext(t)
	const name = "mqs-live-acl-remove"
	t.Cleanup(func() { _ = conn.RemoveAclUser(context.Background(), name) })

	if err := conn.SaveAclUser(ctx, model.AclUserSpec{
		Name: name, Enabled: true, Password: "x", CommandRules: []string{"-@all"},
	}); err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := conn.RemoveAclUser(ctx, name); err != nil {
		t.Fatalf("remove: %v", err)
	}
	// Removing one that is gone deletes nothing, and reporting that as done
	// would have a row disappear for a user somebody else removed.
	if err := conn.RemoveAclUser(ctx, name); err == nil {
		t.Error("removing the same user twice succeeded the second time")
	}
}
