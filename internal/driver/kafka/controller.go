package kafka

import (
	"context"

	"github.com/twmb/franz-go/pkg/kerr"
	"github.com/twmb/franz-go/pkg/kmsg"
)

/*
 * Who is actually in charge of the cluster.
 *
 * Not the controller id in a metadata response. Under KRaft - which is every
 * Kafka 4.x cluster, ZooKeeper having been removed - a broker answers that
 * field with a randomly chosen live broker, because its only job there is to
 * give a client somewhere to forward an admin request to. Asking three times
 * gets three different brokers, none of them necessarily the controller. The
 * overview said "controller is broker 3" and the broker list badged broker 2,
 * in the same refresh, on a cluster whose controller had been broker 1
 * throughout.
 *
 * DescribeQuorum is the request that answers the question honestly: the leader
 * of the metadata log is the active controller. On a ZooKeeper cluster there
 * is no quorum to describe and the metadata field is the real answer, so that
 * is the fallback rather than the first choice.
 */

// metadataTopic is the internal log the controller quorum replicates. Its
// leader is the active controller.
const metadataTopic = "__cluster_metadata"

// noController is what the protocol sends when a cluster names none, and what
// this returns when it cannot find out. Rendering it as a broker id would
// invent a broker.
const noController int32 = -1

// activeController reports the node leading the metadata quorum, or
// noController when the cluster does not say.
//
// Errors are not returned: a page that can name the controller is better than
// one that fails to load because it could not, and every caller has a cluster
// to draw either way.
func (c *Conn) activeController(ctx context.Context, metadataFallback int32) int32 {
	request := kmsg.NewDescribeQuorumRequest()
	topic := kmsg.NewDescribeQuorumRequestTopic()
	topic.Topic = metadataTopic
	partition := kmsg.NewDescribeQuorumRequestTopicPartition()
	topic.Partitions = append(topic.Partitions, partition)
	request.Topics = append(request.Topics, topic)

	response, err := request.RequestWith(ctx, c.client)
	if err != nil {
		// Unsupported means a cluster with no metadata quorum - ZooKeeper, or
		// one too old for KIP-595 - where the metadata field is the truth.
		return metadataFallback
	}
	if err := kerr.ErrorForCode(response.ErrorCode); err != nil {
		return metadataFallback
	}
	for _, topic := range response.Topics {
		if topic.Topic != metadataTopic {
			continue
		}
		for _, partition := range topic.Partitions {
			if kerr.ErrorForCode(partition.ErrorCode) != nil {
				continue
			}
			return partition.LeaderID
		}
	}
	return metadataFallback
}
