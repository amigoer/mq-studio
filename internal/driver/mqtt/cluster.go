package mqtt

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/amigoer/mq-studio/internal/driver/mqtt/emqx"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/timestamp"
)

// Attributes the cluster pages read. They are a contract with
// frontend/src/mq/mqtt/cluster.ts.
const (
	AttrClientsConnected    = "clientsConnected"
	AttrClientsTotal        = "clientsTotal"
	AttrClientsMaximum      = "clientsMaximum"
	AttrClientsInactive     = "clientsInactive"
	AttrClientsExpired      = "clientsExpired"
	AttrSubscriptions       = "subscriptions"
	AttrSharedSubscriptions = "sharedSubscriptions"
	AttrRetainedCount       = "retainedCount"
	AttrMessagesReceived    = "messagesReceived"
	AttrMessagesSent        = "messagesSent"
	AttrMessagesStored      = "messagesStored"
	AttrMessagesDropped     = "messagesDropped"
	AttrBytesReceived       = "bytesReceived"
	AttrBytesSent           = "bytesSent"
	AttrHeapCurrent         = "heapCurrent"
	AttrUptimeSeconds       = "uptimeSeconds"
	AttrBrokerVersion       = "brokerVersion"

	// Attributes only a management API can fill in.
	AttrNodeRole        = "nodeRole"
	AttrNodeEdition     = "nodeEdition"
	AttrNodeConnections = "nodeConnections"
	AttrNodeLive        = "nodeLiveConnections"
	AttrNodeSessions    = "nodeSessions"
	AttrMemoryUsed      = "memoryUsed"
	AttrMemoryTotal     = "memoryTotal"
	AttrLoad1           = "load1"
	AttrLoad5           = "load5"
	AttrLoad15          = "load15"
	AttrOTPRelease      = "otpRelease"

	// AttrSysTopics is the whole tree, as "topic\tvalue" lines. The overview
	// shows it verbatim, so a broker publishing counters this driver does not
	// know by name still has them on screen rather than silently dropped.
	AttrSysTopics = "sysTopics"
)

/*
 * A cluster page for a protocol with no cluster.
 *
 * MQTT says nothing about how a broker is deployed. What can be reported is
 * the one broker this session is talking to, out of the $SYS tree it publishes
 * about itself - so ListNodes returns exactly one node, and says so by
 * reporting a total of one rather than leaving the count unknown.
 *
 * A real cluster's other members are only visible through a vendor API, which
 * is the management tier's job and not this one's.
 */

// ListNodes is the cluster's members where the broker can name them, and
// otherwise the one broker this session is connected to.
func (c *Conn) ListNodes(ctx context.Context) ([]*model.Node, error) {
	if c.emqx != nil {
		return c.managedNodes(ctx)
	}
	node, err := c.brokerNode(ctx)
	if err != nil {
		return nil, err
	}
	return []*model.Node{node}, nil
}

// managedNodes reads the real cluster from the management API.
//
// This is the difference the tier makes: over the protocol alone a session
// knows about one broker, because a session is one socket. The API knows the
// other members exist.
func (c *Conn) managedNodes(ctx context.Context) ([]*model.Node, error) {
	nodes, err := c.emqx.Nodes(ctx)
	if err != nil {
		return nil, err
	}

	converted := make([]*model.Node, 0, len(nodes))
	for i, node := range nodes {
		converted = append(converted, &model.Node{
			ID:      i + 1,
			Name:    node.Node,
			Address: node.Node,
			Version: node.Version,
			Status:  nodeStatusOf(node.Status),
			// EMQX reports running totals rather than rates. A rate derived
			// from two polls here would be this app's arithmetic shown as the
			// broker's figure.
			RateIn:    model.UnknownMetric,
			RateOut:   model.UnknownMetric,
			DiskUsage: model.UnknownMetric,
			LastSeen:  timestamp.Now(),
			Attributes: map[string]string{
				AttrNodeRole:        node.Role,
				AttrNodeEdition:     node.Edition,
				AttrNodeConnections: strconv.FormatInt(node.Connections, 10),
				AttrNodeLive:        strconv.FormatInt(node.LiveConnections, 10),
				AttrNodeSessions:    strconv.FormatInt(node.Sessions, 10),
				AttrMemoryUsed:      node.MemoryUsed,
				AttrMemoryTotal:     node.MemoryTotal,
				AttrLoad1:           strconv.FormatFloat(node.Load1, 'f', 2, 64),
				AttrLoad5:           strconv.FormatFloat(node.Load5, 'f', 2, 64),
				AttrLoad15:          strconv.FormatFloat(node.Load15, 'f', 2, 64),
				AttrOTPRelease:      node.OTPRelease,
				// EMQX counts uptime in milliseconds; the boards read seconds,
				// which is what $SYS reports on the other path.
				AttrUptimeSeconds: strconv.FormatInt(node.Uptime/1000, 10),
			},
		})
	}
	return converted, nil
}

// nodeStatusOf maps EMQX's own word onto the canonical one. Anything that is
// not "running" is reported as offline rather than guessed at: a node in an
// unknown state is not a healthy one.
func nodeStatusOf(status string) model.NodeStatus {
	if status == "running" {
		return model.NodeOnline
	}
	return model.NodeOffline
}

// NodeDetail is one named node. The address is checked rather than ignored so
// a stale link from another page fails visibly instead of silently answering
// about a different node.
func (c *Conn) NodeDetail(ctx context.Context, address string) (*model.Node, error) {
	nodes, err := c.ListNodes(ctx)
	if err != nil {
		return nil, err
	}
	if address == "" && len(nodes) == 1 {
		return nodes[0], nil
	}
	for _, node := range nodes {
		if node.Address == address {
			return node, nil
		}
	}
	return nil, fmt.Errorf("this connection has no node at %q", address)
}

// ClusterOverview is the header figures the overview board reads.
func (c *Conn) ClusterOverview(ctx context.Context) (*model.ClusterOverview, error) {
	if c.emqx != nil {
		return c.managedOverview(ctx)
	}

	tree, err := c.readSys(ctx)
	if err != nil {
		return nil, err
	}

	overview := &model.ClusterOverview{
		Name:        c.brokerAddress(),
		TotalNodes:  1,
		OnlineNodes: 1,
		// A topic is not an object here, so there is no count of them. The
		// retained total is a different figure and is carried as its own
		// attribute rather than passed off as this one.
		Destinations:  model.UnknownMetric,
		Subscriptions: intMetric(tree.number(sysSubscriptions)),
		// No broker reports disk through $SYS, and MQTT stores almost nothing
		// anyway.
		AvgDiskUsage: model.UnknownMetric,
		Attributes:   sysAttributes(tree),
	}
	return overview, nil
}

// managedOverview is the same header read from the management API, where the
// figures are complete rather than whatever the broker chose to publish.
func (c *Conn) managedOverview(ctx context.Context) (*model.ClusterOverview, error) {
	nodes, err := c.emqx.Nodes(ctx)
	if err != nil {
		return nil, err
	}
	stats, err := c.emqx.Stats(ctx)
	if err != nil {
		return nil, err
	}
	metrics, err := c.emqx.Metrics(ctx)
	if err != nil {
		return nil, err
	}

	online := 0
	for _, node := range nodes {
		if nodeStatusOf(node.Status) == model.NodeOnline {
			online++
		}
	}

	// Every figure is per node and the header is cluster-wide, so they are
	// summed. A single-node broker is the same arithmetic over one row.
	var topics, subscriptions, connections, retained, shared int64
	for _, stat := range stats {
		topics += stat.TopicsCount
		subscriptions += stat.SubscriptionsCount
		connections += stat.ConnectionsCount
		retained += stat.RetainedCount
		shared += stat.SubscriptionsShared
	}
	var received, sent, dropped, bytesIn, bytesOut int64
	for _, metric := range metrics {
		received += metric.MessagesReceived
		sent += metric.MessagesSent
		dropped += metric.MessagesDropped
		bytesIn += metric.BytesReceived
		bytesOut += metric.BytesSent
	}

	return &model.ClusterOverview{
		Name:        c.emqx.Endpoint(),
		TotalNodes:  len(nodes),
		OnlineNodes: online,
		// EMQX does count topics, which the protocol cannot. This is the one
		// figure the management tier can give that no amount of subscribing
		// would produce.
		Destinations:  int(topics),
		Subscriptions: int(subscriptions),
		AvgDiskUsage:  model.UnknownMetric,
		Attributes: map[string]string{
			AttrClientsConnected:    strconv.FormatInt(connections, 10),
			AttrRetainedCount:       strconv.FormatInt(retained, 10),
			AttrSharedSubscriptions: strconv.FormatInt(shared, 10),
			AttrMessagesReceived:    strconv.FormatInt(received, 10),
			AttrMessagesSent:        strconv.FormatInt(sent, 10),
			AttrMessagesDropped:     strconv.FormatInt(dropped, 10),
			AttrBytesReceived:       strconv.FormatInt(bytesIn, 10),
			AttrBytesSent:           strconv.FormatInt(bytesOut, 10),
			AttrBrokerVersion:       brokerVersionOf(nodes),
		},
	}, nil
}

func brokerVersionOf(nodes []emqx.Node) string {
	if len(nodes) == 0 {
		return ""
	}
	return nodes[0].Version
}

// brokerNode builds the single node from one $SYS read.
func (c *Conn) brokerNode(ctx context.Context) (*model.Node, error) {
	tree, err := c.readSys(ctx)
	if err != nil {
		return nil, err
	}

	node := &model.Node{
		ID:      1,
		Name:    c.brokerAddress(),
		Address: c.brokerAddress(),
		Version: tree.text(sysVersion),
		Status:  model.NodeOnline,
		// The load averages are per minute; the page shows per second.
		RateIn:  perSecond(tree.number(sysLoadIn1min)),
		RateOut: perSecond(tree.number(sysLoadOut1min)),
		// MQTT brokers hold retained messages and little else, and none of
		// them publish a disk figure.
		DiskUsage:  model.UnknownMetric,
		LastSeen:   timestamp.Now(),
		Attributes: sysAttributes(tree),
	}
	return node, nil
}

// brokerAddress names the endpoint this session is on. There is one, because a
// session is one socket: the profile's other addresses are failover candidates
// rather than nodes of a cluster.
func (c *Conn) brokerAddress() string {
	if len(c.config.Servers) == 0 {
		return ""
	}
	return c.config.Servers[0].Host
}

// sysAttributes maps the tree onto the keys the boards read, and carries the
// whole tree alongside them.
func sysAttributes(tree *sysTree) map[string]string {
	attributes := map[string]string{
		AttrSysTopics: sysTopicLines(tree),
	}
	if version := tree.text(sysVersion); version != "" {
		attributes[AttrBrokerVersion] = version
	}

	counters := map[string]string{
		AttrClientsConnected:    sysClientsConnected,
		AttrClientsTotal:        sysClientsTotal,
		AttrClientsMaximum:      sysClientsMaximum,
		AttrClientsInactive:     sysClientsInactive,
		AttrClientsExpired:      sysClientsExpired,
		AttrSubscriptions:       sysSubscriptions,
		AttrSharedSubscriptions: sysSharedSubscriptions,
		AttrRetainedCount:       sysRetained,
		AttrMessagesReceived:    sysMessagesReceived,
		AttrMessagesSent:        sysMessagesSent,
		AttrMessagesStored:      sysMessagesStored,
		AttrMessagesDropped:     sysMessagesDropped,
		AttrBytesReceived:       sysBytesReceived,
		AttrBytesSent:           sysBytesSent,
		AttrHeapCurrent:         sysHeapCurrent,
	}
	for attribute, key := range counters {
		// A counter the broker does not publish is left out entirely rather
		// than written as -1: the boards read a missing attribute as "not
		// reported", and a -1 on screen is worse than a blank.
		if value := tree.number(key); value != unknown {
			attributes[attribute] = strconv.FormatInt(value, 10)
		}
	}
	if uptime := tree.uptimeSeconds(); uptime != unknown {
		attributes[AttrUptimeSeconds] = strconv.FormatInt(uptime, 10)
	}
	return attributes
}

// sysTopicLines renders the whole tree for the overview's own table, sorted so
// two reads of an unchanged broker look the same.
func sysTopicLines(tree *sysTree) string {
	topics := make([]string, 0, len(tree.Values))
	for topic := range tree.Values {
		topics = append(topics, topic)
	}
	sort.Strings(topics)

	var lines strings.Builder
	for _, topic := range topics {
		lines.WriteString(topic)
		lines.WriteByte('\t')
		lines.WriteString(tree.Values[topic])
		lines.WriteByte('\n')
	}
	return lines.String()
}

// perSecond turns a per-minute load average into the per-second rate the
// canonical node field carries.
func perSecond(perMinute int64) int {
	if perMinute == unknown {
		return model.UnknownMetric
	}
	return int(perMinute / 60)
}

func intMetric(value int64) int {
	if value == unknown {
		return model.UnknownMetric
	}
	return int(value)
}
