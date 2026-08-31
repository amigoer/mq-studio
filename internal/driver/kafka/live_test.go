package kafka

import (
	"context"
	"net"
	"os"
	"strings"
	"testing"
	"time"

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
	for capability, reason := range conn.Capabilities().Degraded {
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
 * No sleep and no retry here. The next read is the one the board makes.
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
