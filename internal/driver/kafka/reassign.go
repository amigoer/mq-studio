package kafka

import (
	"context"
	"fmt"
	"sort"

	"github.com/twmb/franz-go/pkg/kadm"

	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * Moving a partition between brokers.
 *
 * A partition's replica list is the only piece of a topic's placement an
 * administrator can rewrite. Kafka accepts the new list and then copies the log
 * to its new home in the background, at whatever rate the cluster's throttles
 * allow, which is why this is the one operation in the driver with no
 * completion to wait for: the only way to know a move finished is that the
 * partition stops reporting one.
 */

// ListReassignments reports the partitions currently being moved.
//
// Empty is the normal state and the useful one: it is how an operator knows
// the last plan finished.
func (c *Conn) ListReassignments(ctx context.Context) ([]*model.PartitionReassignment, error) {
	responses, err := c.admin.ListPartitionReassignments(ctx, nil)
	if err != nil {
		return nil, err
	}

	moving := make([]*model.PartitionReassignment, 0)
	responses.Each(func(response kadm.ListPartitionReassignmentsResponse) {
		// A partition with neither half in flight is not being moved; Kafka
		// lists it anyway on some paths.
		if len(response.AddingReplicas) == 0 && len(response.RemovingReplicas) == 0 {
			return
		}
		moving = append(moving, &model.PartitionReassignment{
			Topic:     response.Topic,
			Partition: response.Partition,
			Replicas:  sortedIDs(response.Replicas),
			Adding:    sortedIDs(response.AddingReplicas),
			Removing:  sortedIDs(response.RemovingReplicas),
		})
	})

	sort.Slice(moving, func(i, j int) bool {
		if moving[i].Topic != moving[j].Topic {
			return moving[i].Topic < moving[j].Topic
		}
		return moving[i].Partition < moving[j].Partition
	})
	return moving, nil
}

/*
 * Reassign rewrites where one partition's replicas live.
 *
 * The list is ordered and the order matters: the first broker is the preferred
 * leader, which is what a later rebalance elects. A plan that puts the right
 * brokers in the wrong order moves the data correctly and leaves leadership
 * where nobody wanted it.
 */
func (c *Conn) Reassign(ctx context.Context, topic string, partition int32, brokers []int32) error {
	if topic == "" {
		return fmt.Errorf("a topic is required")
	}
	if len(brokers) == 0 {
		return fmt.Errorf("a partition needs at least one replica; to cancel a move, cancel it")
	}
	if err := c.checkBrokers(ctx, brokers); err != nil {
		return err
	}

	var request kadm.AlterPartitionAssignmentsReq
	request.Assign(topic, partition, brokers)
	responses, err := c.admin.AlterPartitionAssignments(ctx, request)
	if err != nil {
		return err
	}
	return responses.Error()
}

// CancelReassignment stops a move in flight, leaving the partition wherever it
// has got to. Kafka expresses this as assigning nothing.
func (c *Conn) CancelReassignment(ctx context.Context, topic string, partition int32) error {
	if topic == "" {
		return fmt.Errorf("a topic is required")
	}
	var request kadm.AlterPartitionAssignmentsReq
	request.CancelAssign(topic, partition)
	responses, err := c.admin.AlterPartitionAssignments(ctx, request)
	if err != nil {
		return err
	}
	return responses.Error()
}

/*
 * checkBrokers refuses a plan naming a broker that is not there.
 *
 * Kafka accepts one: the partition is assigned to a broker that does not
 * exist, the copy never starts, and the reassignment sits in flight until
 * somebody cancels it. Saying so before the request is the difference between
 * a form error and an afternoon.
 *
 * A duplicate is refused for a related reason - two copies on one broker is
 * not two replicas, and Kafka's own error for it says nothing about which
 * broker was repeated.
 */
func (c *Conn) checkBrokers(ctx context.Context, brokers []int32) error {
	known, err := c.admin.ListBrokers(ctx)
	if err != nil {
		return err
	}
	live := make(map[int32]bool, len(known))
	for _, broker := range known {
		live[broker.NodeID] = true
	}

	seen := make(map[int32]bool, len(brokers))
	for _, broker := range brokers {
		if !live[broker] {
			return fmt.Errorf("this cluster has no broker %d", broker)
		}
		if seen[broker] {
			return fmt.Errorf("broker %d is named twice; a partition cannot hold two copies on one broker", broker)
		}
		seen[broker] = true
	}
	return nil
}

func sortedIDs(ids []int32) []int32 {
	out := append([]int32(nil), ids...)
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}
