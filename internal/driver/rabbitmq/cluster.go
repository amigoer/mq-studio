package rabbitmq

import (
	"context"
	"fmt"
	"strconv"

	rabbithole "github.com/michaelklishin/rabbit-hole/v3"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/timestamp"
)

// Attribute keys this driver puts on a Node.
const (
	AttrNodeType    = "nodeType"
	AttrErlangProcs = "erlangProcesses"
	AttrUptime      = "uptime"
	AttrFdUsed      = "fileDescriptorsUsed"
)

// ListNodes returns the cluster's nodes.
func (c *Conn) ListNodes(ctx context.Context) ([]*model.Node, error) {
	found, err := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.NodeInfo, error) {
		return client.ListNodes()
	})
	if err != nil {
		return nil, fmt.Errorf("list nodes: %w", err)
	}
	nodes := make([]*model.Node, 0, len(found))
	for i := range found {
		nodes = append(nodes, nodeFrom(&found[i], c.version))
	}
	return nodes, nil
}

// NodeDetail returns one node.
func (c *Conn) NodeDetail(ctx context.Context, address string) (*model.Node, error) {
	found, err := call(ctx, c.mgmt, func(client *rabbithole.Client) (*rabbithole.NodeInfo, error) {
		return client.GetNode(address)
	})
	if err != nil {
		return nil, fmt.Errorf("get node %q: %w", address, err)
	}
	return nodeFrom(found, c.version), nil
}

// ClusterOverview aggregates the header counters.
func (c *Conn) ClusterOverview(ctx context.Context) (*model.ClusterOverview, error) {
	overview, err := c.overview(ctx)
	if err != nil {
		return nil, fmt.Errorf("overview: %w", err)
	}
	nodes, err := c.ListNodes(ctx)
	if err != nil {
		return nil, err
	}

	online := 0
	for _, node := range nodes {
		if node.Status == model.NodeOnline {
			online++
		}
	}

	return &model.ClusterOverview{
		Name:          overview.Node,
		TotalNodes:    len(nodes),
		OnlineNodes:   online,
		Destinations:  overview.ObjectTotals.Queues,
		Subscriptions: overview.ObjectTotals.Consumers,
		// RabbitMQ reports memory and disk headroom per node, not a cluster
		// percentage. Averaging alarm flags into a percent would invent a
		// number, so the header shows an em dash instead.
		AvgDiskUsage: model.UnknownMetric,
	}, nil
}

func nodeFrom(node *rabbithole.NodeInfo, version string) *model.Node {
	status := model.NodeOnline
	switch {
	case !node.IsRunning:
		status = model.NodeOffline
	case node.MemAlarm || node.DiskFreeAlarm:
		status = model.NodeWarning
	}

	return &model.Node{
		Name:    node.Name,
		Address: node.Name,
		Version: version,
		Status:  status,
		RateIn:  model.UnknownMetric,
		RateOut: model.UnknownMetric,
		// There is no single disk-usage percentage to report: the broker
		// exposes free-space headroom and an alarm flag instead.
		DiskUsage: model.UnknownMetric,
		LastSeen:  timestamp.Now(),
		Attributes: map[string]string{
			AttrNodeType:    node.NodeType,
			AttrErlangProcs: strconv.FormatUint(uint64(node.Processors), 10),
			AttrUptime:      strconv.FormatUint(node.Uptime, 10),
			AttrFdUsed:      strconv.Itoa(node.FdUsed),
		},
	}
}
