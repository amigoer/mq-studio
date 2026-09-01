package pulsar

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/apache/pulsar-client-go/pulsaradmin/pkg/utils"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/timestamp"
)

// ListNodes is every broker the cluster considers active.
//
// The listing is addresses and nothing else - that is all
// GetActiveBrokers returns - so the figures come from the load report, which
// describes exactly one broker: whichever answered. On a single-broker cluster
// that is the whole cluster; behind a load balancer it is one of several, and
// the rest keep UnknownMetric rather than borrowing its numbers.
func (c *Conn) ListNodes(ctx context.Context) ([]*model.Node, error) {
	cluster, err := c.localCluster(ctx)
	if err != nil {
		return nil, err
	}
	addresses, err := c.admin.Brokers().GetActiveBrokersWithContext(ctx, cluster)
	if err != nil {
		return nil, fmt.Errorf("list the active brokers of cluster %q: %w", cluster, err)
	}

	report := c.loadReport(ctx)
	leader := c.leaderAddress(ctx)

	nodes := make([]*model.Node, 0, len(addresses))
	for i, address := range addresses {
		node := newNode(i+1, address, cluster)
		if address == leader {
			node.Attributes[AttrNodeLeader] = "true"
		}
		// The report describes the broker that served it, so it is only
		// attached to that one. Spreading it across the listing would invent
		// figures for brokers nobody asked.
		if report != nil && hostOf(report.WebServiceURL) == hostOf(address) {
			applyLoadReport(node, report)
		}
		nodes = append(nodes, node)
	}
	return nodes, nil
}

// NodeDetail is one broker.
//
// Pulsar has no per-broker admin endpoint: every call goes to the web service
// address this profile was configured with, and it answers for itself. So a
// detail is only richer than the listing for the broker that happens to be
// serving the connection, and the others honestly report what the listing knew.
func (c *Conn) NodeDetail(ctx context.Context, address string) (*model.Node, error) {
	nodes, err := c.ListNodes(ctx)
	if err != nil {
		return nil, err
	}
	for _, node := range nodes {
		if hostOf(node.Address) == hostOf(address) {
			return node, nil
		}
	}
	return nil, fmt.Errorf("no active broker at %q", address)
}

// ClusterOverview is the header every cluster page opens with.
func (c *Conn) ClusterOverview(ctx context.Context) (*model.ClusterOverview, error) {
	cluster, err := c.localCluster(ctx)
	if err != nil {
		return nil, err
	}
	addresses, err := c.admin.Brokers().GetActiveBrokersWithContext(ctx, cluster)
	if err != nil {
		return nil, fmt.Errorf("list the active brokers of cluster %q: %w", cluster, err)
	}

	overview := &model.ClusterOverview{
		Name:        cluster,
		TotalNodes:  len(addresses),
		OnlineNodes: len(addresses),
		// Counting these means walking every namespace's topics, which is the
		// topics page's job and costs a request per namespace. Until the
		// header can be filled from something the cluster already knows, it
		// says it does not know rather than showing a zero.
		Destinations:  model.UnknownMetric,
		Subscriptions: model.UnknownMetric,
		// Pulsar keeps its messages in BookKeeper, and the broker reports no
		// disk figure of its own - not a full one and not a free one. A zero
		// here would read as an empty disk.
		AvgDiskUsage: model.UnknownMetric,
		Attributes:   map[string]string{AttrClusterName: cluster},
	}

	if data, err := c.admin.Clusters().GetWithContext(ctx, cluster); err == nil {
		putIf(overview.Attributes, AttrClusterServiceURL, data.ServiceURL)
		putIf(overview.Attributes, AttrClusterBrokerServiceURL, data.BrokerServiceURL)
	}
	// The metadata store is Pulsar's discovery tier. It is best-effort because
	// reading it needs a superuser on some clusters, and a header that fails
	// entirely over one missing label is worse than a header without it.
	if internal, err := c.admin.Brokers().GetInternalConfigurationDataWithContext(ctx); err == nil &&
		internal != nil {
		putIf(overview.Attributes, AttrClusterMetadataStore, internal.ZookeeperServers)
	}
	return overview, nil
}

// localCluster is the cluster this profile's admin API belongs to.
//
// A Pulsar web service answers for exactly one cluster, but the listing is
// plural because the same API also administers the peers it replicates to. The
// first is the local one.
func (c *Conn) localCluster(ctx context.Context) (string, error) {
	clusters, err := c.admin.Clusters().ListWithContext(ctx)
	if err != nil {
		return "", fmt.Errorf("list clusters: %w", err)
	}
	if len(clusters) == 0 {
		return "", fmt.Errorf("the admin API reports no clusters")
	}
	return clusters[0], nil
}

// loadReport is the serving broker's own figures, or nil.
//
// Nil is a normal answer, not a failure. A cluster running NoopLoadManager -
// which is what `pulsar standalone` defaults to - answers 204 to this and has
// no rates to give. The capability is degraded for it at probe time; here it
// simply means the numbers stay unknown.
//
// The nil check is not defensive: pulsaradmin's GetLoadReport returns
// (nil, nil) on every error it meets, so an error arrives as a nil pointer and
// dereferencing the result without this would panic on an unreachable broker.
func (c *Conn) loadReport(ctx context.Context) *utils.LocalBrokerData {
	report, err := c.admin.BrokerStats().GetLoadReportWithContext(ctx)
	if err != nil || report == nil || report.WebServiceURL == "" {
		return nil
	}
	return report
}

// leaderAddress is the broker holding load-manager leadership, or "".
func (c *Conn) leaderAddress(ctx context.Context) string {
	leader, err := c.admin.Brokers().GetLeaderBrokerWithContext(ctx)
	if err != nil {
		return ""
	}
	if leader.BrokerID != "" {
		return leader.BrokerID
	}
	return hostOf(leader.ServiceURL)
}

func newNode(id int, address, cluster string) *model.Node {
	return &model.Node{
		ID:      id,
		Name:    address,
		Address: address,
		Cluster: cluster,
		// The listing is what the cluster considers active, so a broker in it
		// is up by definition. There is no third state to report.
		Status:    model.NodeOnline,
		RateIn:    model.UnknownMetric,
		RateOut:   model.UnknownMetric,
		DiskUsage: model.UnknownMetric,
		LastSeen:  timestamp.Now(),
		Attributes: map[string]string{
			AttrNodeLeader: "false",
		},
	}
}

func applyLoadReport(node *model.Node, report *utils.LocalBrokerData) {
	node.RateIn = int(report.MsgRateIn)
	node.RateOut = int(report.MsgRateOut)
	node.Version = report.BrokerVersionString

	putIf(node.Attributes, AttrNodeVersion, report.BrokerVersionString)
	putIf(node.Attributes, AttrNodeServiceURL, report.PulsarServiceURL)
	node.Attributes[AttrNodeTopics] = strconv.Itoa(report.NumTopics)
	node.Attributes[AttrNodeBundles] = strconv.Itoa(report.NumBundles)
	node.Attributes[AttrNodeProducers] = strconv.Itoa(report.NumProducers)
	node.Attributes[AttrNodeConsumers] = strconv.Itoa(report.NumConsumers)
	putIf(node.Attributes, AttrNodeCPUPercent, usagePercent(report.CPU))
	putIf(node.Attributes, AttrNodeMemoryPercent, usagePercent(report.Memory))
	putIf(node.Attributes, AttrNodeDirectMemoryPercent, usagePercent(report.DirectMemory))
}

// usagePercent is a resource against its own limit, or "" when the broker
// reported no limit.
//
// The raw usage figure alone is meaningless: CPU is scaled across cores, so
// its limit is 100 per core and a usage of 300 is either heavy load or idle
// depending on how many there are. A missing limit gives no percentage rather
// than a division nobody can interpret.
func usagePercent(usage utils.ResourceUsage) string {
	if usage.Limit <= 0 {
		return ""
	}
	return strconv.Itoa(int(usage.Usage / usage.Limit * 100))
}

// hostOf reduces an address to host:port so the forms the cluster uses for the
// same broker compare equal - a bare "broker:8080" from the active listing
// against "http://broker:8080" from the load report.
func hostOf(address string) string {
	trimmed := strings.TrimSpace(address)
	if trimmed == "" {
		return ""
	}
	if !strings.Contains(trimmed, "://") {
		return strings.TrimSuffix(trimmed, "/")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return trimmed
	}
	return parsed.Host
}

// putIf writes a value only when there is one, so an absent figure stays
// absent instead of becoming an empty column.
func putIf(attributes map[string]string, key, value string) {
	if value != "" {
		attributes[key] = value
	}
}
