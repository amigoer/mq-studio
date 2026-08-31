package kafka

import (
	"context"
	"errors"
	"fmt"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kerr"

	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * PurgeQueue empties a topic without deleting it.
 *
 * DeleteRecords, which is not a delete in the ordinary sense: it moves each
 * partition's start offset forward to its end, so the records before it become
 * unreadable and the broker reclaims their segments on its own schedule. The
 * offsets do not restart - a consumer that was at 900 stays at 900 and is
 * simply caught up - which is the difference between this and recreating the
 * topic, and the reason it is safe on a topic something is reading.
 */
func (c *Conn) PurgeQueue(ctx context.Context, ref model.DestinationRef) error {
	ends, err := c.admin.ListEndOffsets(ctx, ref.Name)
	if err != nil {
		return err
	}
	targets := make(kadm.Offsets)
	for partition, end := range ends[ref.Name] {
		if end.Err != nil || end.Offset < 0 {
			continue
		}
		targets.AddOffset(ref.Name, partition, end.Offset, -1)
	}
	if len(targets) == 0 {
		return fmt.Errorf("topic not found: %s", ref.Name)
	}
	return c.deleteRecords(ctx, targets)
}

/*
 * DropMessages discards a bounded batch from the head of each partition.
 *
 * The same call as a purge with a different target: the start offset moves
 * forward by limit instead of all the way to the end. It is what an operator
 * reaches for when a topic is full and only the oldest records are expendable.
 *
 * The count returned is what was actually dropped, which is not always what
 * was asked for: a partition holding less than the limit gives up only what it
 * has, and reporting the request back would overstate what happened.
 */
func (c *Conn) DropMessages(ctx context.Context, ref model.DestinationRef, limit int) (int, error) {
	if limit <= 0 {
		return 0, fmt.Errorf("a number of records to drop is required")
	}
	starts, err := c.admin.ListStartOffsets(ctx, ref.Name)
	if err != nil {
		return 0, err
	}
	ends, err := c.admin.ListEndOffsets(ctx, ref.Name)
	if err != nil {
		return 0, err
	}

	dropped := 0
	targets := make(kadm.Offsets)
	for partition, start := range starts[ref.Name] {
		if start.Err != nil || start.Offset < 0 {
			continue
		}
		end := offsetAt(ends, ref.Name, partition)
		if end < 0 {
			continue
		}
		target := start.Offset + int64(limit)
		if target > end {
			target = end
		}
		if target <= start.Offset {
			continue
		}
		dropped += int(target - start.Offset)
		targets.AddOffset(ref.Name, partition, target, -1)
	}
	if len(targets) == 0 {
		return 0, nil
	}
	if err := c.deleteRecords(ctx, targets); err != nil {
		return 0, err
	}
	return dropped, nil
}

func (c *Conn) deleteRecords(ctx context.Context, targets kadm.Offsets) error {
	responses, err := c.admin.DeleteRecords(ctx, targets)
	if err != nil {
		return err
	}
	for _, partitions := range responses {
		for _, response := range partitions {
			if response.Err != nil {
				return response.Err
			}
		}
	}
	return nil
}

/*
 * MoveMessages has no Kafka operation behind it and says so.
 *
 * There is no server-side move: draining one topic into another means
 * consuming every record and producing it again, which is a data pipeline
 * rather than an administrative action - it needs a group, a commit strategy,
 * and a plan for what happens when it is interrupted halfway. CapDestinationMove
 * is never declared, so no page offers it; this exists because Go requires
 * every method of the interface.
 */
func (c *Conn) MoveMessages(context.Context, model.MoveRequest) (int, error) {
	return 0, fmt.Errorf(
		"kafka has no server-side move; copying between topics is a consumer and a producer, not an admin call")
}

/*
 * RebalanceQueues elects each partition's preferred leader.
 *
 * The first replica in a partition's list is its preferred leader, and Kafka
 * assigns those evenly when a topic is created. After a broker restarts, the
 * partitions it led are still led by whoever took over, so leadership piles up
 * on the brokers that stayed - which is exactly what this canonical operation
 * means for every family that has it: put the leaders back where they belong.
 *
 * Preferred only, never unclean. An unclean election promotes a replica that
 * is not in sync and discards whatever the old leader had that it does not,
 * which is data loss and belongs behind its own control rather than inside a
 * button labelled rebalance.
 */
func (c *Conn) RebalanceQueues(ctx context.Context) error {
	results, err := c.admin.ElectLeaders(ctx, kadm.ElectPreferredReplica, nil)
	if err != nil {
		return err
	}
	return firstElectionError(results)
}

/*
 * firstElectionError ignores the partitions that were already right.
 *
 * ELECTION_NOT_NEEDED is what Kafka answers for a partition whose preferred
 * leader is already leading, and on a healthy cluster that is most of them.
 * Treating it as a failure would make a successful rebalance report an error
 * every time it had little to do.
 */
func firstElectionError(results kadm.ElectLeadersResults) error {
	for _, partitions := range results {
		for _, result := range partitions {
			if result.Err == nil || isElectionNotNeeded(result.Err) {
				continue
			}
			if result.ErrMessage != "" {
				return fmt.Errorf("%w: %s", result.Err, result.ErrMessage)
			}
			return result.Err
		}
	}
	return nil
}

func isElectionNotNeeded(err error) bool {
	return errors.Is(err, kerr.ElectionNotNeeded)
}
