package kafka

import (
	"context"
	"testing"
	"time"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kfake"

	"github.com/amigoer/mq-studio/internal/model"
)

func brokerDetail(id int32, host string, port int32, rack string) kadm.BrokerDetail {
	detail := kadm.BrokerDetail{NodeID: id, Host: host, Port: port}
	if rack != "" {
		detail.Rack = &rack
	}
	return detail
}

func TestNodesFromMetadata(t *testing.T) {
	nodes := nodesFrom(kadm.Metadata{
		Cluster:    "test-cluster",
		Controller: 2,
		// Deliberately out of order: metadata arrives in whatever order the
		// broker sends, and a list that reshuffles between refreshes is
		// unreadable.
		Brokers: kadm.BrokerDetails{
			brokerDetail(3, "kafka-3", 9096, ""),
			brokerDetail(1, "kafka-1", 9092, "eu-west-1a"),
			brokerDetail(2, "kafka-2", 9094, ""),
		},
	})

	if len(nodes) != 3 {
		t.Fatalf("got %d nodes, want 3", len(nodes))
	}
	if nodes[0].ID != 1 || nodes[1].ID != 2 || nodes[2].ID != 3 {
		t.Errorf("nodes are not sorted by broker id: %d %d %d", nodes[0].ID, nodes[1].ID, nodes[2].ID)
	}
	if nodes[0].Address != "kafka-1:9092" {
		t.Errorf("address = %q, want kafka-1:9092", nodes[0].Address)
	}
	if nodes[0].Name != "broker-1" {
		t.Errorf("name = %q, want broker-1", nodes[0].Name)
	}
	if nodes[0].Attribute(AttrRack) != "eu-west-1a" {
		t.Errorf("rack = %q, want eu-west-1a", nodes[0].Attribute(AttrRack))
	}
	if nodes[2].Attribute(AttrRack) != "" {
		t.Errorf("a broker with no rack reported %q", nodes[2].Attribute(AttrRack))
	}

	// Exactly one controller, and it is the one metadata named.
	controllers := []string{}
	for _, node := range nodes {
		if node.Attribute(AttrController) == "true" {
			controllers = append(controllers, node.Name)
		}
	}
	if len(controllers) != 1 || controllers[0] != "broker-2" {
		t.Errorf("controllers = %v, want [broker-2]", controllers)
	}
}

// Kafka reports no rate and no disk figure in metadata. A zero would be read as
// "measured, and it is zero" - and the TPS history would record it as a real
// sample, drawing a flat line that never happened.
func TestNodesReportUnmeasuredFiguresAsUnknown(t *testing.T) {
	nodes := nodesFrom(kadm.Metadata{
		Brokers: kadm.BrokerDetails{brokerDetail(1, "kafka-1", 9092, "")},
	})

	node := nodes[0]
	if node.RateIn != model.UnknownMetric || node.RateOut != model.UnknownMetric {
		t.Errorf("rates = %d/%d, want both unknown", node.RateIn, node.RateOut)
	}
	if node.DiskUsage != model.UnknownMetric {
		t.Errorf("disk usage = %d, want unknown", node.DiskUsage)
	}
}

// A cluster with no controller sends -1, and rendering that as a broker id
// would invent a broker nobody can find.
func TestControllerNameIsEmptyWhenThereIsNone(t *testing.T) {
	if got := controllerName(kadm.Metadata{Controller: -1}); got != "" {
		t.Errorf("controller = %q, want empty", got)
	}
	if got := controllerName(kadm.Metadata{Controller: 0}); got != "0" {
		t.Errorf("controller = %q, want 0 - broker 0 is a real broker", got)
	}
}

// The health counters are the whole reason the overview exists, and each one
// counts a different failure. A partition can be under-replicated without
// being offline, and offline without being leaderless.
func TestHealthOfCountsEachFailureSeparately(t *testing.T) {
	metadata := kadm.Metadata{Topics: kadm.TopicDetails{
		"orders": {
			Topic: "orders",
			Partitions: kadm.PartitionDetails{
				0: {Partition: 0, Leader: 1, Replicas: []int32{1, 2, 3}, ISR: []int32{1, 2, 3}},
				1: {Partition: 1, Leader: 2, Replicas: []int32{1, 2, 3}, ISR: []int32{2, 3}},
				2: {Partition: 2, Leader: 3, Replicas: []int32{1, 2, 3}, ISR: []int32{3}, OfflineReplicas: []int32{1, 2}},
				3: {Partition: 3, Leader: -1, Replicas: []int32{1, 2, 3}, ISR: []int32{}, OfflineReplicas: []int32{1, 2, 3}},
			},
		},
		"__consumer_offsets": {
			Topic:      "__consumer_offsets",
			IsInternal: true,
			Partitions: kadm.PartitionDetails{
				0: {Partition: 0, Leader: 1, Replicas: []int32{1}, ISR: []int32{1}},
			},
		},
	}}

	health := healthOf(metadata)

	if health.topics != 1 {
		t.Errorf("topics = %d, want 1 - internal topics are counted separately", health.topics)
	}
	if health.internalTopics != 1 {
		t.Errorf("internal topics = %d, want 1", health.internalTopics)
	}
	if health.partitions != 5 {
		t.Errorf("partitions = %d, want 5 - internal partitions still exist", health.partitions)
	}
	if health.underReplicated != 3 {
		t.Errorf("under-replicated = %d, want 3", health.underReplicated)
	}
	if health.offline != 2 {
		t.Errorf("offline = %d, want 2", health.offline)
	}
	if health.leaderless != 1 {
		t.Errorf("leaderless = %d, want 1", health.leaderless)
	}
}

func fakeConn(t *testing.T, options ...kfake.Opt) *Conn {
	t.Helper()
	address := fakeCluster(t, options...)
	config, err := configOf(model.ConnectionProfile{Name: "fake", Endpoints: address})
	if err != nil {
		t.Fatalf("configOf: %v", err)
	}
	client, admin, err := newClient(config)
	if err != nil {
		t.Fatalf("newClient: %v", err)
	}
	conn := newConn(client, admin, config)
	t.Cleanup(func() { _ = conn.Close() })
	return conn
}

func TestClusterOverviewAgainstAFakeCluster(t *testing.T) {
	conn := fakeConn(t, kfake.SeedTopics(3, "orders", "payments"))

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	overview, err := conn.ClusterOverview(ctx)
	if err != nil {
		t.Fatalf("ClusterOverview: %v", err)
	}
	if overview.Destinations != 2 {
		t.Errorf("topics = %d, want 2", overview.Destinations)
	}
	if overview.Attribute(AttrPartitionCount) != "6" {
		t.Errorf("partitions = %q, want 6", overview.Attribute(AttrPartitionCount))
	}
	// A healthy cluster has to report zeroes, not blanks: the overview's job is
	// to say "nothing is wrong" as clearly as it says what is.
	for _, key := range []string{AttrUnderReplicated, AttrOfflinePartitions, AttrLeaderlessPartition} {
		if overview.Attribute(key) != "0" {
			t.Errorf("%s = %q on a healthy cluster, want 0", key, overview.Attribute(key))
		}
	}
	if overview.AvgDiskUsage != model.UnknownMetric {
		t.Errorf("disk usage = %d, want unknown - metadata carries no disk figure", overview.AvgDiskUsage)
	}
}
