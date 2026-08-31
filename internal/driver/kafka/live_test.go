package kafka

import (
	"context"
	"crypto/rand"
	"net"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"

	"github.com/amigoer/mq-studio/internal/model"
)

// liveSeeds is the cluster tests/e2e/kafka brings up: three brokers, each
// advertising its EXTERNAL listener on 127.0.0.1.
//
// Tests skip rather than fail when it is not running, so a checkout without
// docker still has a green suite - but in CI the skip is a failure, because a
// contract test that can silently not run asserts nothing.
const liveSeeds = "127.0.0.1:9092,127.0.0.1:9094,127.0.0.1:9096"

func requireLiveCluster(t *testing.T) {
	t.Helper()
	first := strings.Split(liveSeeds, ",")[0]
	conn, err := net.DialTimeout("tcp", first, 2*time.Second)
	if err != nil {
		if os.Getenv("CI") != "" {
			t.Fatalf("kafka must be running in CI: %v", err)
		}
		t.Skipf("kafka is not running; start it with npm run e2e:kafka:up (%v)", err)
	}
	_ = conn.Close()
}

func liveConn(t *testing.T, endpoints string) *Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	opened, err := New().Open(ctx, model.ConnectionProfile{
		Name:       "live",
		Endpoints:  endpoints,
		TimeoutSec: 5,
	})
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	t.Cleanup(func() { _ = opened.Close() })
	return opened.(*Conn)
}

func TestLiveConnect(t *testing.T) {
	requireLiveCluster(t)
	conn := liveConn(t, liveSeeds)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := conn.Ping(ctx); err != nil {
		t.Fatalf("Ping failed against the live cluster: %v", err)
	}

	/*
	 * Exactly one capability is degraded, and it is the right one.
	 *
	 * This cluster runs without an authorizer, so every ACL call answers
	 * SECURITY_DISABLED. That is a deployment choice rather than a fault: the
	 * page stays in the sidebar and explains itself. Anything else degraded
	 * here would be a driver reporting a capability the cluster does have.
	 */
	degraded := conn.Capabilities().Degraded
	if reason := degraded[model.CapAccessDirectory]; reason != accessControlDisabled {
		t.Errorf("access control degraded with %q, want %q", reason, accessControlDisabled)
	}
	for capability, reason := range degraded {
		if capability == model.CapAccessDirectory {
			continue
		}
		t.Errorf("%s was degraded (%s) against a cluster that answers", capability, reason)
	}
}

// Each broker advertises its own EXTERNAL address, and a client bootstrapping
// on one is handed the other two. If a single advertised listener is wrong,
// bootstrapping on the healthy one still works and the fault only shows up
// later as a partition nobody can reach - so each is dialled on its own.
func TestLiveEveryBrokerIsReachableOnItsOwn(t *testing.T) {
	requireLiveCluster(t)

	for _, seed := range strings.Split(liveSeeds, ",") {
		t.Run(seed, func(t *testing.T) {
			conn := liveConn(t, seed)
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			if err := conn.Ping(ctx); err != nil {
				t.Errorf("Ping through %s failed: %v", seed, err)
			}
		})
	}
}

// A profile pointed at a port nothing serves must report the address, not the
// credential. The inverse of the SASL case: those two reasons send an operator
// to different halves of the form.
func TestLiveWrongPortIsNotReportedAsACredentialProblem(t *testing.T) {
	requireLiveCluster(t)

	// The controller listener. Something is listening, so this is not a
	// refused dial - it just does not speak the client protocol.
	conn := liveConn(t, "127.0.0.1:19093")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err := conn.Ping(ctx)
	if err == nil {
		t.Fatal("Ping succeeded against a port that serves no client listener")
	}
	if reason := degradeReason(err, conn.authenticating); reason == credentialsRejected {
		t.Errorf("a wrong port was reported as a credential problem (error was %v)", err)
	}
}

// The connect timeout the form collects has to bound a real dial, not just sit
// in the profile. A blackholed address is the only way to see that: a refused
// connection returns at once whatever the timeout says.
func TestLiveDialTimeoutIsHonoured(t *testing.T) {
	requireLiveCluster(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	opened, err := New().Open(ctx, model.ConnectionProfile{
		Name: "blackhole",
		// TEST-NET-1. Reserved for documentation, routed nowhere.
		Endpoints:  "192.0.2.1:9092",
		TimeoutSec: 1,
	})
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer func() { _ = opened.Close() }()

	start := time.Now()
	pingCtx, pingCancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer pingCancel()
	if err := opened.(*Conn).Ping(pingCtx); err == nil {
		t.Fatal("Ping succeeded against an unrouted address")
	}
	// Generous: franz-go may try the seed more than once. What is being
	// asserted is that a 1s dial timeout is in force at all, rather than the
	// operating system's own multi-minute one.
	if elapsed := time.Since(start); elapsed > 15*time.Second {
		t.Errorf("Ping took %v against an unrouted address; the dial timeout is not in force", elapsed)
	}
}

func TestLiveClusterTopology(t *testing.T) {
	requireLiveCluster(t)
	conn := liveConn(t, liveSeeds)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	nodes, err := conn.ListNodes(ctx)
	if err != nil {
		t.Fatalf("ListNodes: %v", err)
	}
	if len(nodes) != 3 {
		t.Fatalf("got %d brokers, want the 3 the e2e cluster runs", len(nodes))
	}

	controllers := 0
	for _, node := range nodes {
		if node.Address == "" {
			t.Errorf("broker %d has no address", node.ID)
		}
		if node.Attribute(AttrController) == "true" {
			controllers++
		}
	}
	// Exactly one, always. A cluster with none is mid-election and a cluster
	// reporting two is a bug in this mapping.
	if controllers != 1 {
		t.Errorf("got %d controllers, want exactly 1", controllers)
	}

	first := nodes[0]
	detail, err := conn.NodeDetail(ctx, first.Address)
	if err != nil {
		t.Fatalf("NodeDetail(%s): %v", first.Address, err)
	}
	if detail.ID != first.ID {
		t.Errorf("NodeDetail returned broker %d for %s, want %d", detail.ID, first.Address, first.ID)
	}
	if _, err := conn.NodeDetail(ctx, "no-such-broker:9092"); err == nil {
		t.Error("NodeDetail invented a broker that does not exist")
	}
}

func TestLiveClusterOverview(t *testing.T) {
	requireLiveCluster(t)
	conn := liveConn(t, liveSeeds)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	overview, err := conn.ClusterOverview(ctx)
	if err != nil {
		t.Fatalf("ClusterOverview: %v", err)
	}
	if overview.Name == "" {
		t.Error("the cluster reports no id")
	}
	if overview.TotalNodes != 3 {
		t.Errorf("brokers = %d, want 3", overview.TotalNodes)
	}
	if overview.Attribute(AttrControllerNode) == "" {
		t.Error("no controller was named")
	}
	// The e2e cluster is healthy, and a healthy cluster has to say so in
	// numbers rather than by leaving the fields blank.
	for _, key := range []string{AttrUnderReplicated, AttrOfflinePartitions, AttrLeaderlessPartition} {
		if overview.Attribute(key) != "0" {
			t.Errorf("%s = %q on a healthy cluster, want 0", key, overview.Attribute(key))
		}
	}
	// __consumer_offsets exists on any cluster that has ever had a group, and
	// it must not be counted as something a user made.
	if overview.Attribute(AttrInternalTopicCount) == "" {
		t.Error("internal topics were not counted separately")
	}
}

// A full round trip against a real cluster: declare, read back every field the
// board draws, change one, and delete. Replication factor 3 because the e2e
// cluster has three brokers and an ISR of one proves nothing.
func TestLiveTopicRoundTrip(t *testing.T) {
	requireLiveCluster(t)
	conn := liveConn(t, liveSeeds)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	const name = "mqs-test-live-topic-round-trip"
	ref := model.DestinationRef{Name: name}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		_ = conn.RemoveDestination(cleanup, ref)
	})

	if err := conn.CreateDestination(ctx, model.DestinationSpec{
		Ref:        ref,
		Partitions: 3,
		Attributes: map[string]string{
			AttrReplicationFactor: "3",
			"cleanup.policy":      "compact",
			"min.insync.replicas": "2",
		},
	}); err != nil {
		t.Fatalf("CreateDestination: %v", err)
	}

	detail, err := conn.DestinationDetail(ctx, ref)
	if err != nil {
		t.Fatalf("DestinationDetail: %v", err)
	}
	if detail.Partitions != 3 {
		t.Errorf("partitions = %d, want 3", detail.Partitions)
	}
	if got := detail.Attribute(AttrReplicationFactor); got != "3" {
		t.Errorf("replication factor = %q, want 3", got)
	}
	if got := detail.Attribute(AttrCleanupPolicy); got != "compact" {
		t.Errorf("cleanup policy = %q, want compact", got)
	}
	if got := detail.Attribute(AttrMinISR); got != "2" {
		t.Errorf("min ISR = %q, want 2", got)
	}
	// A brand new topic on a healthy cluster: every replica in sync.
	if got := detail.Attribute(AttrTopicUnderRep); got != "0" {
		t.Errorf("under-replicated = %q on a fresh topic, want 0", got)
	}
	// Nothing has been produced, so the readable range is empty - and that is
	// a measured zero, not the unknown sentinel.
	if detail.Depth != 0 {
		t.Errorf("depth = %d on an empty topic, want a measured 0", detail.Depth)
	}

	stats, err := conn.DestinationStats(ctx, ref)
	if err != nil {
		t.Fatalf("DestinationStats: %v", err)
	}
	rows, _ := stats["partitions"].([]map[string]interface{})
	if len(rows) != 3 {
		t.Fatalf("partition rows = %d, want 3", len(rows))
	}
	for _, row := range rows {
		isr, _ := row["isr"].([]int32)
		replicas, _ := row["replicas"].([]int32)
		if len(replicas) != 3 || len(isr) != 3 {
			t.Errorf("partition %v has %d replicas and %d in sync, want 3 and 3",
				row["partition"], len(replicas), len(isr))
		}
		if leader, _ := row["leader"].(int32); leader < 0 {
			t.Errorf("partition %v has no leader", row["partition"])
		}
	}

	if err := conn.UpdateDestination(ctx, model.DestinationSpec{
		Ref:        ref,
		Attributes: map[string]string{"cleanup.policy": "delete", "retention.ms": "3600000"},
	}); err != nil {
		t.Fatalf("UpdateDestination: %v", err)
	}
	altered, err := conn.DestinationDetail(ctx, ref)
	if err != nil {
		t.Fatalf("DestinationDetail after alter: %v", err)
	}
	if got := altered.Attribute(AttrCleanupPolicy); got != "delete" {
		t.Errorf("cleanup policy after alter = %q, want delete", got)
	}
	if got := altered.Attribute(AttrRetentionMs); got != "3600000" {
		t.Errorf("retention after alter = %q, want 3600000", got)
	}
	// min.insync.replicas was not in the alter, so it must be untouched: an
	// incremental alter is the difference between changing one setting and
	// resetting every other one to its default.
	if got := altered.Attribute(AttrMinISR); got != "2" {
		t.Errorf("min ISR after altering something else = %q, want 2", got)
	}

	if err := conn.RemoveDestination(ctx, ref); err != nil {
		t.Fatalf("RemoveDestination: %v", err)
	}
	if _, err := conn.DestinationDetail(ctx, ref); err == nil {
		t.Error("a deleted topic still has a detail")
	}
}

// The internal topics a cluster makes for itself are not the operator's, and
// counting them makes an empty cluster look populated.
func TestLiveInternalTopicsAreHiddenByDefault(t *testing.T) {
	requireLiveCluster(t)
	conn := liveConn(t, liveSeeds)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	visible, err := conn.ListDestinations(ctx, model.DestinationFilter{})
	if err != nil {
		t.Fatalf("ListDestinations: %v", err)
	}
	for _, destination := range visible {
		if destination.Attribute(AttrInternal) == "true" {
			t.Errorf("%s is internal but was listed by default", destination.Ref.Name)
		}
	}

	all, err := conn.ListDestinations(ctx, model.DestinationFilter{IncludeInternal: true})
	if err != nil {
		t.Fatalf("ListDestinations(internal): %v", err)
	}
	if len(all) < len(visible) {
		t.Errorf("asking for internal topics returned fewer: %d < %d", len(all), len(visible))
	}
}

/*
 * Read-after-write on a real cluster, which is where it actually fails.
 *
 * Both halves of a topic's life are asynchronous: the controller accepts a
 * create or a delete and metadata catches up around fifty milliseconds later.
 * That is long enough to lose the race with a board re-reading on success, and
 * the in-process fake cannot catch it because it applies both at once.
 *
 * No sleep and no retry on either half. The driver waits for every broker to
 * agree before it returns, so "the topic exists" and "the topic is gone" are
 * observable facts by then rather than whichever broker happened to answer.
 * A test that retried would hide exactly the race this is here to catch.
 */
func TestLiveATopicIsVisibleAndGoneWhenItSaysSo(t *testing.T) {
	requireLiveCluster(t)
	conn := liveConn(t, liveSeeds)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	const name = "mqs-test-live-read-after-write"
	ref := model.DestinationRef{Name: name}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		_ = conn.RemoveDestination(cleanup, ref)
	})

	for attempt := 1; attempt <= 3; attempt++ {
		if err := conn.CreateDestination(ctx, model.DestinationSpec{
			Ref: ref, Partitions: 1, Attributes: map[string]string{AttrReplicationFactor: "1"},
		}); err != nil {
			t.Fatalf("attempt %d, CreateDestination: %v", attempt, err)
		}
		if _, err := conn.DestinationDetail(ctx, ref); err != nil {
			t.Fatalf("attempt %d: a topic that was just created is not readable: %v", attempt, err)
		}

		if err := conn.RemoveDestination(ctx, ref); err != nil {
			t.Fatalf("attempt %d, RemoveDestination: %v", attempt, err)
		}
		if _, err := conn.DestinationDetail(ctx, ref); err == nil {
			t.Fatalf("attempt %d: a topic that was just deleted is still readable", attempt)
		}
	}
}

// produce writes n records to a topic and returns once the broker has them.
func produce(t *testing.T, conn *Conn, topic string, n int) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	records := make([]*kgo.Record, 0, n)
	for i := 0; i < n; i++ {
		records = append(records, &kgo.Record{
			Topic: topic,
			Key:   []byte("k" + strconv.Itoa(i)),
			Value: []byte("v" + strconv.Itoa(i)),
		})
	}
	if err := conn.client.ProduceSync(ctx, records...).FirstErr(); err != nil {
		t.Fatalf("produce %d records to %s: %v", n, topic, err)
	}
}

/*
 * A consumer group end to end, against records that really exist.
 *
 * The group is created the way Kafka creates one - by committing an offset -
 * rather than by an administrator, because there is no other way. The lag is
 * then a fact with arithmetic behind it: twenty records produced, five read,
 * fifteen owed.
 */
func TestLiveConsumerGroupLag(t *testing.T) {
	requireLiveCluster(t)
	conn := liveConn(t, liveSeeds)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	const topic = "mqs-test-live-group-lag"
	const group = "mqs-test-live-group"
	ref := model.DestinationRef{Name: topic}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		_ = conn.RemoveSubscription(cleanup, model.SubscriptionRef{Name: group})
		_ = conn.RemoveDestination(cleanup, ref)
	})

	if err := conn.CreateDestination(ctx, model.DestinationSpec{
		Ref: ref, Partitions: 1, Attributes: map[string]string{AttrReplicationFactor: "3"},
	}); err != nil {
		t.Fatalf("CreateDestination: %v", err)
	}
	produce(t, conn, topic, 20)

	// Committing five is what makes the group exist.
	if err := conn.SetQueueOffset(ctx, model.QueueOffsetRequest{
		Subscription: group, Destination: topic, QueueID: 0, Offset: 5,
	}); err != nil {
		t.Fatalf("SetQueueOffset: %v", err)
	}

	detail, err := conn.SubscriptionDetail(ctx, model.SubscriptionRef{Name: group})
	if err != nil {
		t.Fatalf("SubscriptionDetail: %v", err)
	}
	if detail.Backlog != 15 {
		t.Errorf("backlog = %d, want 15 - twenty produced, five read", detail.Backlog)
	}
	// Nothing is connected, so the group is Empty: real offsets, no member.
	// That is a warning rather than offline, because the page cannot tell a
	// deployment gap from a consumer that died.
	if detail.Status != model.SubscriptionWarning {
		t.Errorf("status = %q, want warning for an empty group", detail.Status)
	}
	if detail.Members != 0 {
		t.Errorf("members = %d, want 0", detail.Members)
	}
	if got := detail.Attribute(AttrGroupCoordinator); got == "" {
		t.Error("no coordinator was named")
	}

	stats, err := conn.SubscriptionStats(ctx, model.SubscriptionRef{Name: group})
	if err != nil {
		t.Fatalf("SubscriptionStats: %v", err)
	}
	rows, _ := stats["partitions"].([]map[string]interface{})
	if len(rows) != 1 {
		t.Fatalf("partition rows = %d, want 1", len(rows))
	}
	if rows[0]["committed"] != int64(5) || rows[0]["end"] != int64(20) || rows[0]["lag"] != int64(15) {
		t.Errorf("row = %v, want committed 5, end 20, lag 15", rows[0])
	}

	// The group is listed alongside the others.
	listed, err := conn.ListSubscriptions(ctx)
	if err != nil {
		t.Fatalf("ListSubscriptions: %v", err)
	}
	found := false
	for _, subscription := range listed {
		if subscription.Ref.Name == group {
			found = true
		}
	}
	if !found {
		t.Error("a group with committed offsets is not listed")
	}
}

// Every reset target, against a log whose contents are known.
func TestLiveOffsetResetTargets(t *testing.T) {
	requireLiveCluster(t)
	conn := liveConn(t, liveSeeds)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	const topic = "mqs-test-live-reset"
	const group = "mqs-test-live-reset-group"
	ref := model.DestinationRef{Name: topic}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		_ = conn.RemoveSubscription(cleanup, model.SubscriptionRef{Name: group})
		_ = conn.RemoveDestination(cleanup, ref)
	})

	if err := conn.CreateDestination(ctx, model.DestinationSpec{
		Ref: ref, Partitions: 1, Attributes: map[string]string{AttrReplicationFactor: "3"},
	}); err != nil {
		t.Fatalf("CreateDestination: %v", err)
	}
	produce(t, conn, topic, 30)

	committed := func() int64 {
		t.Helper()
		stats, err := conn.SubscriptionStats(ctx, model.SubscriptionRef{Name: group})
		if err != nil {
			t.Fatalf("SubscriptionStats: %v", err)
		}
		rows, _ := stats["partitions"].([]map[string]interface{})
		if len(rows) != 1 {
			t.Fatalf("partition rows = %d, want 1", len(rows))
		}
		at, _ := rows[0]["committed"].(int64)
		return at
	}

	reset := func(target OffsetTarget, value int64) {
		t.Helper()
		if err := conn.ResetGroupOffsets(ctx, OffsetResetRequest{
			Group: group, Topic: topic, Target: target, Value: value,
		}); err != nil {
			t.Fatalf("reset to %s: %v", target, err)
		}
	}

	reset(OffsetLatest, 0)
	if at := committed(); at != 30 {
		t.Errorf("after latest, committed = %d, want 30", at)
	}
	reset(OffsetEarliest, 0)
	if at := committed(); at != 0 {
		t.Errorf("after earliest, committed = %d, want 0", at)
	}
	reset(OffsetAbsolute, 12)
	if at := committed(); at != 12 {
		t.Errorf("after absolute 12, committed = %d, want 12", at)
	}
	reset(OffsetShift, 5)
	if at := committed(); at != 17 {
		t.Errorf("after shift +5, committed = %d, want 17", at)
	}
	reset(OffsetShift, -100)
	// Clamped to the start rather than accepted as a negative offset, which
	// Kafka would take and the consumer would then resolve however its own
	// auto.offset.reset says.
	if at := committed(); at != 0 {
		t.Errorf("after an overshooting shift, committed = %d, want 0", at)
	}
	reset(OffsetAbsolute, 1000)
	if at := committed(); at != 30 {
		t.Errorf("after an offset past the end, committed = %d, want 30", at)
	}
}

// Copying a group's positions onto a replacement, which is the whole reason
// the operation exists: stand up a new group without replaying what the old
// one already handled.
func TestLiveOffsetClone(t *testing.T) {
	requireLiveCluster(t)
	conn := liveConn(t, liveSeeds)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	const topic = "mqs-test-live-clone"
	const from = "mqs-test-live-clone-from"
	const to = "mqs-test-live-clone-to"
	ref := model.DestinationRef{Name: topic}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		_ = conn.RemoveSubscription(cleanup, model.SubscriptionRef{Name: from})
		_ = conn.RemoveSubscription(cleanup, model.SubscriptionRef{Name: to})
		_ = conn.RemoveDestination(cleanup, ref)
	})

	if err := conn.CreateDestination(ctx, model.DestinationSpec{
		Ref: ref, Partitions: 2, Attributes: map[string]string{AttrReplicationFactor: "3"},
	}); err != nil {
		t.Fatalf("CreateDestination: %v", err)
	}
	produce(t, conn, topic, 20)

	if err := conn.ResetGroupOffsets(ctx, OffsetResetRequest{
		Group: from, Topic: topic, Target: OffsetLatest,
	}); err != nil {
		t.Fatalf("seed the source group: %v", err)
	}

	if err := conn.CloneOffset(ctx, model.CloneOffsetRequest{From: from, To: to}); err != nil {
		t.Fatalf("CloneOffset: %v", err)
	}

	source, err := conn.SubscriptionStats(ctx, model.SubscriptionRef{Name: from})
	if err != nil {
		t.Fatalf("source stats: %v", err)
	}
	target, err := conn.SubscriptionStats(ctx, model.SubscriptionRef{Name: to})
	if err != nil {
		t.Fatalf("target stats: %v", err)
	}
	sourceRows, _ := source["partitions"].([]map[string]interface{})
	targetRows, _ := target["partitions"].([]map[string]interface{})
	if len(sourceRows) != len(targetRows) {
		t.Fatalf("copied %d partitions from %d", len(targetRows), len(sourceRows))
	}
	for index := range sourceRows {
		if sourceRows[index]["committed"] != targetRows[index]["committed"] {
			t.Errorf("partition %v: copied %v from %v",
				sourceRows[index]["partition"], targetRows[index]["committed"],
				sourceRows[index]["committed"])
		}
	}

	// Copying onto itself is a mistake with no useful outcome.
	if err := conn.CloneOffset(ctx, model.CloneOffsetRequest{From: from, To: from}); err == nil {
		t.Error("cloning a group onto itself was accepted")
	}
	// And a source with nothing committed has nothing to copy, which is worth
	// saying rather than reporting a successful copy of nothing.
	if err := conn.CloneOffset(ctx, model.CloneOffsetRequest{
		From: "mqs-test-live-clone-absent", To: to,
	}); err == nil {
		t.Error("cloning from a group with no offsets was accepted")
	}
}

// A broker's effective settings and where its disk has gone. Both are one
// request per broker, which is why they are the cluster page's own calls.
func TestLiveBrokerConfigAndLogDirs(t *testing.T) {
	requireLiveCluster(t)
	conn := liveConn(t, liveSeeds)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	nodes, err := conn.ListNodes(ctx)
	if err != nil {
		t.Fatalf("ListNodes: %v", err)
	}
	settings, err := conn.NodeConfig(ctx, nodes[0].Address)
	if err != nil {
		t.Fatalf("NodeConfig: %v", err)
	}
	// A broker reports a few hundred settings; these are the ones the e2e
	// compose sets, so finding them proves the read reached the right broker.
	for _, key := range []string{"broker.id", "process.roles", "num.partitions"} {
		if settings[key] == "" {
			t.Errorf("%s is missing from the effective settings", key)
		}
	}
	/*
	 * An empty value is kept, not dropped.
	 *
	 * Several Kafka settings default to an empty list -
	 * kafka.metrics.reporters among them - and that is a real setting whose
	 * value is nothing. Only a value the broker withholds arrives as no value
	 * at all, and that one is dropped; the unit test covers it, because a
	 * plaintext cluster has no sensitive setting to withhold.
	 */
	empties := 0
	for _, value := range settings {
		if value == "" {
			empties++
		}
	}
	if empties == 0 {
		t.Error("no setting came back empty; a broker has several that default to an empty list")
	}

	dirs, err := conn.LogDirs(ctx)
	if err != nil {
		t.Fatalf("LogDirs: %v", err)
	}
	if len(dirs) < 3 {
		t.Fatalf("log directories = %d, want at least one per broker", len(dirs))
	}
	brokers := make(map[int32]bool)
	for _, dir := range dirs {
		brokers[dir.Broker] = true
		if dir.Path == "" {
			t.Errorf("broker %d reported a directory with no path", dir.Broker)
		}
	}
	if len(brokers) != 3 {
		t.Errorf("directories came from %d brokers, want 3", len(brokers))
	}

	partitions, err := conn.LogDirPartitions(ctx, 5)
	if err != nil {
		t.Fatalf("LogDirPartitions: %v", err)
	}
	if len(partitions) > 5 {
		t.Errorf("the limit was ignored: %d rows", len(partitions))
	}
	// Largest first, which is the whole reason to look.
	for index := 1; index < len(partitions); index++ {
		if partitions[index-1].Size < partitions[index].Size {
			t.Errorf("partitions are not ordered by size: %d before %d",
				partitions[index-1].Size, partitions[index].Size)
		}
	}
}

// KRaft controllers are brokers of the cluster, not a separate discovery tier,
// so there is nothing to report and an empty map says so.
func TestLiveThereIsNoDiscoveryTier(t *testing.T) {
	requireLiveCluster(t)
	conn := liveConn(t, liveSeeds)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	settings, err := conn.DirectoryConfig(ctx)
	if err != nil {
		t.Fatalf("DirectoryConfig: %v", err)
	}
	if len(settings) != 0 {
		t.Errorf("a discovery tier was reported: %v", settings)
	}
}

// A topic with known contents, for the read tests below.
func seededTopic(t *testing.T, conn *Conn, name string, partitions int, records int) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	ref := model.DestinationRef{Name: name}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		_ = conn.RemoveDestination(cleanup, ref)
	})
	if err := conn.CreateDestination(ctx, model.DestinationSpec{
		Ref: ref, Partitions: partitions,
		Attributes: map[string]string{AttrReplicationFactor: "3"},
	}); err != nil {
		t.Fatalf("CreateDestination: %v", err)
	}
	produce(t, conn, name, records)
}

func TestLiveBrowseRecords(t *testing.T) {
	requireLiveCluster(t)
	conn := liveConn(t, liveSeeds)

	const topic = "mqs-test-live-browse"
	seededTopic(t, conn, topic, 1, 50)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	t.Run("the latest records come back newest-window first", func(t *testing.T) {
		records, err := conn.QueryMessages(ctx, model.MessageQueryParams{
			Topic: topic, MaxResults: 10,
		})
		if err != nil {
			t.Fatalf("QueryMessages: %v", err)
		}
		if len(records) != 10 {
			t.Fatalf("records = %d, want 10", len(records))
		}
		// Fifty produced, the last ten asked for: offsets 40 through 49.
		if records[0].QueueOffset != 40 || records[9].QueueOffset != 49 {
			t.Errorf("offsets %d..%d, want 40..49",
				records[0].QueueOffset, records[9].QueueOffset)
		}
		if records[0].MessageID != messageID(topic, 0, 40) {
			t.Errorf("id = %q", records[0].MessageID)
		}
	})

	t.Run("an offset range reads forward from where it was told", func(t *testing.T) {
		records, err := conn.QueryMessages(ctx, model.MessageQueryParams{
			Topic: topic, MaxResults: 5,
			Filters: map[string]string{FilterMode: ModeOffset, FilterStartOffset: "12"},
		})
		if err != nil {
			t.Fatalf("QueryMessages: %v", err)
		}
		if len(records) != 5 || records[0].QueueOffset != 12 {
			t.Fatalf("read %d records starting at %d, want 5 from 12",
				len(records), records[0].QueueOffset)
		}
		if records[0].Keys != "k12" || records[0].Body != "v12" {
			t.Errorf("record 12 is %q/%q, want k12/v12", records[0].Keys, records[0].Body)
		}
	})

	t.Run("a key search finds the one record that has it", func(t *testing.T) {
		records, err := conn.QueryMessages(ctx, model.MessageQueryParams{
			Topic: topic, MessageKey: "k33", MaxResults: 10,
			Filters: map[string]string{FilterMode: ModeKey},
		})
		if err != nil {
			t.Fatalf("QueryMessages: %v", err)
		}
		if len(records) != 1 {
			t.Fatalf("records = %d, want exactly the one with that key", len(records))
		}
		if records[0].QueueOffset != 33 {
			t.Errorf("found offset %d, want 33", records[0].QueueOffset)
		}
	})

	t.Run("a record can be read back by its coordinates", func(t *testing.T) {
		record, err := conn.MessageByID(ctx, topic, messageID(topic, 0, 7))
		if err != nil {
			t.Fatalf("MessageByID: %v", err)
		}
		if record.Body != "v7" {
			t.Errorf("body = %q, want v7", record.Body)
		}
		if _, err := conn.MessageByID(ctx, topic, messageID(topic, 0, 9999)); err == nil {
			t.Error("an offset past the end returned a record")
		}
	})

	// Browsing must not move anybody's position: it joins no group and commits
	// nothing, which is what makes it safe to run against production.
	t.Run("browsing commits nothing", func(t *testing.T) {
		before, err := conn.ListSubscriptions(ctx)
		if err != nil {
			t.Fatalf("ListSubscriptions: %v", err)
		}
		if _, err := conn.QueryMessages(ctx, model.MessageQueryParams{
			Topic: topic, MaxResults: 10,
		}); err != nil {
			t.Fatalf("QueryMessages: %v", err)
		}
		after, err := conn.ListSubscriptions(ctx)
		if err != nil {
			t.Fatalf("ListSubscriptions: %v", err)
		}
		if len(after) != len(before) {
			t.Errorf("browsing created a consumer group: %d -> %d", len(before), len(after))
		}
	})
}

// A tail opens on what arrives next and reports each poll's new records once.
func TestLiveTailFollowsNewRecords(t *testing.T) {
	requireLiveCluster(t)
	conn := liveConn(t, liveSeeds)

	const topic = "mqs-test-live-tail"
	seededTopic(t, conn, topic, 2, 10)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	ref := model.DestinationRef{Name: topic}

	// The first poll opens at the end, so the ten already there are not
	// replayed: a tail shows what arrives next.
	first, err := conn.TailMessages(ctx, ref, model.TailCursor{}, 100)
	if err != nil {
		t.Fatalf("TailMessages: %v", err)
	}
	if len(first.Messages) != 0 {
		t.Errorf("a fresh tail replayed %d stored records", len(first.Messages))
	}

	produce(t, conn, topic, 6)

	second, err := conn.TailMessages(ctx, ref, first.Cursor, 100)
	if err != nil {
		t.Fatalf("TailMessages: %v", err)
	}
	if len(second.Messages) != 6 {
		t.Fatalf("the tail saw %d of 6 new records", len(second.Messages))
	}

	// And the same records are not handed back twice.
	third, err := conn.TailMessages(ctx, ref, second.Cursor, 100)
	if err != nil {
		t.Fatalf("TailMessages: %v", err)
	}
	if len(third.Messages) != 0 {
		t.Errorf("the tail repeated %d records", len(third.Messages))
	}
}

func TestLiveProduceRecord(t *testing.T) {
	requireLiveCluster(t)
	conn := liveConn(t, liveSeeds)

	const topic = "mqs-test-live-produce"
	seededTopic(t, conn, topic, 3, 0)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	key := "ORD-1"
	result, err := conn.SendRecord(ctx, RecordRequest{
		Topic: topic, Key: &key, Value: `{"id":1}`,
		Headers: map[string]string{"trace-id": "abc"},
		Acks:    AcksAll, Count: 1,
	})
	if err != nil {
		t.Fatalf("SendRecord: %v", err)
	}
	if result.Sent != 1 || result.Failed != 0 {
		t.Fatalf("sent %d, failed %d", result.Sent, result.Failed)
	}
	// The coordinates are the point: an operator can go and read it back.
	if result.Offset < 0 || result.Partition < 0 {
		t.Fatalf("no coordinates were reported: %+v", result)
	}

	read, err := conn.MessageByID(ctx, topic, messageID(topic, result.Partition, result.Offset))
	if err != nil {
		t.Fatalf("MessageByID: %v", err)
	}
	if read.Body != `{"id":1}` || read.Keys != key {
		t.Errorf("read back %q/%q", read.Keys, read.Body)
	}
	if read.Properties["trace-id"] != "abc" {
		t.Errorf("headers = %v", read.Properties)
	}

	t.Run("a pinned partition is honoured", func(t *testing.T) {
		wanted := int32(2)
		pinned, err := conn.SendRecord(ctx, RecordRequest{
			Topic: topic, Partition: &wanted, Value: "pinned", Acks: AcksAll, Count: 1,
		})
		if err != nil {
			t.Fatalf("SendRecord: %v", err)
		}
		if pinned.Partition != wanted {
			t.Errorf("landed on partition %d, want %d", pinned.Partition, wanted)
		}
	})

	t.Run("acks none reports no coordinates because it never asked", func(t *testing.T) {
		none, err := conn.SendRecord(ctx, RecordRequest{
			Topic: topic, Value: "fire and forget", Acks: AcksNone, Count: 1,
		})
		if err != nil {
			t.Fatalf("SendRecord: %v", err)
		}
		if none.Partition != model.UnknownMetric || none.Offset != model.UnknownMetric {
			t.Errorf("acks=none reported %d/%d, want unknown", none.Partition, none.Offset)
		}
	})

	/*
	 * A record too large for the topic is reported as a failure, not as a
	 * silent success. That is the whole reason the send console waits.
	 *
	 * The payload is random rather than repeated: the producer compresses, and
	 * eight kilobytes of one character shrinks to nothing and is accepted -
	 * which is correct behaviour and proves nothing about a refusal.
	 */
	t.Run("a refused record is reported", func(t *testing.T) {
		if err := conn.UpdateDestination(ctx, model.DestinationSpec{
			Ref:        model.DestinationRef{Name: topic},
			Attributes: map[string]string{"max.message.bytes": "1024"},
		}); err != nil {
			t.Fatalf("UpdateDestination: %v", err)
		}
		payload := make([]byte, 64*1024)
		if _, err := rand.Read(payload); err != nil {
			t.Fatalf("build an incompressible payload: %v", err)
		}

		oversized, err := conn.SendRecord(ctx, RecordRequest{
			Topic: topic, Value: string(payload), Acks: AcksAll, Count: 1,
		})
		if err != nil {
			// A transport-level refusal is an equally honest answer.
			return
		}
		if oversized.Failed == 0 {
			t.Error("an oversized record was reported as sent")
		}
		if oversized.Reason == "" {
			t.Error("a refused record came back with no reason")
		}
	})
}
