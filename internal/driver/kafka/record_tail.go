package kafka

import (
	"context"
	"sort"

	"github.com/twmb/franz-go/pkg/kadm"

	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * TailMessages follows a topic's newest records.
 *
 * The one thing Kafka is better at than either other family this app speaks
 * to: a log with a stable position per partition is exactly what an
 * incremental tail needs, so the cursor is real rather than a re-read of the
 * end with the difference worked out afterwards.
 *
 * Nothing streams. The caller owns the loop because the caller owns the
 * lifetime: a goroutine started here would outlive the panel that asked for it
 * whenever the renderer forgot to say stop.
 */
func (c *Conn) TailMessages(
	ctx context.Context, ref model.DestinationRef, cursor model.TailCursor, limit int,
) (*model.TailBatch, error) {
	if limit <= 0 {
		limit = 100
	}

	starts, err := c.admin.ListStartOffsets(ctx, ref.Name)
	if err != nil {
		return nil, err
	}
	ends, err := c.admin.ListEndOffsets(ctx, ref.Name)
	if err != nil {
		return nil, err
	}

	from, dropped := tailPositions(ref.Name, cursor, starts, ends)
	if len(from) == 0 {
		return &model.TailBatch{
			Messages: []*model.MessageItem{},
			Cursor:   cursorFrom(from),
			Dropped:  dropped,
		}, nil
	}

	records, err := c.readRecords(ctx, ref.Name, from, ends, limit, nil)
	if err != nil {
		return nil, err
	}
	sort.Slice(records, func(i, j int) bool {
		if records[i].StoreTimestamp != records[j].StoreTimestamp {
			return records[i].StoreTimestamp < records[j].StoreTimestamp
		}
		return records[i].QueueOffset < records[j].QueueOffset
	})

	// The cursor advances past what was read, and to the end of any partition
	// nothing came from: a partition can move on without this tail matching
	// anything, and a cursor that stayed put would re-read it forever.
	next := make(map[int32]int64, len(from))
	for partition, offset := range from {
		next[partition] = offset
	}
	for _, record := range records {
		partition := int32(record.QueueID)
		if record.QueueOffset+1 > next[partition] {
			next[partition] = record.QueueOffset + 1
		}
	}

	for index, record := range records {
		record.ID = index + 1
	}
	return &model.TailBatch{Messages: records, Cursor: cursorFrom(next), Dropped: dropped}, nil
}

/*
 * tailPositions is where each partition's next poll starts.
 *
 * An empty cursor means the end of the log: a tail opens on what arrives next
 * rather than replaying what is stored, which is the message query's job.
 *
 * A position below a partition's start has aged out between two polls - the
 * tail is slower than the retention it is watching - and the records in
 * between are gone. Those are counted and reported rather than skipped
 * quietly, because a tail that is silently losing looks exactly like a quiet
 * one.
 */
func tailPositions(
	topic string, cursor model.TailCursor, starts, ends kadm.ListedOffsets,
) (map[int32]int64, int64) {
	known := make(map[int32]int64, len(cursor.Positions))
	for _, position := range cursor.Positions {
		known[int32(position.QueueID)] = position.Offset
	}

	from := make(map[int32]int64)
	dropped := int64(0)
	for partition := range ends[topic] {
		start := offsetAt(starts, topic, partition)
		end := offsetAt(ends, topic, partition)
		if end < 0 {
			continue
		}
		at, seen := known[partition]
		if !seen {
			from[partition] = end
			continue
		}
		if start >= 0 && at < start {
			dropped += start - at
			at = start
		}
		from[partition] = at
	}
	return from, dropped
}

func cursorFrom(positions map[int32]int64) model.TailCursor {
	partitions := make([]int32, 0, len(positions))
	for partition := range positions {
		partitions = append(partitions, partition)
	}
	sort.Slice(partitions, func(i, j int) bool { return partitions[i] < partitions[j] })

	cursor := model.TailCursor{Positions: make([]model.QueuePosition, 0, len(partitions))}
	for _, partition := range partitions {
		cursor.Positions = append(cursor.Positions, model.QueuePosition{
			QueueID: int(partition),
			Offset:  positions[partition],
		})
	}
	return cursor
}
