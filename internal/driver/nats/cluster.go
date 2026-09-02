package nats

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/timestamp"
)

// Attribute keys a server carries beyond the canonical fields.
const (
	AttrServerID      = "serverId"
	AttrGoVersion     = "goVersion"
	AttrUptime        = "uptime"
	AttrConnections   = "connections"
	AttrTotalConns    = "totalConnections"
	AttrSubscriptions = "subscriptions"
	AttrRoutes        = "routes"
	AttrRemotes       = "remotes"
	AttrLeafNodes     = "leafNodes"
	AttrSlowConsumers = "slowConsumers"
	AttrMemoryBytes   = "memoryBytes"
	AttrCores         = "cores"
	AttrCPUPercent    = "cpuPercent"
	AttrMaxPayload    = "maxPayload"
	AttrMaxConns      = "maxConnections"
	AttrAuthRequired  = "authRequired"
	AttrTLSRequired   = "tlsRequired"
	AttrJetStreamHere = "jetstreamEnabled"
	AttrJSMemory      = "jetstreamMemory"
	AttrJSStorage     = "jetstreamStorage"
	AttrMetaLeader    = "metaLeader"
	AttrIsMetaLeader  = "isMetaLeader"
	AttrSource        = "readVia"
)

// The two ways a server's figures can be read, recorded on every row so the
// page can say where a number came from. They differ in reach rather than in
// content: $SYS answers for the whole cluster, monitoring for one server.
const (
	SourceSystem  = "system"
	SourceMonitor = "monitor"
)

// requireClusterSource is a connection with neither of the two tiers that can
// answer for a server.
func (c *Conn) requireClusterSource() error {
	if c.system != nil || c.monitor != nil {
		return nil
	}
	// The system account's reason, not the monitoring endpoint's: that is the
	// one that would answer for the whole cluster, and telling somebody to
	// configure the lesser of the two first is the wrong order to fix it in.
	reason := c.tiers.systemReason
	if reason == "" {
		reason = systemAbsent
	}
	return &driverUnsupported{reason: reason}
}

// ListNodes enumerates the servers in the cluster.
//
// Through the system account where there is one, because that is the only way
// to ask the cluster rather than a server: $SYS.REQ.SERVER.PING fans out and
// each server answers for itself. The monitoring endpoint answers for the one
// server whose port the form named, so a three-server cluster reached that way
// reports a cluster of one - which is why a row records which source it came
// from and the page can say so.
func (c *Conn) ListNodes(ctx context.Context) ([]*model.Node, error) {
	if err := c.requireClusterSource(); err != nil {
		return nil, err
	}

	if c.system != nil {
		replies, err := c.system.ping(ctx, endpointVarz, 0)
		if err == nil && len(replies) > 0 {
			return nodesFromReplies(replies)
		}
		// Falling through rather than failing: the monitoring endpoint can
		// still answer for one server, and one row is better than none.
		if c.monitor == nil {
			return nil, err
		}
	}

	varz, err := c.monitor.varz(ctx)
	if err != nil {
		return nil, err
	}
	node := nodeFromVarz(varz, SourceMonitor)
	node.ID = 1
	return []*model.Node{node}, nil
}

// NodeDetail reads one server.
//
// The address is the server's name rather than a host and port, because that
// is what the listing above hands the page and what $SYS addresses a server
// by. A cluster reached through the monitoring endpoint has exactly one row,
// so any name but that server's is a request for a server this connection
// cannot reach - which is worth saying rather than answering with the wrong
// one.
func (c *Conn) NodeDetail(ctx context.Context, address string) (*model.Node, error) {
	nodes, err := c.ListNodes(ctx)
	if err != nil {
		return nil, err
	}
	for _, node := range nodes {
		if node.Name == address || node.Address == address {
			return node, nil
		}
	}
	return nil, fmt.Errorf("no server named %q answered", address)
}

// ClusterOverview is the whole cluster in one answer.
func (c *Conn) ClusterOverview(ctx context.Context) (*model.ClusterOverview, error) {
	nodes, err := c.ListNodes(ctx)
	if err != nil {
		return nil, err
	}

	overview := &model.ClusterOverview{
		TotalNodes: len(nodes),
		// Every server that answered is online by definition: a server that
		// did not answer the fan-out is not in the list at all, which is why
		// the two counts agree and the page should not read anything into it.
		OnlineNodes: len(nodes),
		// Neither is enumerable from here. Streams are per account and the
		// destinations page answers them; a zero would read as an empty
		// cluster.
		Destinations:  model.UnknownMetric,
		Subscriptions: model.UnknownMetric,
		// NATS reports no disk figure anywhere. JetStream reports what an
		// account is using against its limit, which is a different question
		// from how full the disk is.
		AvgDiskUsage: model.UnknownMetric,
		Attributes:   map[string]string{},
	}
	if len(nodes) > 0 {
		overview.Name = nodes[0].Cluster
		overview.Attributes[AttrSource] = nodes[0].Attributes[AttrSource]
		overview.Attributes[AttrMetaLeader] = nodes[0].Attributes[AttrMetaLeader]
	}

	// Sum what every server reported, which is the only cluster-wide figure
	// NATS has: there is no aggregate endpoint, only servers that each answer
	// for themselves.
	var connections, subscriptions, slow int64
	for _, node := range nodes {
		connections += int64(intAttr(node.Attributes, AttrConnections, 0))
		subscriptions += int64(intAttr(node.Attributes, AttrSubscriptions, 0))
		slow += int64(intAttr(node.Attributes, AttrSlowConsumers, 0))
	}
	overview.Attributes[AttrConnections] = strconv.FormatInt(connections, 10)
	overview.Attributes[AttrSubscriptions] = strconv.FormatInt(subscriptions, 10)
	overview.Attributes[AttrSlowConsumers] = strconv.FormatInt(slow, 10)
	return overview, nil
}

// NodeConfig reads what a server is actually running with.
//
// /varz is the effective configuration rather than the file: a server started
// with flags, or reloaded since, reports what is in force. That is the whole
// reason this page exists - the config file on disk is what somebody meant,
// and this is what happened.
func (c *Conn) NodeConfig(ctx context.Context, address string) (map[string]string, error) {
	if err := c.requireClusterSource(); err != nil {
		return nil, err
	}

	var document map[string]any
	if c.system != nil {
		replies, err := c.system.ping(ctx, endpointVarz, 0)
		if err == nil {
			for _, reply := range replies {
				if reply.Server.Name != address {
					continue
				}
				if err := json.Unmarshal(reply.Data, &document); err != nil {
					return nil, err
				}
				break
			}
		}
	}
	if document == nil {
		if c.monitor == nil {
			return nil, fmt.Errorf("no server named %q answered", address)
		}
		if err := c.monitor.get(ctx, pathVarz, nil, &document); err != nil {
			return nil, err
		}
	}
	return flatten("", document), nil
}

// DirectoryConfig is empty, and that is a fact rather than a gap.
//
// NATS servers find each other by gossip: there is no name server, no
// controller quorum, nothing with settings of its own to read. The port exists
// for the families that have one.
func (c *Conn) DirectoryConfig(ctx context.Context) (map[string]string, error) {
	return map[string]string{}, nil
}

// nodesFromReplies turns a $SYS fan-out into one row per server.
func nodesFromReplies(replies []systemReply) ([]*model.Node, error) {
	nodes := make([]*model.Node, 0, len(replies))
	for _, reply := range replies {
		var varz varzResponse
		if err := json.Unmarshal(reply.Data, &varz); err != nil {
			return nil, fmt.Errorf("$SYS answered something that is not a server: %w", err)
		}
		nodes = append(nodes, nodeFromVarz(&varz, SourceSystem))
	}
	sort.Slice(nodes, func(i, j int) bool { return nodes[i].Name < nodes[j].Name })
	for index, node := range nodes {
		node.ID = index + 1
	}
	return nodes, nil
}

// nodeFromVarz maps one server onto the canonical model.
func nodeFromVarz(varz *varzResponse, source string) *model.Node {
	node := &model.Node{
		Name:    varz.Name,
		Address: serverAddress(varz),
		Cluster: varz.Cluster.Name,
		Version: varz.Version,
		// A server that answered is up. There is no third state: NATS reports
		// nothing about servers that did not reply, so a row exists only for
		// one that did.
		Status: model.NodeOnline,
		// Rates are not reported. The counters are totals since the server
		// started; a per-second figure would be two samples divided by the
		// time between them, and the collector is what samples in this app.
		RateIn:  model.UnknownMetric,
		RateOut: model.UnknownMetric,
		// No disk figure exists anywhere in NATS - not a percentage, not a
		// free-space number. JetStream reports account usage against a limit,
		// which is a different question.
		DiskUsage:  model.UnknownMetric,
		LastSeen:   timestamp.Now(),
		Attributes: map[string]string{},
	}

	set := func(key, value string) {
		if value != "" {
			node.Attributes[key] = value
		}
	}

	set(AttrSource, source)
	set(AttrServerID, varz.ID)
	set(AttrGoVersion, varz.Go)
	set(AttrUptime, varz.Uptime)
	set(AttrConnections, strconv.Itoa(varz.Connections))
	set(AttrTotalConns, strconv.FormatInt(varz.TotalConns, 10))
	set(AttrSubscriptions, strconv.FormatUint(uint64(varz.Subscriptions), 10))
	set(AttrRoutes, strconv.Itoa(varz.Routes))
	set(AttrRemotes, strconv.Itoa(varz.Remotes))
	set(AttrLeafNodes, strconv.Itoa(varz.LeafNodes))
	set(AttrSlowConsumers, strconv.FormatInt(varz.SlowConsumers, 10))
	set(AttrMemoryBytes, strconv.FormatInt(varz.Mem, 10))
	set(AttrCores, strconv.Itoa(varz.Cores))
	set(AttrCPUPercent, strconv.FormatFloat(varz.CPU, 'f', -1, 64))
	set(AttrMaxPayload, strconv.FormatInt(varz.MaxPayload, 10))
	set(AttrMaxConns, strconv.Itoa(varz.MaxConn))
	set(AttrAuthRequired, strconv.FormatBool(varz.AuthRequired))
	set(AttrTLSRequired, strconv.FormatBool(varz.TLSRequired))

	// JetStream is absent on a server built without it, and an empty struct
	// and a missing one would otherwise be the same thing on the page.
	set(AttrJetStreamHere, strconv.FormatBool(varz.JetStream != nil))
	if varz.JetStream != nil {
		if stats := varz.JetStream.Stats; stats != nil {
			set(AttrJSMemory, strconv.FormatInt(stats.Memory, 10))
			set(AttrJSStorage, strconv.FormatInt(stats.Store, 10))
		}
		if meta := varz.JetStream.Meta; meta != nil {
			set(AttrMetaLeader, meta.Leader)
			set(AttrIsMetaLeader, strconv.FormatBool(meta.Leader == varz.Name))
		}
	}
	return node
}

// serverAddress is where a client would reach this server.
//
// The advertised client URL where there is one, because that is the address
// that works from outside: the host a server reports for itself is often the
// one it bound to, which on a container is not reachable from anywhere.
func serverAddress(varz *varzResponse) string {
	for _, advertised := range varz.ConnectURLs {
		if advertised != "" {
			return advertised
		}
	}
	if varz.Host == "" {
		return ""
	}
	return fmt.Sprintf("%s:%d", varz.Host, varz.Port)
}

// flatten turns the settings document into the flat map the page renders.
//
// Nested rather than flat is how the server reports it - cluster, jetstream
// and tls are each their own object - and the config page shows a list of
// keys. Joining them with a dot keeps the structure readable in the key rather
// than losing it.
func flatten(prefix string, document map[string]any) map[string]string {
	flat := make(map[string]string, len(document))
	for key, value := range document {
		name := key
		if prefix != "" {
			name = prefix + "." + key
		}
		switch typed := value.(type) {
		case map[string]any:
			// An empty object carries nothing and would otherwise vanish
			// without trace, which reads as a setting that is not there rather
			// than one that is empty.
			if len(typed) == 0 {
				flat[name] = "{}"
				continue
			}
			for nested, nestedValue := range flatten(name, typed) {
				flat[nested] = nestedValue
			}
		case []any:
			parts := make([]string, 0, len(typed))
			for _, item := range typed {
				parts = append(parts, fmt.Sprint(item))
			}
			flat[name] = strings.Join(parts, ", ")
		case float64:
			// Every JSON number decodes as a float, and a port rendered as
			// "4222.000000" is worse than useless.
			flat[name] = strconv.FormatFloat(typed, 'f', -1, 64)
		case nil:
			flat[name] = ""
		default:
			flat[name] = fmt.Sprint(typed)
		}
	}
	return flat
}
