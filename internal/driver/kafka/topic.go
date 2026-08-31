package kafka

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/twmb/franz-go/pkg/kadm"

	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * Attribute keys the topic board reads.
 *
 * A private contract with frontend/src/mq/kafka/destinations.ts.
 */
const (
	AttrInternal          = "internal"
	AttrReplicationFactor = "replicationFactor"
	AttrMinISR            = "minInsyncReplicas"
	AttrCleanupPolicy     = "cleanupPolicy"
	AttrRetentionMs       = "retentionMs"
	AttrRetentionBytes    = "retentionBytes"
	AttrTopicUnderRep     = "underReplicatedPartitions"
	AttrTopicOffline      = "offlinePartitions"
	AttrTopicLeaderless   = "leaderlessPartitions"
)

// Topic configuration keys this driver reads by name, because they are the
// ones the list columns are built from.
const (
	configCleanupPolicy  = "cleanup.policy"
	configMinISR         = "min.insync.replicas"
	configRetentionMs    = "retention.ms"
	configRetentionBytes = "retention.bytes"
)

// ListDestinations reports the cluster's topics.
//
// Record counts come from the start and end offsets of every partition, which
// is two requests for the whole listing rather than one per topic. It is a
// count of what is readable now, not of what was ever written: retention and
// compaction move the start offset forward, and the difference is exactly the
// number a page should show.
func (c *Conn) ListDestinations(
	ctx context.Context, filter model.DestinationFilter,
) ([]*model.Destination, error) {
	metadata, err := c.admin.Metadata(fresh(ctx))
	if err != nil {
		return nil, err
	}

	names := make([]string, 0, len(metadata.Topics))
	for name, topic := range metadata.Topics {
		if topic.IsInternal && !filter.IncludeInternal {
			continue
		}
		names = append(names, name)
	}
	sort.Strings(names)
	if len(names) == 0 {
		return []*model.Destination{}, nil
	}

	// A cluster that will not answer for offsets still has a usable topic
	// list, so the depth column goes unknown rather than the page failing.
	starts, _ := c.admin.ListStartOffsets(ctx, names...)
	ends, _ := c.admin.ListEndOffsets(ctx, names...)
	configs := c.topicConfigs(ctx, names)

	destinations := make([]*model.Destination, 0, len(names))
	for index, name := range names {
		destinations = append(destinations, destinationFrom(
			index+1, metadata.Topics[name], starts, ends, configs[name]))
	}
	return destinations, nil
}

// DestinationDetail reports one topic, configs included.
func (c *Conn) DestinationDetail(
	ctx context.Context, ref model.DestinationRef,
) (*model.Destination, error) {
	metadata, err := c.admin.Metadata(fresh(ctx), ref.Name)
	if err != nil {
		return nil, err
	}
	topic, ok := metadata.Topics[ref.Name]
	if !ok || topic.Err != nil {
		return nil, fmt.Errorf("topic not found: %s", ref.Name)
	}

	starts, _ := c.admin.ListStartOffsets(ctx, ref.Name)
	ends, _ := c.admin.ListEndOffsets(ctx, ref.Name)
	configs := c.topicConfigs(ctx, []string{ref.Name})

	destination := destinationFrom(1, topic, starts, ends, configs[ref.Name])
	// The whole settings document, under Kafka's own key names, which the
	// listing does not carry: a topic has around eighty settings and a page of
	// rows should not pay for them. The keys always contain a dot and this
	// driver's own display keys never do, which is how the panel tells the
	// settings apart from the columns.
	for key, value := range configs[ref.Name] {
		destination.Attributes[key] = value
	}
	return destination, nil
}

// CreateDestination declares a topic.
//
// Partition count and replication factor are fixed at creation and are the two
// decisions that cannot be undone: partitions can be added but never removed,
// and the replication factor can only be changed by a reassignment.
func (c *Conn) CreateDestination(ctx context.Context, spec model.DestinationSpec) error {
	partitions := int32(spec.Partitions)
	if partitions <= 0 {
		// -1 asks the broker for its own default, which is what an operator
		// who left the field alone meant.
		partitions = -1
	}
	replication := int16(-1)
	if raw := spec.Attributes[AttrReplicationFactor]; raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 16)
		if err != nil {
			return fmt.Errorf("invalid replication factor %q", raw)
		}
		replication = int16(parsed)
	}

	_, err := c.admin.CreateTopic(ctx, partitions, replication, topicConfigsFrom(spec), spec.Ref.Name)
	if err != nil {
		return err
	}
	c.topologyChanged()
	c.awaitTopic(ctx, spec.Ref.Name, true)
	return nil
}

// UpdateDestination alters a topic's configuration.
//
// Only the keys the request carries are touched. An incremental alter is the
// only safe way to do this: the whole-config form replaces every setting, so
// omitting a key an operator never saw would silently reset it to the default.
func (c *Conn) UpdateDestination(ctx context.Context, spec model.DestinationSpec) error {
	alters := make([]kadm.AlterConfig, 0, len(spec.Attributes))
	for key, value := range spec.Attributes {
		if key == AttrReplicationFactor {
			continue
		}
		if value == "" {
			// An empty value means "back to the cluster default", which is a
			// deletion rather than a set to the empty string.
			alters = append(alters, kadm.AlterConfig{Op: kadm.DeleteConfig, Name: key})
			continue
		}
		setting := value
		alters = append(alters, kadm.AlterConfig{Op: kadm.SetConfig, Name: key, Value: &setting})
	}
	if len(alters) == 0 {
		return nil
	}
	sort.Slice(alters, func(i, j int) bool { return alters[i].Name < alters[j].Name })

	responses, err := c.admin.AlterTopicConfigs(ctx, alters, spec.Ref.Name)
	if err != nil {
		return err
	}
	if err := firstAlterError(responses); err != nil {
		return err
	}
	c.topologyChanged()
	return nil
}

// RemoveDestination deletes a topic and everything in it.
//
// Kafka's delete is asynchronous. The controller accepts it and metadata keeps
// reporting the topic for a moment - around fifty milliseconds on a healthy
// cluster - while the deletion propagates. This port's contract is that the
// thing is gone when the call returns, and a board that re-reads on success
// would otherwise list what the operator just deleted and invite them to
// delete it again.
//
// Best effort and bounded. If the cluster is still catching up when time runs
// out, the deletion has still been accepted, so this reports success rather
// than a failure that did not happen.
func (c *Conn) RemoveDestination(ctx context.Context, ref model.DestinationRef) error {
	responses, err := c.admin.DeleteTopics(ctx, ref.Name)
	if err != nil {
		return err
	}
	for _, response := range responses {
		if response.Err != nil {
			return response.Err
		}
	}
	c.topologyChanged()
	c.awaitTopic(ctx, ref.Name, false)
	return nil
}

// propagationLimit caps how long a mutation waits for the cluster to agree.
// Long enough for a controller that is busy, short enough that the button does
// not look stuck.
const propagationLimit = 3 * time.Second

/*
 * awaitTopic waits until the cluster reports the topic as wanted.
 *
 * Both halves of a topic's life are asynchronous on a real cluster. The
 * controller accepts a create or a delete and metadata catches up a moment
 * later - around fifty milliseconds when it is healthy, and long enough to
 * lose a race with the board's own re-read. Without this, creating a topic
 * left it missing from the list that refreshed on success and deleting one
 * left it there, and either way the operator does it again.
 *
 * What this cannot promise is that every broker agrees. Kafka's metadata is
 * per-broker and each catches up on its own, so "the topic is gone" has no
 * single answer at an instant: a client can be told yes by the broker it asks
 * and no by the next one. This waits for one broker to agree, which closes the
 * common case; the rest belongs to the protocol.
 *
 * Best effort and bounded. A transient metadata error is retried rather than
 * taken as an answer, and if the cluster is still catching up when time runs
 * out the mutation has still been accepted - so the caller reports success
 * rather than a failure that did not happen.
 */
func (c *Conn) awaitTopic(ctx context.Context, topic string, wantPresent bool) {
	deadline := time.Now().Add(propagationLimit)
	for {
		metadata, err := c.admin.Metadata(fresh(ctx), topic)
		if err == nil {
			detail, found := metadata.Topics[topic]
			present := found && detail.Err == nil
			if present == wantPresent {
				return
			}
		}
		if time.Now().After(deadline) {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(25 * time.Millisecond):
		}
	}
}

// DestinationStats reports each partition's leader, replicas and read range.
//
// This is what the topic detail panel is opened for: a partition list is where
// an under-replicated topic names the broker that is behind.
func (c *Conn) DestinationStats(
	ctx context.Context, ref model.DestinationRef,
) (map[string]interface{}, error) {
	metadata, err := c.admin.Metadata(fresh(ctx), ref.Name)
	if err != nil {
		return nil, err
	}
	topic, ok := metadata.Topics[ref.Name]
	if !ok || topic.Err != nil {
		return nil, fmt.Errorf("topic not found: %s", ref.Name)
	}
	starts, _ := c.admin.ListStartOffsets(ctx, ref.Name)
	ends, _ := c.admin.ListEndOffsets(ctx, ref.Name)

	numbers := make([]int32, 0, len(topic.Partitions))
	for number := range topic.Partitions {
		numbers = append(numbers, number)
	}
	sort.Slice(numbers, func(i, j int) bool { return numbers[i] < numbers[j] })

	rows := make([]map[string]interface{}, 0, len(numbers))
	for _, number := range numbers {
		rows = append(rows, partitionRow(topic.Partitions[number], ref.Name, starts, ends))
	}
	return map[string]interface{}{"partitions": rows}, nil
}

// partitionRow is one partition as the detail panel draws it.
//
// Leader -1 is Kafka's "there is no leader", and it stays -1 rather than
// becoming 0: broker 0 is a real broker on a cluster whose ids start at zero.
func partitionRow(
	partition kadm.PartitionDetail, topic string, starts, ends kadm.ListedOffsets,
) map[string]interface{} {
	start := offsetAt(starts, topic, partition.Partition)
	end := offsetAt(ends, topic, partition.Partition)
	records := int64(model.UnknownMetric)
	if start >= 0 && end >= 0 {
		records = end - start
	}
	return map[string]interface{}{
		"partition":       partition.Partition,
		"leader":          partition.Leader,
		"leaderEpoch":     partition.LeaderEpoch,
		"replicas":        partition.Replicas,
		"isr":             partition.ISR,
		"offlineReplicas": partition.OfflineReplicas,
		"startOffset":     start,
		"endOffset":       end,
		"records":         records,
		"underReplicated": len(partition.ISR) < len(partition.Replicas),
	}
}

func destinationFrom(
	id int, topic kadm.TopicDetail, starts, ends kadm.ListedOffsets, configs map[string]string,
) *model.Destination {
	health := topicHealthOf(topic)
	depth := int64(model.UnknownMetric)
	if records, known := recordCount(topic, starts, ends); known {
		depth = records
	}

	attributes := map[string]string{
		AttrInternal:          strconv.FormatBool(topic.IsInternal),
		AttrReplicationFactor: strconv.Itoa(replicationFactorOf(topic)),
		AttrTopicUnderRep:     strconv.Itoa(health.underReplicated),
		AttrTopicOffline:      strconv.Itoa(health.offline),
		AttrTopicLeaderless:   strconv.Itoa(health.leaderless),
	}
	// Only the configs the list actually draws. A topic carries around eighty
	// settings and the rest belong on the detail panel, not in every row.
	for attribute, key := range map[string]string{
		AttrCleanupPolicy:  configCleanupPolicy,
		AttrMinISR:         configMinISR,
		AttrRetentionMs:    configRetentionMs,
		AttrRetentionBytes: configRetentionBytes,
	} {
		if value, ok := configs[key]; ok {
			attributes[attribute] = value
		}
	}

	return &model.Destination{
		ID:         id,
		Ref:        model.DestinationRef{Name: topic.Topic},
		Partitions: len(topic.Partitions),
		// Kafka does not index topics by who reads them. Which groups consume
		// a topic is only knowable by walking every group's committed offsets,
		// which is the consumer page's request, not this one's.
		Subscribers: model.UnknownMetric,
		Depth:       depth,
		// No rate of any kind is reported over the admin protocol.
		RateIn:     model.UnknownMetric,
		RateOut:    model.UnknownMetric,
		Attributes: attributes,
	}
}

// topicHealth is one topic's share of the cluster's partition health.
type topicHealth struct {
	underReplicated int
	offline         int
	leaderless      int
}

func topicHealthOf(topic kadm.TopicDetail) topicHealth {
	var health topicHealth
	for _, partition := range topic.Partitions {
		if partition.Leader < 0 {
			health.leaderless++
		}
		if len(partition.OfflineReplicas) > 0 {
			health.offline++
		}
		if len(partition.ISR) < len(partition.Replicas) {
			health.underReplicated++
		}
	}
	return health
}

// replicationFactorOf reads the factor off the partitions, because Kafka has
// no topic-level field for it: it is a property of each partition's replica
// list, and a reassignment can leave them disagreeing.
func replicationFactorOf(topic kadm.TopicDetail) int {
	factor := 0
	for _, partition := range topic.Partitions {
		if count := len(partition.Replicas); count > factor {
			factor = count
		}
	}
	if factor == 0 {
		return model.UnknownMetric
	}
	return factor
}

// recordCount is what is readable now: the end offset less the start, summed
// over the partitions. Not what was ever written - retention and compaction
// move the start forward, and pretending otherwise would report a number that
// only grows.
func recordCount(topic kadm.TopicDetail, starts, ends kadm.ListedOffsets) (int64, bool) {
	total := int64(0)
	known := false
	for number := range topic.Partitions {
		start := offsetAt(starts, topic.Topic, number)
		end := offsetAt(ends, topic.Topic, number)
		if start < 0 || end < 0 {
			continue
		}
		known = true
		if end > start {
			total += end - start
		}
	}
	return total, known
}

func offsetAt(offsets kadm.ListedOffsets, topic string, partition int32) int64 {
	listed, ok := offsets.Lookup(topic, partition)
	if !ok || listed.Err != nil {
		return -1
	}
	return listed.Offset
}

// topicConfigs reads the settings of several topics at once, flattened to the
// values in force.
//
// A failure is not fatal: the config columns go missing and the topic list
// still draws, which is better than a page that fails because one credential
// may describe topics and not their configs.
func (c *Conn) topicConfigs(ctx context.Context, names []string) map[string]map[string]string {
	configs := make(map[string]map[string]string, len(names))
	resources, err := c.admin.DescribeTopicConfigs(ctx, names...)
	if err != nil {
		return configs
	}
	for _, resource := range resources {
		if resource.Err != nil {
			continue
		}
		configs[resource.Name] = flattenConfigs(resource.Configs)
	}
	return configs
}

func flattenConfigs(entries []kadm.Config) map[string]string {
	flat := make(map[string]string, len(entries))
	for _, entry := range entries {
		if entry.Value == nil {
			// A sensitive config comes back with no value at all, which is
			// the broker refusing to echo it rather than an empty setting.
			continue
		}
		flat[entry.Key] = *entry.Value
	}
	return flat
}

// topicConfigsFrom is the create form's settings, minus the fields that are
// not configs at all.
func topicConfigsFrom(spec model.DestinationSpec) map[string]*string {
	configs := make(map[string]*string, len(spec.Attributes))
	for key, value := range spec.Attributes {
		if key == AttrReplicationFactor || value == "" {
			continue
		}
		// Only real Kafka config keys reach the broker. The attribute map also
		// carries this driver's own display keys, and sending one would make
		// the whole create fail on an unknown config.
		if !strings.Contains(key, ".") {
			continue
		}
		setting := value
		configs[key] = &setting
	}
	return configs
}

func firstAlterError(responses kadm.AlterConfigsResponses) error {
	for _, response := range responses {
		if response.Err != nil {
			if response.ErrMessage != "" {
				return fmt.Errorf("%w: %s", response.Err, response.ErrMessage)
			}
			return response.Err
		}
	}
	return nil
}
