package rocketmq

import (
	"context"
	"sort"
	"strconv"

	"github.com/amigoer/mq-studio/internal/model"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// Attribute keys this driver puts on a Node.
const (
	AttrRole                  = "role"
	AttrBrokerID              = "brokerId"
	AttrHAAddress             = "haAddress"
	AttrTopics                = "topics"
	AttrGroups                = "groups"
	AttrMsgInToday            = "msgInToday"
	AttrMsgOutToday           = "msgOutToday"
	AttrConsumeQueueDiskUsage = "consumeQueueDiskUsage"
)

// ListNodes returns every broker in the cluster.
func (c *Conn) ListNodes(ctx context.Context) ([]*model.Node, error) {
	brokers, err := c.GetBrokers(ctx)
	if err != nil {
		return nil, err
	}
	nodes := make([]*model.Node, 0, len(brokers))
	for _, broker := range brokers {
		nodes = append(nodes, nodeFromBroker(broker))
	}
	return nodes, nil
}

// NodeDetail returns runtime statistics for one broker, plus how far its
// slaves trail it.
//
// The replication state is a second request, which is why it is here and not
// in ListNodes: a cluster page would otherwise pay one per broker on every
// refresh. A master with no slaves reports none, and a slave answers about
// nothing, so an empty result is normal rather than a failure.
func (c *Conn) NodeDetail(ctx context.Context, address string) (*model.Node, error) {
	broker, err := c.GetBrokerDetail(ctx, address)
	if err != nil {
		return nil, err
	}
	node := nodeFromBroker(broker)
	node.Replicas = c.replicaStatus(ctx, address)
	return node, nil
}

// replicaStatus reads the HA state of one broker's followers.
//
// Best effort: a broker that does not answer leaves the section empty rather
// than failing the whole detail, which is the same rule the runtime statistics
// follow.
func (c *Conn) replicaStatus(ctx context.Context, address string) []model.ReplicaStatus {
	var status *admin.BrokerHAStatus
	err := c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
		var callErr error
		status, callErr = retryClient.GetBrokerHAStatus(ctx, address)
		return callErr
	})
	if err != nil || status == nil {
		return nil
	}

	replicas := make([]model.ReplicaStatus, 0, len(status.HaConnectionSet))
	for _, connection := range status.HaConnectionSet {
		replicas = append(replicas, model.ReplicaStatus{
			Address:     connection.Addr,
			BehindBytes: connection.Diff,
			InSync:      connection.InSync,
		})
	}
	sort.Slice(replicas, func(left, right int) bool {
		return replicas[left].Address < replicas[right].Address
	})
	return replicas
}

// ClusterOverview aggregates the cluster header counters.
func (c *Conn) ClusterOverview(ctx context.Context) (*model.ClusterOverview, error) {
	info, err := c.GetClusterInfo(ctx)
	if err != nil {
		return nil, err
	}
	return &model.ClusterOverview{
		Name:          info.ClusterName,
		TotalNodes:    info.TotalBrokers,
		OnlineNodes:   info.OnlineBrokers,
		Destinations:  info.TotalTopics,
		Subscriptions: info.TotalGroups,
		AvgDiskUsage:  info.AvgDiskUsage,
	}, nil
}

func nodeFromBroker(broker *model.BrokerNode) *model.Node {
	if broker == nil {
		return nil
	}
	return &model.Node{
		ID:      broker.ID,
		Name:    broker.BrokerName,
		Address: broker.Address,
		Cluster: broker.Cluster,
		Version: broker.Version,
		Status:  broker.Status,
		RateIn:  broker.TpsIn,
		RateOut: broker.TpsOut,
		// CommitLog is what the disk alert watches, so it is the one that
		// travels as the canonical figure; the consume queue rides along as
		// an attribute.
		DiskUsage: broker.CommitLogDiskUsage,
		LastSeen:  broker.LastUpdate,
		Attributes: map[string]string{
			AttrRole:                  string(broker.Role),
			AttrBrokerID:              strconv.Itoa(broker.BrokerID),
			AttrHAAddress:             broker.HAAddress,
			AttrTopics:                strconv.Itoa(broker.Topics),
			AttrGroups:                strconv.Itoa(broker.Groups),
			AttrMsgInToday:            strconv.FormatInt(broker.MsgInToday, 10),
			AttrMsgOutToday:           strconv.FormatInt(broker.MsgOutToday, 10),
			AttrConsumeQueueDiskUsage: strconv.Itoa(broker.ConsumeQueueDiskUsage),
			AttrRemark:                broker.Remark,
		},
	}
}

// BrokerFromNode rebuilds the RocketMQ shape the current bridge still speaks.
func BrokerFromNode(node *model.Node) *model.BrokerNode {
	if node == nil {
		return nil
	}
	return &model.BrokerNode{
		ID:                    node.ID,
		Cluster:               node.Cluster,
		BrokerName:            node.Name,
		BrokerID:              atoiOr(node.Attribute(AttrBrokerID), 0),
		Role:                  model.BrokerRole(node.Attribute(AttrRole)),
		Address:               node.Address,
		HAAddress:             node.Attribute(AttrHAAddress),
		Version:               node.Version,
		Status:                node.Status,
		Topics:                atoiOr(node.Attribute(AttrTopics), model.UnknownMetric),
		Groups:                atoiOr(node.Attribute(AttrGroups), model.UnknownMetric),
		TpsIn:                 node.RateIn,
		TpsOut:                node.RateOut,
		MsgInToday:            atoi64Or(node.Attribute(AttrMsgInToday), 0),
		MsgOutToday:           atoi64Or(node.Attribute(AttrMsgOutToday), 0),
		CommitLogDiskUsage:    node.DiskUsage,
		ConsumeQueueDiskUsage: atoiOr(node.Attribute(AttrConsumeQueueDiskUsage), model.UnknownMetric),
		LastUpdate:            node.LastSeen,
		Remark:                node.Attribute(AttrRemark),
	}
}

func atoi64Or(raw string, fallback int64) int64 {
	if value, err := strconv.ParseInt(raw, 10, 64); err == nil {
		return value
	}
	return fallback
}
