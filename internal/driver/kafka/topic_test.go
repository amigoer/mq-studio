package kafka

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kfake"

	"github.com/amigoer/mq-studio/internal/model"
)

func listed(topic string, offsets map[int32]int64) kadm.ListedOffsets {
	out := kadm.ListedOffsets{topic: {}}
	for partition, offset := range offsets {
		out[topic][partition] = kadm.ListedOffset{
			Topic: topic, Partition: partition, Offset: offset,
		}
	}
	return out
}

func topicDetail(name string, partitions kadm.PartitionDetails, internal bool) kadm.TopicDetail {
	return kadm.TopicDetail{Topic: name, Partitions: partitions, IsInternal: internal}
}

func TestDestinationFromTopic(t *testing.T) {
	topic := topicDetail("orders", kadm.PartitionDetails{
		0: {Partition: 0, Leader: 1, Replicas: []int32{1, 2, 3}, ISR: []int32{1, 2, 3}},
		1: {Partition: 1, Leader: 2, Replicas: []int32{2, 3, 1}, ISR: []int32{2, 3}},
	}, false)

	destination := destinationFrom(
		1, topic,
		listed("orders", map[int32]int64{0: 100, 1: 50}),
		listed("orders", map[int32]int64{0: 400, 1: 250}),
		map[string]string{
			configCleanupPolicy:  "compact",
			configMinISR:         "2",
			configRetentionMs:    "604800000",
			configRetentionBytes: "-1",
		},
	)

	if destination.Ref.Name != "orders" {
		t.Errorf("name = %q", destination.Ref.Name)
	}
	if destination.Partitions != 2 {
		t.Errorf("partitions = %d, want 2", destination.Partitions)
	}
	// Readable records, not records ever written: 300 + 200.
	if destination.Depth != 500 {
		t.Errorf("depth = %d, want 500", destination.Depth)
	}
	if destination.Attribute(AttrReplicationFactor) != "3" {
		t.Errorf("replication factor = %q, want 3", destination.Attribute(AttrReplicationFactor))
	}
	if destination.Attribute(AttrTopicUnderRep) != "1" {
		t.Errorf("under-replicated = %q, want 1", destination.Attribute(AttrTopicUnderRep))
	}
	if destination.Attribute(AttrCleanupPolicy) != "compact" {
		t.Errorf("cleanup policy = %q", destination.Attribute(AttrCleanupPolicy))
	}
	if destination.Attribute(AttrMinISR) != "2" {
		t.Errorf("min ISR = %q", destination.Attribute(AttrMinISR))
	}
}

/*
 * The sentinel rules, which are the ones a page reads wrong when they slip.
 *
 * A rate of zero means "measured, and nothing is flowing". A subscriber count
 * of zero means "nobody reads this topic". Neither is knowable from a metadata
 * walk, so both have to be unknown - and the depth has to be unknown too when
 * the offsets did not come back, rather than reading as an empty topic.
 */
func TestDestinationReportsUnmeasuredFieldsAsUnknown(t *testing.T) {
	topic := topicDetail("orders", kadm.PartitionDetails{
		0: {Partition: 0, Leader: 1, Replicas: []int32{1}, ISR: []int32{1}},
	}, false)

	destination := destinationFrom(1, topic, kadm.ListedOffsets{}, kadm.ListedOffsets{}, nil)

	if destination.RateIn != model.UnknownMetric || destination.RateOut != model.UnknownMetric {
		t.Errorf("rates = %d/%d, want both unknown", destination.RateIn, destination.RateOut)
	}
	if destination.Subscribers != model.UnknownMetric {
		t.Errorf("subscribers = %d, want unknown", destination.Subscribers)
	}
	if destination.Depth != model.UnknownMetric {
		t.Errorf("depth = %d with no offsets, want unknown", destination.Depth)
	}
	// A config the broker did not report must be absent, not empty: an empty
	// retention would render as a real setting of nothing.
	if _, present := destination.Attributes[AttrRetentionMs]; present {
		t.Error("a config the broker did not report was stored as empty")
	}
}

// Compaction and retention move the start offset forward, so end-minus-start
// is the only honest count. A partition whose start has passed its end - which
// happens mid-truncation - must not subtract to a negative.
func TestRecordCountFollowsTheReadableRange(t *testing.T) {
	topic := topicDetail("orders", kadm.PartitionDetails{
		0: {Partition: 0}, 1: {Partition: 1},
	}, false)

	total, known := recordCount(topic,
		listed("orders", map[int32]int64{0: 1000, 1: 90}),
		listed("orders", map[int32]int64{0: 1000, 1: 50}),
	)
	if !known {
		t.Fatal("offsets were listed but the count reported nothing")
	}
	if total != 0 {
		t.Errorf("count = %d, want 0 - a start past its end is not a negative backlog", total)
	}
}

// The factor is read off the replica lists because Kafka has no topic-level
// field for it, and a reassignment in flight can leave partitions disagreeing.
func TestReplicationFactorIsTheWidestPartition(t *testing.T) {
	factor := replicationFactorOf(topicDetail("orders", kadm.PartitionDetails{
		0: {Partition: 0, Replicas: []int32{1, 2}},
		1: {Partition: 1, Replicas: []int32{1, 2, 3}},
	}, false))
	if factor != 3 {
		t.Errorf("factor = %d, want 3", factor)
	}
	if got := replicationFactorOf(topicDetail("orders", kadm.PartitionDetails{}, false)); got != model.UnknownMetric {
		t.Errorf("factor of a topic with no partitions = %d, want unknown", got)
	}
}

// A sensitive config comes back with no value: the broker is refusing to echo
// it, which is not the same as the setting being empty.
func TestFlattenConfigsDropsWhatTheBrokerWithheld(t *testing.T) {
	value := "compact"
	flat := flattenConfigs([]kadm.Config{
		{Key: "cleanup.policy", Value: &value},
		{Key: "ssl.keystore.password", Value: nil, Sensitive: true},
	})
	if flat["cleanup.policy"] != "compact" {
		t.Errorf("cleanup.policy = %q", flat["cleanup.policy"])
	}
	if _, present := flat["ssl.keystore.password"]; present {
		t.Error("a withheld config was stored as an empty string")
	}
}

// The create form's attribute map carries this driver's own display keys
// alongside real Kafka config keys. Sending one of the former makes the whole
// create fail on an unknown config.
func TestTopicConfigsFromKeepsOnlyBrokerSettings(t *testing.T) {
	configs := topicConfigsFrom(model.DestinationSpec{Attributes: map[string]string{
		AttrReplicationFactor: "3",
		"cleanup.policy":      "compact",
		"retention.ms":        "",
		"internal":            "false",
	}})

	if len(configs) != 1 {
		t.Fatalf("configs = %v, want only cleanup.policy", configs)
	}
	if configs["cleanup.policy"] == nil || *configs["cleanup.policy"] != "compact" {
		t.Errorf("cleanup.policy did not survive: %v", configs)
	}
}

func TestTopicLifecycleAgainstAFakeCluster(t *testing.T) {
	conn := fakeConn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	const name = "mqs-test-topic-lifecycle"
	if err := conn.CreateDestination(ctx, model.DestinationSpec{
		Ref:        model.DestinationRef{Name: name},
		Partitions: 3,
		Attributes: map[string]string{AttrReplicationFactor: "1", configCleanupPolicy: "compact"},
	}); err != nil {
		t.Fatalf("CreateDestination: %v", err)
	}

	detail, err := conn.DestinationDetail(ctx, model.DestinationRef{Name: name})
	if err != nil {
		t.Fatalf("DestinationDetail: %v", err)
	}
	if detail.Partitions != 3 {
		t.Errorf("partitions = %d, want 3", detail.Partitions)
	}
	if detail.Attribute(AttrCleanupPolicy) != "compact" {
		t.Errorf("cleanup policy = %q, want compact", detail.Attribute(AttrCleanupPolicy))
	}

	stats, err := conn.DestinationStats(ctx, model.DestinationRef{Name: name})
	if err != nil {
		t.Fatalf("DestinationStats: %v", err)
	}
	rows, _ := stats["partitions"].([]map[string]interface{})
	if len(rows) != 3 {
		t.Fatalf("partition rows = %d, want 3", len(rows))
	}
	if rows[0]["partition"] != int32(0) || rows[2]["partition"] != int32(2) {
		t.Errorf("partitions are not in order: %v", rows)
	}

	if err := conn.RemoveDestination(ctx, model.DestinationRef{Name: name}); err != nil {
		t.Fatalf("RemoveDestination: %v", err)
	}
	if _, err := conn.DestinationDetail(ctx, model.DestinationRef{Name: name}); err == nil {
		t.Error("a deleted topic still has a detail")
	}
}

// Internal topics exist on every cluster and nobody made them. Counting them
// as the operator's own makes an empty cluster look populated.
func TestListDestinationsHidesInternalTopicsUnlessAsked(t *testing.T) {
	conn := fakeConn(t, kfake.SeedTopics(1, "orders"))
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	// Committing an offset is what makes a cluster create __consumer_offsets.
	if err := conn.CreateDestination(ctx, model.DestinationSpec{
		Ref: model.DestinationRef{Name: "__mqs-test-internal-lookalike"}, Partitions: 1,
		Attributes: map[string]string{AttrReplicationFactor: "1"},
	}); err != nil {
		t.Fatalf("CreateDestination: %v", err)
	}

	visible, err := conn.ListDestinations(ctx, model.DestinationFilter{})
	if err != nil {
		t.Fatalf("ListDestinations: %v", err)
	}
	names := make([]string, 0, len(visible))
	for _, destination := range visible {
		names = append(names, destination.Ref.Name)
	}
	// A leading underscore is a naming convention, not the internal flag: only
	// what the broker marks internal may be hidden.
	if len(names) != 2 {
		t.Errorf("topics = %v, want both - a name is not the internal flag", names)
	}

	// And the listing is sorted, so a refresh does not reshuffle the table.
	if names[0] > names[1] {
		t.Errorf("topics are not sorted: %v", names)
	}
}

/*
 * Read-after-write, which the metadata cache used to break.
 *
 * kadm reads every listing through franz-go's metadata cache. Opening a
 * topic's detail panel populates that cache; deleting the topic does not
 * invalidate it. The topic therefore stayed listed and its detail stayed
 * readable after it was gone - and an operator who sees that deletes it again.
 *
 * The order here is the order that broke it: read the topic first, so the
 * cache holds an entry, and only then delete it.
 */
func TestATopicIsGoneAsSoonAsItIsDeleted(t *testing.T) {
	conn := fakeConn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	const name = "mqs-test-read-after-write"
	create := model.DestinationSpec{
		Ref: model.DestinationRef{Name: name}, Partitions: 1,
		Attributes: map[string]string{AttrReplicationFactor: "1"},
	}
	if err := conn.CreateDestination(ctx, create); err != nil {
		t.Fatalf("CreateDestination: %v", err)
	}

	// Populate the cache the way the detail panel does.
	if _, err := conn.DestinationDetail(ctx, model.DestinationRef{Name: name}); err != nil {
		t.Fatalf("DestinationDetail before delete: %v", err)
	}
	if _, err := conn.DestinationStats(ctx, model.DestinationRef{Name: name}); err != nil {
		t.Fatalf("DestinationStats before delete: %v", err)
	}

	if err := conn.RemoveDestination(ctx, model.DestinationRef{Name: name}); err != nil {
		t.Fatalf("RemoveDestination: %v", err)
	}

	// No sleep and no retry: the next read is what the board makes, and it has
	// to see the delete. A test that waited would hide exactly this.
	if _, err := conn.DestinationDetail(ctx, model.DestinationRef{Name: name}); err == nil {
		t.Error("a deleted topic still has a detail")
	}
	listed, err := conn.ListDestinations(ctx, model.DestinationFilter{IncludeInternal: true})
	if err != nil {
		t.Fatalf("ListDestinations: %v", err)
	}
	for _, destination := range listed {
		if destination.Ref.Name == name {
			t.Error("a deleted topic is still listed")
		}
	}
}

// And the same for a create: a topic must be visible the moment it exists, or
// the operator who just made one thinks the create silently failed.
func TestATopicIsListedAsSoonAsItIsCreated(t *testing.T) {
	conn := fakeConn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	// Read first, so the cache holds a listing without the new topic in it.
	if _, err := conn.ListDestinations(ctx, model.DestinationFilter{}); err != nil {
		t.Fatalf("ListDestinations: %v", err)
	}

	const name = "mqs-test-created-now"
	if err := conn.CreateDestination(ctx, model.DestinationSpec{
		Ref: model.DestinationRef{Name: name}, Partitions: 1,
		Attributes: map[string]string{AttrReplicationFactor: "1"},
	}); err != nil {
		t.Fatalf("CreateDestination: %v", err)
	}

	listed, err := conn.ListDestinations(ctx, model.DestinationFilter{})
	if err != nil {
		t.Fatalf("ListDestinations: %v", err)
	}
	for _, destination := range listed {
		if destination.Ref.Name == name {
			return
		}
	}
	t.Error("a topic that was just created is not listed")
}

// Altering a config has the same contract as creating and deleting: the value
// the operator just set is the value the panel shows on its next read.
func TestAConfigChangeIsVisibleAtOnce(t *testing.T) {
	conn := fakeConn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	const name = "mqs-test-config-change"
	if err := conn.CreateDestination(ctx, model.DestinationSpec{
		Ref: model.DestinationRef{Name: name}, Partitions: 1,
		Attributes: map[string]string{AttrReplicationFactor: "1", configCleanupPolicy: "delete"},
	}); err != nil {
		t.Fatalf("CreateDestination: %v", err)
	}
	if _, err := conn.DestinationDetail(ctx, model.DestinationRef{Name: name}); err != nil {
		t.Fatalf("DestinationDetail: %v", err)
	}

	if err := conn.UpdateDestination(ctx, model.DestinationSpec{
		Ref:        model.DestinationRef{Name: name},
		Attributes: map[string]string{configCleanupPolicy: "compact"},
	}); err != nil {
		t.Fatalf("UpdateDestination: %v", err)
	}

	detail, err := conn.DestinationDetail(ctx, model.DestinationRef{Name: name})
	if err != nil {
		t.Fatalf("DestinationDetail after alter: %v", err)
	}
	if got := detail.Attribute(AttrCleanupPolicy); got != "compact" {
		t.Errorf("cleanup policy = %q, want compact", got)
	}
}

// The detail panel shows the settings document; the listing shows four
// columns. Carrying eighty settings on every row of a listing would make a
// cluster with a few hundred topics unusable.
func TestOnlyTheDetailCarriesTheWholeSettingsDocument(t *testing.T) {
	conn := fakeConn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	const name = "mqs-test-settings-document"
	if err := conn.CreateDestination(ctx, model.DestinationSpec{
		Ref: model.DestinationRef{Name: name}, Partitions: 1,
		Attributes: map[string]string{AttrReplicationFactor: "1", configCleanupPolicy: "compact"},
	}); err != nil {
		t.Fatalf("CreateDestination: %v", err)
	}

	detail, err := conn.DestinationDetail(ctx, model.DestinationRef{Name: name})
	if err != nil {
		t.Fatalf("DestinationDetail: %v", err)
	}
	dotted := 0
	for key := range detail.Attributes {
		if strings.Contains(key, ".") {
			dotted++
		}
	}
	if dotted == 0 {
		t.Error("the detail carries no settings under their own Kafka key names")
	}
	if detail.Attributes[configCleanupPolicy] != "compact" {
		t.Errorf("cleanup.policy = %q, want compact", detail.Attributes[configCleanupPolicy])
	}
	// And the display keys the columns read are still there beside them.
	if detail.Attribute(AttrCleanupPolicy) != "compact" {
		t.Errorf("the display key was lost: %q", detail.Attribute(AttrCleanupPolicy))
	}

	listed, err := conn.ListDestinations(ctx, model.DestinationFilter{})
	if err != nil {
		t.Fatalf("ListDestinations: %v", err)
	}
	for _, destination := range listed {
		if destination.Ref.Name != name {
			continue
		}
		for key := range destination.Attributes {
			if strings.Contains(key, ".") {
				t.Errorf("the listing carries the settings document: %q", key)
			}
		}
	}
}
