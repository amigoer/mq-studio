package kafka

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kgo"

	"github.com/amigoer/mq-studio/internal/model"
)

// Filter keys the message board sends. A private contract with
// frontend/src/mq/kafka/messages.ts.
const (
	FilterPartition   = "partition"
	FilterMode        = "mode"
	FilterStartOffset = "startOffset"

	// ModeLatest reads back from the end, which is what a page opens on.
	ModeLatest = "latest"
	// ModeOffset reads forward from a given offset.
	ModeOffset = "offset"
	// ModeTime reads forward from the first record at or after a moment.
	ModeTime = "time"
	// ModeKey scans a range for records with a given key. Kafka has no key
	// index, so this really is a scan and the board says so.
	ModeKey = "key"
)

// scanLimit caps how many records a key search reads before giving up.
//
// A key search on Kafka is a scan of the log, and an unbounded one on a busy
// topic would run until the request deadline and return nothing useful. The
// board reports when this was reached, so a search that found nothing can be
// told apart from one that ran out of budget.
const scanLimit = 200_000

/*
 * readableEnds is where each partition stops being readable.
 *
 * Not the high watermark. A browse reads committed records only, so an open
 * transaction's records are in the log and past the last stable offset, and
 * fetching them returns nothing however long it waits - which is what it did:
 * a topic whose tail was one uncommitted record took the whole request budget
 * to return zero rows. The last stable offset is the same as the high
 * watermark on every topic no transaction has touched.
 */
func (c *Conn) readableEnds(ctx context.Context, topic string) (kadm.ListedOffsets, error) {
	return c.admin.ListCommittedOffsets(ctx, topic)
}

// QueryMessages reads records out of a topic.
//
// Every mode resolves to the same thing underneath: a starting offset per
// partition, and a read forward from there. That is the only access Kafka
// offers - there is no index on anything but the offset, which is why the
// board is honest about a key search being a scan.
func (c *Conn) QueryMessages(
	ctx context.Context, params model.MessageQueryParams,
) ([]*model.MessageItem, error) {
	if strings.TrimSpace(params.Topic) == "" {
		return nil, fmt.Errorf("a topic is required")
	}
	limit := params.MaxResults
	if limit <= 0 {
		limit = 100
	}

	starts, err := c.admin.ListStartOffsets(ctx, params.Topic)
	if err != nil {
		return nil, err
	}
	ends, err := c.readableEnds(ctx, params.Topic)
	if err != nil {
		return nil, err
	}

	offsets, err := c.startOffsets(ctx, params, limit, starts, ends)
	if err != nil {
		return nil, err
	}
	if len(offsets) == 0 {
		return []*model.MessageItem{}, nil
	}

	records, err := c.readRecords(ctx, params.Topic, offsets, ends, limit, matcherFor(params))
	if err != nil {
		return nil, err
	}

	sort.Slice(records, func(i, j int) bool {
		if records[i].QueueID != records[j].QueueID {
			return records[i].QueueID < records[j].QueueID
		}
		return records[i].QueueOffset < records[j].QueueOffset
	})
	for index, record := range records {
		record.ID = index + 1
	}
	return records, nil
}

// MessageByID reads one record by its coordinates.
//
// Kafka's message id is the topic, partition and offset together. It is a
// stable identity - the same triple always names the same record until it ages
// out - which is why this driver declares CapMessageByID where RabbitMQ cannot.
func (c *Conn) MessageByID(ctx context.Context, topic, messageID string) (*model.MessageItem, error) {
	partition, offset, err := parseMessageID(messageID)
	if err != nil {
		return nil, err
	}
	starts, err := c.admin.ListStartOffsets(ctx, topic)
	if err != nil {
		return nil, err
	}
	ends, err := c.readableEnds(ctx, topic)
	if err != nil {
		return nil, err
	}
	start := offsetAt(starts, topic, partition)
	end := offsetAt(ends, topic, partition)
	if end < 0 {
		return nil, fmt.Errorf("topic %s has no partition %d", topic, partition)
	}
	// Said here rather than left to the fetch: "that offset is outside the
	// log" is a better answer than a read that returns nothing for a reason
	// the caller has to guess at.
	if offset < start || offset >= end {
		return nil, fmt.Errorf(
			"offset %d is outside partition %d, which holds %d to %d",
			offset, partition, start, end-1)
	}

	records, err := c.readRecords(ctx, topic,
		map[int32]int64{partition: offset}, ends, 1, nil)
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return nil, fmt.Errorf("no record at %s", messageID)
	}
	return records[0], nil
}

// messageID is how a record is named across the bridge: the three coordinates
// that identify it, in the order every Kafka tool prints them.
func messageID(topic string, partition int32, offset int64) string {
	return topic + "-" + strconv.FormatInt(int64(partition), 10) + "-" + strconv.FormatInt(offset, 10)
}

func parseMessageID(id string) (int32, int64, error) {
	// The topic itself may contain hyphens, so the split is from the right.
	lastDash := strings.LastIndex(id, "-")
	if lastDash <= 0 {
		return 0, 0, fmt.Errorf("invalid message id %q", id)
	}
	firstDash := strings.LastIndex(id[:lastDash], "-")
	if firstDash <= 0 {
		return 0, 0, fmt.Errorf("invalid message id %q", id)
	}
	partition, err := strconv.ParseInt(id[firstDash+1:lastDash], 10, 32)
	if err != nil {
		return 0, 0, fmt.Errorf("invalid message id %q", id)
	}
	offset, err := strconv.ParseInt(id[lastDash+1:], 10, 64)
	if err != nil {
		return 0, 0, fmt.Errorf("invalid message id %q", id)
	}
	return int32(partition), offset, nil
}

// startOffsets works out where each partition's read begins.
func (c *Conn) startOffsets(
	ctx context.Context,
	params model.MessageQueryParams,
	limit int,
	starts, ends kadm.ListedOffsets,
) (map[int32]int64, error) {
	wanted, err := requestedPartitions(params, ends)
	if err != nil {
		return nil, err
	}
	if len(wanted) == 0 {
		return nil, nil
	}

	mode := params.Filters[FilterMode]
	if mode == "" {
		mode = ModeLatest
	}

	var timestamps kadm.ListedOffsets
	if mode == ModeTime {
		if params.StartTime <= 0 {
			return nil, fmt.Errorf("a start time is required to read from a moment")
		}
		timestamps, err = c.admin.ListOffsetsAfterMilli(ctx, params.StartTime, params.Topic)
		if err != nil {
			return nil, err
		}
	}

	// Reading back from the end shares the budget across the partitions, so a
	// topic with twelve of them does not return twelve times what was asked.
	shares := latestShares(params.Topic, wanted, limit, starts, ends)

	offsets := make(map[int32]int64, len(wanted))
	for _, partition := range wanted {
		start := offsetAt(starts, params.Topic, partition)
		end := offsetAt(ends, params.Topic, partition)
		if start < 0 || end < 0 {
			continue
		}

		var from int64
		switch mode {
		case ModeLatest:
			from = end - shares[partition]
		case ModeKey:
			// A scan has to start where the log does, or a key written long
			// ago is invisible for no stated reason.
			from = start
		case ModeOffset:
			parsed, err := strconv.ParseInt(params.Filters[FilterStartOffset], 10, 64)
			if err != nil {
				return nil, fmt.Errorf("invalid start offset %q", params.Filters[FilterStartOffset])
			}
			from = parsed
		case ModeTime:
			listed, ok := timestamps.Lookup(params.Topic, partition)
			if !ok || listed.Err != nil || listed.Offset < 0 {
				// Nothing was written at or after that moment on this
				// partition, so there is nothing here to read.
				continue
			}
			from = listed.Offset
		default:
			return nil, fmt.Errorf("unknown read mode %q", mode)
		}

		from = clamp(from, start, end)
		if from >= end {
			// Nothing to read: the partition is empty, or the request starts
			// past its last record.
			continue
		}
		offsets[partition] = from
	}
	return offsets, nil
}

/*
 * latestShares decides how many records to take from each partition.
 *
 * An even split is the obvious answer and the wrong one: records are spread
 * unevenly, so a topic holding ten records over two partitions - six and four -
 * answers "the latest ten" with nine, because the five-record share on the
 * four-record partition wastes one.
 *
 * So the budget is handed out in rounds. Every partition takes one record per
 * round until it has nothing left or the budget runs out, which spends the
 * whole budget when the topic can fill it and stays even when it cannot.
 */
func latestShares(
	topic string, partitions []int32, limit int, starts, ends kadm.ListedOffsets,
) map[int32]int64 {
	available := make(map[int32]int64, len(partitions))
	shares := make(map[int32]int64, len(partitions))
	total := int64(0)
	for _, partition := range partitions {
		start := offsetAt(starts, topic, partition)
		end := offsetAt(ends, topic, partition)
		if start < 0 || end < 0 || end <= start {
			continue
		}
		available[partition] = end - start
		total += end - start
	}

	budget := int64(limit)
	if total < budget {
		budget = total
	}
	for budget > 0 {
		spent := false
		for _, partition := range partitions {
			if budget == 0 {
				break
			}
			if shares[partition] >= available[partition] {
				continue
			}
			shares[partition]++
			budget--
			spent = true
		}
		// Nothing left anywhere, which the budget cap above should already
		// have prevented; the guard is what stops a miscount spinning.
		if !spent {
			break
		}
	}
	return shares
}

// requestedPartitions is every partition, or the one the board named.
func requestedPartitions(
	params model.MessageQueryParams, ends kadm.ListedOffsets,
) ([]int32, error) {
	all := make([]int32, 0)
	for partition := range ends[params.Topic] {
		all = append(all, partition)
	}
	sort.Slice(all, func(i, j int) bool { return all[i] < all[j] })

	raw := params.Filters[FilterPartition]
	if raw == "" {
		return all, nil
	}
	chosen, err := strconv.ParseInt(raw, 10, 32)
	if err != nil {
		return nil, fmt.Errorf("invalid partition %q", raw)
	}
	for _, partition := range all {
		if partition == int32(chosen) {
			return []int32{partition}, nil
		}
	}
	return nil, fmt.Errorf("topic %s has no partition %d", params.Topic, chosen)
}

// matcherFor is the filter applied to each record as it arrives, or nil when
// everything read is wanted.
func matcherFor(params model.MessageQueryParams) func(*kgo.Record) bool {
	key := strings.TrimSpace(params.MessageKey)
	if params.Filters[FilterMode] != ModeKey || key == "" {
		return nil
	}
	return func(record *kgo.Record) bool { return string(record.Key) == key }
}

/*
 * readRecords consumes forward from the given offsets.
 *
 * A client of its own, built and closed per read. The admin client is not a
 * consumer and franz-go fixes what a client consumes when it is created, so
 * sharing one would mean a long-lived consumer group's worth of state for what
 * is a one-shot read. This joins no group and commits nothing: browsing must
 * not move anybody's position.
 */
func (c *Conn) readRecords(
	ctx context.Context,
	topic string,
	from map[int32]int64,
	ends kadm.ListedOffsets,
	limit int,
	matches func(*kgo.Record) bool,
) ([]*model.MessageItem, error) {
	/*
	 * A partition already at its end has nothing to give, and asking for it
	 * would block the poll until the deadline: PollRecords waits for records
	 * that will not arrive. Dropping it here is what makes an empty read
	 * return at once instead of hanging for the whole request budget.
	 */
	partitions := make(map[int32]kgo.Offset, len(from))
	remaining := make(map[int32]int64, len(from))
	for partition, offset := range from {
		end := offsetAt(ends, topic, partition)
		if end < 0 || offset >= end {
			continue
		}
		partitions[partition] = kgo.NewOffset().At(offset)
		remaining[partition] = end
	}
	if len(partitions) == 0 {
		return []*model.MessageItem{}, nil
	}

	options, err := dialOptions(c.config)
	if err != nil {
		return nil, err
	}
	options = append(options,
		kgo.ConsumePartitions(map[string]map[int32]kgo.Offset{topic: partitions}),
		// Reading only what is committed keeps a browse from showing records
		// belonging to a transaction that may still abort.
		kgo.FetchIsolationLevel(kgo.ReadCommitted()),
		// An offset outside the log must fail rather than reset. The default
		// is to start over at the beginning, which turned "read offset 9999"
		// on a topic of fifty records into "here is record 0" - the wrong
		// record, reported as the one asked for.
		kgo.ConsumeResetOffset(kgo.NoResetOffset()),
	)
	client, err := kgo.NewClient(options...)
	if err != nil {
		return nil, err
	}
	defer client.Close()

	records := make([]*model.MessageItem, 0, limit)
	scanned := 0
	done := make(map[int32]bool, len(partitions))

	for len(records) < limit && len(done) < len(partitions) {
		fetches := client.PollRecords(ctx, limit)
		if err := ctx.Err(); err != nil {
			// A deadline reached mid-read returns what was found rather than
			// nothing: a partial answer is worth more than an empty one.
			break
		}
		if errs := fetches.Errors(); len(errs) > 0 {
			return nil, errs[0].Err
		}
		if fetches.NumRecords() == 0 {
			break
		}

		fetches.EachRecord(func(record *kgo.Record) {
			scanned++
			if record.Offset+1 >= remaining[record.Partition] {
				done[record.Partition] = true
			}
			if len(records) >= limit {
				return
			}
			if matches != nil && !matches(record) {
				return
			}
			records = append(records, messageFrom(record))
		})
		if matches != nil && scanned >= scanLimit {
			break
		}
	}
	return records, nil
}

// messageFrom maps one Kafka record onto the canonical message.
func messageFrom(record *kgo.Record) *model.MessageItem {
	properties := make(map[string]string, len(record.Headers))
	for _, header := range record.Headers {
		properties[header.Key] = string(header.Value)
	}

	return &model.MessageItem{
		Topic:     record.Topic,
		MessageID: messageID(record.Topic, record.Partition, record.Offset),
		// A null key is not an empty key: Kafka partitions by key, and a
		// record with none is round-robined rather than pinned.
		Keys:           keyOf(record),
		QueueID:        int(record.Partition),
		QueueOffset:    record.Offset,
		StoreTime:      record.Timestamp.Format(time.RFC3339Nano),
		StoreTimestamp: record.Timestamp.UnixMilli(),
		Status:         model.MsgNormal,
		Body:           string(record.Value),
		Properties:     properties,
	}
}

// nullKey marks a record written with no key at all, which Kafka treats
// differently from an empty one when it picks a partition.
const nullKey = "\x00__mqs_null_key"

func keyOf(record *kgo.Record) string {
	if record.Key == nil {
		return nullKey
	}
	return string(record.Key)
}
