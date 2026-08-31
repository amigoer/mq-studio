package kafka

import (
	"context"
	"fmt"
	"net"
	"sort"
	"strconv"

	"github.com/twmb/franz-go/pkg/kadm"

	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * Attribute keys the cluster and overview boards read.
 *
 * A private contract between this driver and frontend/src/mq/kafka/cluster.ts,
 * not part of the shared vocabulary: what a Kafka broker reports about itself
 * is not what a RocketMQ or RabbitMQ one does.
 */
const (
	// Per node.
	AttrNodeID     = "nodeId"
	AttrRack       = "rack"
	AttrController = "controller"

	// Per cluster.
	AttrClusterID           = "clusterId"
	AttrControllerNode      = "controllerNode"
	AttrBrokerCount         = "brokers"
	AttrTopicCount          = "topics"
	AttrInternalTopicCount  = "internalTopics"
	AttrPartitionCount      = "partitions"
	AttrUnderReplicated     = "underReplicatedPartitions"
	AttrOfflinePartitions   = "offlinePartitions"
	AttrLeaderlessPartition = "leaderlessPartitions"
	AttrGroupCount          = "consumerGroups"
)

// ListNodes reports the brokers the cluster is made of.
func (c *Conn) ListNodes(ctx context.Context) ([]*model.Node, error) {
	metadata, err := c.admin.BrokerMetadata(fresh(ctx))
	if err != nil {
		return nil, err
	}
	return nodesFrom(metadata), nil
}

// NodeDetail reports one broker, found by the address ListNodes gave it.
func (c *Conn) NodeDetail(ctx context.Context, address string) (*model.Node, error) {
	nodes, err := c.ListNodes(ctx)
	if err != nil {
		return nil, err
	}
	for _, node := range nodes {
		if node.Address == address || node.Name == address {
			return node, nil
		}
	}
	return nil, fmt.Errorf("broker not found: %s", address)
}

// ClusterOverview is the header the cluster and overview pages share.
//
// Kafka has no running totals to ask for - there is no endpoint that answers
// "how many partitions are under-replicated". The figures come from walking
// the metadata of every topic, which is one request, and that walk is the only
// place the health of the cluster exists at all.
func (c *Conn) ClusterOverview(ctx context.Context) (*model.ClusterOverview, error) {
	metadata, err := c.admin.Metadata(fresh(ctx))
	if err != nil {
		return nil, err
	}
	health := healthOf(metadata)

	overview := &model.ClusterOverview{
		Name:        metadata.Cluster,
		TotalNodes:  len(metadata.Brokers),
		OnlineNodes: len(metadata.Brokers),
		// Internal topics are excluded: __consumer_offsets is not something a
		// user made, and counting it makes an empty cluster look populated.
		Destinations: health.topics,
		// Kafka reports no disk figure in metadata. It is in the log dir
		// listing, which is a request per broker and does not belong here.
		AvgDiskUsage:  model.UnknownMetric,
		Subscriptions: model.UnknownMetric,
		Attributes: map[string]string{
			AttrClusterID:           metadata.Cluster,
			AttrControllerNode:      controllerName(metadata),
			AttrBrokerCount:         strconv.Itoa(len(metadata.Brokers)),
			AttrTopicCount:          strconv.Itoa(health.topics),
			AttrInternalTopicCount:  strconv.Itoa(health.internalTopics),
			AttrPartitionCount:      strconv.Itoa(health.partitions),
			AttrUnderReplicated:     strconv.Itoa(health.underReplicated),
			AttrOfflinePartitions:   strconv.Itoa(health.offline),
			AttrLeaderlessPartition: strconv.Itoa(health.leaderless),
		},
	}

	// Groups are a second request, and a cluster that refuses to list them
	// still has a usable overview - so the count is left unknown rather than
	// failing the whole page.
	if groups, err := c.admin.ListGroups(ctx); err == nil {
		overview.Subscriptions = len(groups)
		overview.Attributes[AttrGroupCount] = strconv.Itoa(len(groups))
	}
	return overview, nil
}

// clusterHealth is what one metadata walk yields.
type clusterHealth struct {
	topics         int
	internalTopics int
	partitions     int

	// underReplicated is a partition with fewer in-sync replicas than
	// replicas. It is the first sign of a broker falling behind and the
	// reason this page exists.
	underReplicated int
	// offline is a partition with a replica the cluster cannot reach.
	offline int
	// leaderless is a partition with no leader at all, which means it is
	// neither readable nor writable right now.
	leaderless int
}

func healthOf(metadata kadm.Metadata) clusterHealth {
	var health clusterHealth
	for _, topic := range metadata.Topics {
		if topic.IsInternal {
			health.internalTopics++
		} else {
			health.topics++
		}
		for _, partition := range topic.Partitions {
			health.partitions++
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
	}
	return health
}

func nodesFrom(metadata kadm.Metadata) []*model.Node {
	brokers := append(kadm.BrokerDetails(nil), metadata.Brokers...)
	sort.Slice(brokers, func(i, j int) bool { return brokers[i].NodeID < brokers[j].NodeID })

	nodes := make([]*model.Node, 0, len(brokers))
	for _, broker := range brokers {
		nodes = append(nodes, nodeFrom(broker, metadata.Controller))
	}
	return nodes
}

func nodeFrom(broker kadm.BrokerDetail, controller int32) *model.Node {
	rack := ""
	if broker.Rack != nil {
		rack = *broker.Rack
	}
	return &model.Node{
		// The broker's own node id, which is stable and unique across the
		// cluster - a better list key than a position in a slice, and the
		// number every Kafka tool and log line refers to a broker by.
		ID:      int(broker.NodeID),
		Name:    brokerName(broker),
		Address: brokerAddress(broker),
		Cluster: rack,
		Status:  model.NodeOnline,
		// A broker in metadata is a broker that answered. Kafka reports no
		// rate and no disk figure here, and a zero would read as "measured,
		// and it is zero".
		RateIn:    model.UnknownMetric,
		RateOut:   model.UnknownMetric,
		DiskUsage: model.UnknownMetric,
		Attributes: map[string]string{
			AttrNodeID:     strconv.FormatInt(int64(broker.NodeID), 10),
			AttrRack:       rack,
			AttrController: strconv.FormatBool(broker.NodeID == controller),
		},
	}
}

// brokerName is what an operator calls this broker: its node id, which is what
// every Kafka command line, log line and reassignment plan names it by.
func brokerName(broker kadm.BrokerDetail) string {
	return "broker-" + strconv.FormatInt(int64(broker.NodeID), 10)
}

func brokerAddress(broker kadm.BrokerDetail) string {
	return net.JoinHostPort(broker.Host, strconv.FormatInt(int64(broker.Port), 10))
}

// controllerName is the node id of the controller, or empty when the cluster
// does not name one. -1 is what the protocol sends for "no controller", and
// rendering that as a broker id would invent a broker.
func controllerName(metadata kadm.Metadata) string {
	if metadata.Controller < 0 {
		return ""
	}
	return strconv.FormatInt(int64(metadata.Controller), 10)
}
