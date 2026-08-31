package kafka

import (
	"context"
	"fmt"
	"sort"

	"github.com/twmb/franz-go/pkg/kadm"

	"github.com/amigoer/mq-studio/internal/model"
)

// OffsetTarget names where a reset moves a group to.
//
// Five, because Kafka has five and collapsing them would lose the difference
// between "start again", "skip everything" and "go back to when the incident
// started". They are the same set kafka-consumer-groups.sh offers.
type OffsetTarget string

const (
	// OffsetEarliest is the start of what is still retained, which is not
	// necessarily the start of the topic.
	OffsetEarliest OffsetTarget = "earliest"
	OffsetLatest   OffsetTarget = "latest"
	// OffsetTimestamp is the first record written at or after a moment.
	OffsetTimestamp OffsetTarget = "timestamp"
	// OffsetAbsolute is one exact offset, applied to every partition asked
	// for. Meaningful on a single partition and blunt across several.
	OffsetAbsolute OffsetTarget = "offset"
	// OffsetShift moves each partition by a signed amount from where it is.
	OffsetShift OffsetTarget = "shift"
)

// OffsetResetRequest is a Kafka offset reset as the form collects it.
type OffsetResetRequest struct {
	Group string
	Topic string
	// Partitions narrows the reset. Empty means every partition of the topic,
	// which is what the page offers by default.
	Partitions []int32

	Target OffsetTarget
	// Timestamp is milliseconds, for OffsetTimestamp.
	Timestamp int64
	// Value is the offset for OffsetAbsolute and the signed delta for
	// OffsetShift.
	Value int64
}

// ResetOffset moves a subscription to a moment in time.
//
// The canonical entry point, and deliberately only the timestamp case: that is
// the one this signature can express. Everything else Kafka can do goes
// through ResetGroupOffsets, which takes the target as well as the moment.
func (c *Conn) ResetOffset(ctx context.Context, request model.ResetOffsetRequest) error {
	return c.ResetGroupOffsets(ctx, OffsetResetRequest{
		Group:     request.Group,
		Topic:     request.Topic,
		Target:    OffsetTimestamp,
		Timestamp: request.Timestamp,
	})
}

/*
 * ResetGroupOffsets writes a group's committed offsets.
 *
 * Kafka refuses this while the group has live members, and that refusal is
 * passed through rather than worked around. Committing on behalf of a running
 * consumer would be overwritten by that consumer moments later, so a reset
 * that appeared to work and then undid itself is the worst of the three
 * possible behaviours.
 */
func (c *Conn) ResetGroupOffsets(ctx context.Context, request OffsetResetRequest) error {
	if request.Group == "" {
		return fmt.Errorf("a consumer group is required")
	}
	if request.Topic == "" {
		return fmt.Errorf("a topic is required")
	}

	offsets, err := c.resolveTargets(ctx, request)
	if err != nil {
		return err
	}
	if len(offsets) == 0 {
		return fmt.Errorf("no partition of %s matched the reset", request.Topic)
	}

	responses, err := c.admin.CommitOffsets(ctx, request.Group, offsets)
	if err != nil {
		return err
	}
	return firstOffsetError(responses)
}

// resolveTargets turns "where to" into an offset per partition.
func (c *Conn) resolveTargets(
	ctx context.Context, request OffsetResetRequest,
) (kadm.Offsets, error) {
	starts, err := c.admin.ListStartOffsets(ctx, request.Topic)
	if err != nil {
		return nil, err
	}
	ends, err := c.admin.ListEndOffsets(ctx, request.Topic)
	if err != nil {
		return nil, err
	}

	var timestamps kadm.ListedOffsets
	if request.Target == OffsetTimestamp {
		timestamps, err = c.admin.ListOffsetsAfterMilli(ctx, request.Timestamp, request.Topic)
		if err != nil {
			return nil, err
		}
	}

	var committed kadm.OffsetResponses
	if request.Target == OffsetShift {
		committed, err = c.admin.FetchOffsets(ctx, request.Group)
		if err != nil {
			return nil, err
		}
	}

	wanted := partitionSet(request.Partitions)
	offsets := make(kadm.Offsets)
	for partition, end := range ends[request.Topic] {
		if wanted != nil && !wanted[partition] {
			continue
		}
		start := offsetAt(starts, request.Topic, partition)
		target, err := resolveOffset(request, partition, start, end.Offset, timestamps, committed)
		if err != nil {
			return nil, err
		}
		offsets.AddOffset(request.Topic, partition, clamp(target, start, end.Offset), -1)
	}
	return offsets, nil
}

// resolveOffset is where each target becomes a number.
func resolveOffset(
	request OffsetResetRequest,
	partition int32,
	start, end int64,
	timestamps kadm.ListedOffsets,
	committed kadm.OffsetResponses,
) (int64, error) {
	switch request.Target {
	case OffsetEarliest:
		return start, nil
	case OffsetLatest:
		return end, nil
	case OffsetAbsolute:
		return request.Value, nil
	case OffsetTimestamp:
		listed, ok := timestamps.Lookup(request.Topic, partition)
		// No record was written at or after that moment, so the group belongs
		// at the end: everything before it has already been produced.
		if !ok || listed.Err != nil || listed.Offset < 0 {
			return end, nil
		}
		return listed.Offset, nil
	case OffsetShift:
		from := end
		if response, ok := committed.Lookup(request.Topic, partition); ok && response.Err == nil {
			from = response.At
		}
		return from + request.Value, nil
	default:
		return 0, fmt.Errorf("unknown offset target %q", request.Target)
	}
}

/*
 * clamp keeps a reset inside the log.
 *
 * An offset below the start is unreadable and one past the end makes the
 * consumer wait for records that do not exist; Kafka accepts both and the
 * consumer's auto.offset.reset then decides what happens, which is a surprise
 * an operator did not ask for. Landing on the nearest real position is what
 * kafka-consumer-groups.sh does too.
 */
func clamp(offset, start, end int64) int64 {
	if start >= 0 && offset < start {
		return start
	}
	if end >= 0 && offset > end {
		return end
	}
	return offset
}

func partitionSet(partitions []int32) map[int32]bool {
	if len(partitions) == 0 {
		return nil
	}
	wanted := make(map[int32]bool, len(partitions))
	for _, partition := range partitions {
		wanted[partition] = true
	}
	return wanted
}

// SetQueueOffset writes one partition's committed offset directly.
func (c *Conn) SetQueueOffset(ctx context.Context, request model.QueueOffsetRequest) error {
	return c.ResetGroupOffsets(ctx, OffsetResetRequest{
		Group:      request.Subscription,
		Topic:      request.Destination,
		Partitions: []int32{int32(request.QueueID)},
		Target:     OffsetAbsolute,
		Value:      request.Offset,
	})
}

/*
 * CloneOffset copies one group's positions onto another.
 *
 * The usual reason is standing up a replacement consumer group without
 * replaying what the old one already handled. Only committed offsets are read,
 * never the live members' positions: the source group is normally already shut
 * down when this is worth doing.
 */
func (c *Conn) CloneOffset(ctx context.Context, request model.CloneOffsetRequest) error {
	if request.From == "" || request.To == "" {
		return fmt.Errorf("both a source and a target consumer group are required")
	}
	if request.From == request.To {
		return fmt.Errorf("the source and target consumer groups are the same")
	}

	source, err := c.admin.FetchOffsets(ctx, request.From)
	if err != nil {
		return err
	}

	offsets := make(kadm.Offsets)
	for topic, partitions := range source {
		if request.Destination != "" && topic != request.Destination {
			continue
		}
		for partition, response := range partitions {
			if response.Err != nil {
				continue
			}
			offsets.AddOffset(topic, partition, response.At, -1)
		}
	}
	if len(offsets) == 0 {
		return fmt.Errorf("%s has no committed offsets to copy", request.From)
	}

	responses, err := c.admin.CommitOffsets(ctx, request.To, offsets)
	if err != nil {
		return err
	}
	return firstOffsetError(responses)
}

// DeleteGroupOffsets forgets a group's position on some topics, without
// deleting the group.
//
// Separate from a reset: a reset says where to read from next, this says the
// group has no position at all, so the consumer's own auto.offset.reset
// decides. That is the difference between "replay from here" and "start over
// as if this group had never read it".
func (c *Conn) DeleteGroupOffsets(ctx context.Context, group string, topics []string) error {
	if group == "" {
		return fmt.Errorf("a consumer group is required")
	}
	if len(topics) == 0 {
		return fmt.Errorf("at least one topic is required")
	}
	sorted := append([]string(nil), topics...)
	sort.Strings(sorted)

	set := make(kadm.TopicsSet)
	for _, topic := range sorted {
		set.Add(topic)
	}

	responses, err := c.admin.DeleteOffsets(ctx, group, set)
	if err != nil {
		return err
	}
	for _, partitions := range responses {
		for _, failure := range partitions {
			if failure != nil {
				return failure
			}
		}
	}
	return nil
}

func firstOffsetError(responses kadm.OffsetResponses) error {
	for _, partitions := range responses {
		for _, response := range partitions {
			if response.Err != nil {
				return response.Err
			}
		}
	}
	return nil
}
