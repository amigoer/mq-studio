package redisstream

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/redis/go-redis/v9"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/timestamp"
)

// Node attribute keys. A contract with frontend/src/mq/redis/nodes.ts.
const (
	AttrRole                = "role"
	AttrMode                = "mode"
	AttrUptimeSeconds       = "uptimeSeconds"
	AttrConnectedClients    = "connectedClients"
	AttrUsedMemory          = "usedMemory"
	AttrMaxMemory           = "maxMemory"
	AttrMemoryFragmentation = "memoryFragmentation"
	AttrOpsPerSec           = "opsPerSec"
	AttrKeyspaceHits        = "keyspaceHits"
	AttrKeyspaceMisses      = "keyspaceMisses"
	AttrAOFEnabled          = "aofEnabled"
	AttrRDBLastSave         = "rdbLastSaveTime"
	AttrRDBLastStatus       = "rdbLastBgsaveStatus"
	AttrRDBChangesSince     = "rdbChangesSinceLastSave"
	AttrAOFLastStatus       = "aofLastRewriteStatus"
	AttrConnectedReplica    = "connectedReplicas"
	AttrClusterEnabled      = "clusterEnabled"
	AttrClusterSlots        = "clusterSlots"
	AttrClusterState        = "clusterState"
	AttrNodeID              = "nodeId"
)

// ListNodes reports the servers behind this connection.
//
// A standalone or sentinel connection is one server, and saying so is not a
// simplification: the replicas it reports are followers of that server rather
// than peers, and the pages that matter - what is in memory, what has been
// slow - are all about the one being talked to.
//
// A cluster is every master and replica, read from CLUSTER NODES. Each row is
// filled in from that node's own INFO, in parallel, because a node that is
// down is exactly what the page is opened to find and a serial walk would
// wait for each timeout in turn.
func (c *Conn) ListNodes(ctx context.Context) ([]*model.Node, error) {
	cluster, ok := c.client.(*redis.ClusterClient)
	if !ok {
		node, err := c.localNode(ctx)
		if err != nil {
			return nil, err
		}
		node.ID = 1
		return []*model.Node{node}, nil
	}

	raw, err := cluster.ClusterNodes(ctx).Result()
	if err != nil {
		return nil, fmt.Errorf("read the cluster topology: %w", err)
	}
	rows := parseClusterNodes(raw)

	nodes := make([]*model.Node, len(rows))
	var wait sync.WaitGroup
	for index, row := range rows {
		wait.Add(1)
		go func() {
			defer wait.Done()
			nodes[index] = c.clusterNode(ctx, row)
		}()
	}
	wait.Wait()

	sort.Slice(nodes, func(left, right int) bool { return nodes[left].Address < nodes[right].Address })
	for index, node := range nodes {
		node.ID = index + 1
	}
	return nodes, nil
}

// NodeDetail describes one server, with its replicas.
//
// The replicas cost a request of their own and only appear here, which is the
// same split every other family uses: a list should not pay for a per-node
// call it does not show.
func (c *Conn) NodeDetail(ctx context.Context, address string) (*model.Node, error) {
	client, release := c.clientFor(address)
	defer release()

	raw, err := client.Info(ctx).Result()
	if err != nil {
		return nil, fmt.Errorf("read the server info of %q: %w", address, err)
	}
	info := parseInfo(raw)
	node := nodeOf(address, info)
	node.ID = 1
	node.Replicas = replicasOf(info)
	return node, nil
}

// ClusterOverview is the header the whole page hangs under.
func (c *Conn) ClusterOverview(ctx context.Context) (*model.ClusterOverview, error) {
	nodes, err := c.ListNodes(ctx)
	if err != nil {
		return nil, err
	}

	overview := &model.ClusterOverview{
		Name:       "redis",
		TotalNodes: len(nodes),
		// No disk figure exists. Redis reports memory, not disk, and the two
		// are not interchangeable - a server with an empty dataset on a full
		// volume would read as healthy.
		AvgDiskUsage: model.UnknownMetric,
		// Counting streams and groups means scanning the keyspace, which the
		// header must not do on every refresh. The stream and group pages
		// count what they list, and say so.
		Destinations:  model.UnknownMetric,
		Subscriptions: model.UnknownMetric,
		Attributes:    map[string]string{},
	}
	for _, node := range nodes {
		if node.Status == model.NodeOnline {
			overview.OnlineNodes++
		}
	}

	// The one figure worth a call of its own: a cluster that has lost slots
	// cannot serve the keys in them, and nothing in the node list says so.
	if cluster, ok := c.client.(*redis.ClusterClient); ok {
		if raw, err := cluster.ClusterInfo(ctx).Result(); err == nil {
			state := parseInfo(raw)
			overview.Name = "redis-cluster"
			overview.Attributes[AttrClusterState] = state.get("cluster_state")
			overview.Attributes[AttrClusterSlots] = state.get("cluster_slots_assigned")
		}
	}
	return overview, nil
}

// localNode is the server this connection is talking to.
func (c *Conn) localNode(ctx context.Context) (*model.Node, error) {
	raw, err := c.client.Info(ctx).Result()
	if err != nil {
		return nil, fmt.Errorf("read the server info: %w", err)
	}
	address := ""
	if len(c.config.Addrs) > 0 {
		address = c.config.Addrs[0]
	}
	return nodeOf(address, parseInfo(raw)), nil
}

// clusterNode fills in one row of CLUSTER NODES from that node's own INFO.
//
// A node that does not answer stays in the list, marked offline. Dropping it
// would be the worst possible reading of an outage: the page would show a
// smaller, healthy-looking cluster.
func (c *Conn) clusterNode(ctx context.Context, row clusterRow) *model.Node {
	node := &model.Node{
		Name:       row.ID,
		Address:    row.Address,
		Cluster:    "redis-cluster",
		Status:     model.NodeOnline,
		RateIn:     model.UnknownMetric,
		RateOut:    model.UnknownMetric,
		DiskUsage:  model.UnknownMetric,
		Attributes: map[string]string{AttrNodeID: row.ID, AttrRole: row.Role},
	}
	if row.Failing {
		node.Status = model.NodeOffline
	}
	if row.Slots != "" {
		node.Attributes[AttrClusterSlots] = row.Slots
	}

	client, release := c.clientFor(row.Address)
	defer release()

	raw, err := client.Info(ctx).Result()
	if err != nil {
		// It is in the topology and it did not answer, which is exactly what
		// offline means here.
		node.Status = model.NodeOffline
		return node
	}
	info := parseInfo(raw)
	filled := nodeOf(row.Address, info)
	filled.Name = row.ID
	filled.Cluster = "redis-cluster"
	filled.Attributes[AttrNodeID] = row.ID
	// CLUSTER NODES is the authority on the role: INFO reports what the server
	// thinks it is, and during a failover the two disagree for a moment.
	filled.Attributes[AttrRole] = row.Role
	if row.Slots != "" {
		filled.Attributes[AttrClusterSlots] = row.Slots
	}
	if row.Failing {
		filled.Status = model.NodeOffline
	}
	return filled
}

// clientFor returns a client for one address, and a function to release it.
//
// The connection's own client is reused when the address is the one it was
// opened against, which is every call on a standalone or sentinel profile.
// Anything else - a replica being inspected, or a node of a cluster - gets a
// client of its own, built from the same profile so it carries the same
// credentials and TLS settings.
//
// A cluster client cannot be asked to run a command on a named node: it routes
// by key, and INFO has no key. Building one per node is what makes a per-node
// page possible at all.
func (c *Conn) clientFor(address string) (redis.UniversalClient, func()) {
	own := len(c.config.Addrs) > 0 && address == c.config.Addrs[0]
	_, clustered := c.client.(*redis.ClusterClient)
	if address == "" || (own && !clustered) {
		return c.client, func() {}
	}

	config := c.config
	config.Deployment = DeploymentStandalone
	config.Addrs = []string{address}
	client := newClient(config)
	return client, func() { _ = client.Close() }
}

// nodeOf turns one INFO document into the canonical shape.
func nodeOf(address string, info serverInfo) *model.Node {
	node := &model.Node{
		Name:    address,
		Address: address,
		Version: info.get("redis_version"),
		Status:  model.NodeOnline,
		// Redis counts commands, not messages. Reporting the command rate as a
		// message rate would put a number under the wrong heading; the figure
		// itself is on the node page, labelled ops.
		RateIn:  model.UnknownMetric,
		RateOut: model.UnknownMetric,
		// And it reports memory, not disk. A server with an empty dataset on a
		// full volume would read as healthy if the two were conflated.
		DiskUsage:  model.UnknownMetric,
		LastSeen:   timestamp.Now(),
		Attributes: map[string]string{},
	}
	if node.Name == "" {
		node.Name = "redis"
	}

	for attribute, key := range map[string]string{
		AttrRole:                "role",
		AttrMode:                "redis_mode",
		AttrUptimeSeconds:       "uptime_in_seconds",
		AttrConnectedClients:    "connected_clients",
		AttrUsedMemory:          "used_memory",
		AttrMaxMemory:           "maxmemory",
		AttrMemoryFragmentation: "mem_fragmentation_ratio",
		AttrOpsPerSec:           "instantaneous_ops_per_sec",
		AttrKeyspaceHits:        "keyspace_hits",
		AttrKeyspaceMisses:      "keyspace_misses",
		AttrAOFEnabled:          "aof_enabled",
		AttrRDBLastSave:         "rdb_last_save_time",
		AttrRDBLastStatus:       "rdb_last_bgsave_status",
		AttrRDBChangesSince:     "rdb_changes_since_last_save",
		AttrAOFLastStatus:       "aof_last_bgrewrite_status",
		AttrConnectedReplica:    "connected_slaves",
		AttrClusterEnabled:      "cluster_enabled",
	} {
		if value := info.get(key); value != "" {
			node.Attributes[attribute] = value
		}
	}

	// A last background save that failed is the one thing in this document
	// worth changing a status over: the server is answering and its data is
	// not being written down.
	if info.get("rdb_last_bgsave_status") == "err" || info.get("aof_last_bgrewrite_status") == "err" {
		node.Status = model.NodeWarning
	}
	return node
}

// replicasOf reads the followers out of the replication section.
func replicasOf(info serverInfo) []model.ReplicaStatus {
	masterOffset, masterKnown := info.number("master_repl_offset")
	count, ok := info.number("connected_slaves")
	if !ok || count == 0 {
		return nil
	}

	replicas := make([]model.ReplicaStatus, 0, count)
	for index := int64(0); index < count; index++ {
		line := info.get("slave" + strconv.FormatInt(index, 10))
		if line == "" {
			continue
		}
		address, behind, inSync, ok := replicaOf(line, masterOffset, masterKnown)
		if !ok {
			continue
		}
		replicas = append(replicas, model.ReplicaStatus{
			Address:     address,
			BehindBytes: behind,
			InSync:      inSync,
		})
	}
	return replicas
}

// clusterRow is one line of CLUSTER NODES.
type clusterRow struct {
	ID      string
	Address string
	Role    string
	Failing bool
	Slots   string
}

/*
 * parseClusterNodes reads the CLUSTER NODES reply.
 *
 * Each line is space separated: id, address, flags, master, ping-sent,
 * pong-recv, config-epoch, link-state, then any slots the node owns. The
 * address carries the cluster bus port after an @, which is not something to
 * connect to.
 *
 * The flags are what say whether a node is in trouble, and both forms matter:
 * "fail?" is one node's suspicion and "fail" is the cluster's agreement. A
 * page that only read the second would show a node as healthy for as long as
 * the cluster took to agree it was not.
 */
func parseClusterNodes(raw string) []clusterRow {
	rows := make([]clusterRow, 0, 8)
	for _, line := range strings.Split(raw, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 8 {
			continue
		}
		address, _, _ := strings.Cut(fields[1], "@")
		flags := strings.Split(fields[2], ",")

		row := clusterRow{ID: fields[0], Address: address, Role: "replica"}
		for _, flag := range flags {
			switch flag {
			case "master":
				row.Role = "master"
			case "slave", "replica":
				row.Role = "replica"
			case "fail", "fail?":
				row.Failing = true
			}
		}
		if len(fields) > 8 {
			row.Slots = strings.Join(fields[8:], " ")
		}
		rows = append(rows, row)
	}
	return rows
}
