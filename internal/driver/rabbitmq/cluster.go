package rabbitmq

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	rabbithole "github.com/michaelklishin/rabbit-hole/v3"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/timestamp"
)

// Attribute keys this driver puts on a Node. They are a contract with
// frontend/src/mq/rabbitmq/nodes.ts.
const (
	AttrNodeType      = "nodeType"
	AttrSchedulers    = "schedulers"
	AttrErlangProcs   = "erlangProcesses"
	AttrErlangProcMax = "erlangProcessLimit"
	AttrUptime        = "uptime"
	AttrFdUsed        = "fileDescriptorsUsed"
	AttrFdLimit       = "fileDescriptorLimit"
	AttrMemUsed       = "memoryUsed"
	AttrMemLimit      = "memoryLimit"
	AttrMemAlarm      = "memoryAlarm"
	AttrDiskFree      = "diskFree"
	AttrDiskLimit     = "diskFreeLimit"
	AttrDiskAlarm     = "diskFreeAlarm"
	AttrPartitions    = "partitions"
	AttrRunQueue      = "runQueue"
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
	case len(node.Partitions) > 0, node.MemAlarm, node.DiskFreeAlarm:
		status = model.NodeWarning
	}

	return &model.Node{
		Name:    node.Name,
		Address: node.Name,
		Version: version,
		Status:  status,
		// A node reports no per-node throughput. The rates live on the broker
		// as a whole and on each queue, so anything here would be invented.
		RateIn:  model.UnknownMetric,
		RateOut: model.UnknownMetric,
		// Disk is free-space headroom against an alarm threshold, not a
		// fraction of a total the broker knows. A percentage would be a number
		// nobody measured; the bytes and the alarm flag are in the attributes.
		DiskUsage: model.UnknownMetric,
		LastSeen:  timestamp.Now(),
		Attributes: map[string]string{
			AttrNodeType:      node.NodeType,
			AttrSchedulers:    strconv.FormatUint(uint64(node.Processors), 10),
			AttrErlangProcs:   strconv.Itoa(node.ProcUsed),
			AttrErlangProcMax: strconv.Itoa(node.ProcTotal),
			AttrUptime:        strconv.FormatUint(node.Uptime, 10),
			AttrFdUsed:        strconv.Itoa(node.FdUsed),
			AttrFdLimit:       strconv.Itoa(node.FdTotal),
			AttrMemUsed:       strconv.Itoa(node.MemUsed),
			AttrMemLimit:      strconv.Itoa(node.MemLimit),
			AttrMemAlarm:      strconv.FormatBool(node.MemAlarm),
			AttrDiskFree:      strconv.Itoa(node.DiskFree),
			AttrDiskLimit:     strconv.Itoa(node.DiskFreeLimit),
			AttrDiskAlarm:     strconv.FormatBool(node.DiskFreeAlarm),
			// A non-empty list is a split brain, which is the single most
			// important thing a RabbitMQ node can be saying.
			AttrPartitions: strings.Join(node.Partitions, ","),
			AttrRunQueue:   strconv.FormatUint(uint64(node.RunQueueLength), 10),
		},
	}
}
