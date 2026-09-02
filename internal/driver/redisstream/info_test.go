package redisstream

import (
	"testing"

	"github.com/amigoer/mq-studio/internal/model"
)

// A real INFO reply, trimmed to the sections the pages read. The in-process
// server answers with connected_clients and nothing else, so every figure on
// the node and overview boards is covered here or not at all.
const liveInfoReply = "# Server\r\n" +
	"redis_version:8.10.1\r\n" +
	"redis_mode:standalone\r\n" +
	"os:Linux 6.10.14-linuxkit aarch64\r\n" +
	"uptime_in_seconds:8294400\r\n" +
	"\r\n" +
	"# Clients\r\n" +
	"connected_clients:86\r\n" +
	"blocked_clients:2\r\n" +
	"\r\n" +
	"# Memory\r\n" +
	"used_memory:432013312\r\n" +
	"used_memory_human:412.00M\r\n" +
	"maxmemory:2147483648\r\n" +
	"mem_fragmentation_ratio:1.12\r\n" +
	"\r\n" +
	"# Persistence\r\n" +
	"rdb_changes_since_last_save:1204\r\n" +
	"rdb_last_save_time:1756454000\r\n" +
	"rdb_last_bgsave_status:ok\r\n" +
	"aof_enabled:1\r\n" +
	"aof_last_bgrewrite_status:ok\r\n" +
	"\r\n" +
	"# Stats\r\n" +
	"instantaneous_ops_per_sec:3420\r\n" +
	"keyspace_hits:9920000\r\n" +
	"keyspace_misses:80000\r\n" +
	"\r\n" +
	"# Replication\r\n" +
	"role:master\r\n" +
	"connected_slaves:2\r\n" +
	"slave0:ip=10.2.0.9,port=6379,state=online,offset=884210,lag=0\r\n" +
	"slave1:ip=10.2.0.10,port=6379,state=sync,offset=880000,lag=1\r\n" +
	"master_repl_offset:884400\r\n" +
	"\r\n" +
	"# Cluster\r\n" +
	"cluster_enabled:0\r\n"

func TestParseInfo(t *testing.T) {
	info := parseInfo(liveInfoReply)

	if got := info.get("redis_version"); got != "8.10.1" {
		t.Errorf("version = %q", got)
	}
	// Read by key rather than by section: which section a field lives in has
	// moved between releases, and a reader that pinned one would report a
	// figure as missing on the version that moved it.
	if got := info.get("connected_clients"); got != "86" {
		t.Errorf("connected clients = %q", got)
	}
	if got := info.get("instantaneous_ops_per_sec"); got != "3420" {
		t.Errorf("ops = %q", got)
	}

	used, ok := info.number("used_memory")
	if !ok || used != 432013312 {
		t.Errorf("used memory = %d (%v)", used, ok)
	}
	ratio, ok := info.float("mem_fragmentation_ratio")
	if !ok || ratio != 1.12 {
		t.Errorf("fragmentation = %v (%v)", ratio, ok)
	}
}

/*
 * A figure that is not there is absent, not zero.
 *
 * Every one of these is rendered as a number on a page, and a zero for
 * "maxmemory" reads as a server capped at nothing rather than one with no cap
 * at all.
 */
func TestParseInfoAbsentFields(t *testing.T) {
	info := parseInfo(liveInfoReply)

	if _, ok := info.number("nothing_reports_this"); ok {
		t.Error("an absent field was read as a number")
	}
	if _, ok := info.float("nothing_reports_this"); ok {
		t.Error("an absent field was read as a float")
	}
	// A field present but unreadable is absent too. "5.0M" is what several
	// human-readable variants look like, and parsing it as 5 would be worse
	// than not showing it.
	broken := parseInfo("# Memory\nused_memory:412.00M\n")
	if _, ok := broken.number("used_memory"); ok {
		t.Error("an unparseable field was read as a number")
	}
}

// A line before any header, and a line with no colon. Both appear in the wild -
// the first from proxies that prepend a banner - and neither is a reason to
// lose the rest of the document.
func TestParseInfoTolerantOfOddLines(t *testing.T) {
	info := parseInfo("stray:1\n# Server\nredis_version:7.4.0\nnot a field\n\n")
	if got := info.get("redis_version"); got != "7.4.0" {
		t.Errorf("version = %q, want the document still readable", got)
	}
	if got := info.get("stray"); got != "1" {
		t.Errorf("a field before the first header was dropped: %q", got)
	}
}

func TestNodeOf(t *testing.T) {
	node := nodeOf("10.2.0.8:6379", parseInfo(liveInfoReply))

	if node.Address != "10.2.0.8:6379" || node.Version != "8.10.1" {
		t.Errorf("address/version = %q/%q", node.Address, node.Version)
	}
	if node.Status != model.NodeOnline {
		t.Errorf("status = %q, want online", node.Status)
	}
	/*
	 * Redis counts commands, not messages, and reports memory, not disk.
	 * Putting the command rate under a message-rate heading or the memory
	 * percentage under a disk one would be a number in the wrong place, which
	 * is worse than no number.
	 */
	if node.RateIn != model.UnknownMetric || node.RateOut != model.UnknownMetric {
		t.Errorf("rates = %d/%d, want UnknownMetric", node.RateIn, node.RateOut)
	}
	if node.DiskUsage != model.UnknownMetric {
		t.Errorf("disk = %d, want UnknownMetric: redis reports memory, not disk", node.DiskUsage)
	}

	for key, want := range map[string]string{
		AttrRole:                "master",
		AttrMode:                "standalone",
		AttrConnectedClients:    "86",
		AttrUsedMemory:          "432013312",
		AttrMaxMemory:           "2147483648",
		AttrOpsPerSec:           "3420",
		AttrKeyspaceHits:        "9920000",
		AttrKeyspaceMisses:      "80000",
		AttrAOFEnabled:          "1",
		AttrConnectedReplica:    "2",
		AttrMemoryFragmentation: "1.12",
	} {
		if node.Attributes[key] != want {
			t.Errorf("attribute %s = %q, want %q", key, node.Attributes[key], want)
		}
	}
}

/*
 * A failed background save is the one thing in this document worth changing a
 * status over: the server is answering every request and its data is not being
 * written down, which no other figure on the page would show.
 */
func TestNodeOfWarnsOnAFailedSave(t *testing.T) {
	failed := parseInfo("# Persistence\nrdb_last_bgsave_status:err\n")
	if got := nodeOf("a:6379", failed).Status; got != model.NodeWarning {
		t.Errorf("status = %q after a failed snapshot, want warning", got)
	}

	rewrite := parseInfo("# Persistence\naof_last_bgrewrite_status:err\n")
	if got := nodeOf("a:6379", rewrite).Status; got != model.NodeWarning {
		t.Errorf("status = %q after a failed rewrite, want warning", got)
	}

	fine := parseInfo("# Persistence\nrdb_last_bgsave_status:ok\naof_last_bgrewrite_status:ok\n")
	if got := nodeOf("a:6379", fine).Status; got != model.NodeOnline {
		t.Errorf("status = %q, want online", got)
	}
}

func TestReplicasOf(t *testing.T) {
	replicas := replicasOf(parseInfo(liveInfoReply))
	if len(replicas) != 2 {
		t.Fatalf("read %d replicas, want 2", len(replicas))
	}

	// The lag is the difference between the master's offset and the replica's
	// acknowledged one. Redis reports both and neither is the lag.
	if replicas[0].Address != "10.2.0.9:6379" {
		t.Errorf("address = %q", replicas[0].Address)
	}
	if replicas[0].BehindBytes != 884400-884210 {
		t.Errorf("behind = %d, want the offset difference", replicas[0].BehindBytes)
	}
	if !replicas[0].InSync {
		t.Error("a replica in state=online was reported out of sync")
	}

	/*
	 * "sync" is a replica still loading a snapshot. Its offset gap may look
	 * small and it is not serving anything, so the state is the verdict rather
	 * than the number.
	 */
	if replicas[1].InSync {
		t.Error("a replica in state=sync was reported in sync")
	}
}

func TestReplicasOfEdgeCases(t *testing.T) {
	// No replicas at all: nil rather than an empty slice is fine, but nothing
	// invented.
	if got := replicasOf(parseInfo("# Replication\nrole:master\nconnected_slaves:0\n")); len(got) != 0 {
		t.Errorf("read %d replicas from a master with none", len(got))
	}

	// A replica whose offset cannot be read is not a replica that is caught
	// up. Reporting zero would put "in sync, 0 behind" next to something
	// nobody measured.
	unreadable := parseInfo("# Replication\nconnected_slaves:1\n" +
		"slave0:ip=10.2.0.9,port=6379,state=online,offset=nonsense\n" +
		"master_repl_offset:100\n")
	got := replicasOf(unreadable)
	if len(got) != 1 {
		t.Fatalf("read %d replicas", len(got))
	}
	if got[0].BehindBytes != model.UnknownMetric {
		t.Errorf("behind = %d, want UnknownMetric when the offset is unreadable", got[0].BehindBytes)
	}

	// Mid-failover a replica can report an offset ahead of the master. It is
	// not behind, and a negative number on the page would be nonsense.
	ahead := parseInfo("# Replication\nconnected_slaves:1\n" +
		"slave0:ip=10.2.0.9,port=6379,state=online,offset=200\n" +
		"master_repl_offset:100\n")
	if got := replicasOf(ahead); got[0].BehindBytes != 0 {
		t.Errorf("behind = %d for a replica ahead of the master, want 0", got[0].BehindBytes)
	}
}

/*
 * CLUSTER NODES, which is the only source for what a cluster is made of.
 *
 * Both failure flags matter and they are not the same: "fail?" is one node's
 * suspicion and "fail" is the cluster having agreed. A page that read only the
 * second would show a node as healthy for as long as the cluster took to make
 * up its mind, which is exactly the window an operator is looking at it in.
 */
func TestParseClusterNodes(t *testing.T) {
	raw := "5ed2bf68 127.0.0.1:6502@16502 master - 0 1788289353295 3 connected 10923-16383\n" +
		"36a81646 127.0.0.1:6505@16505 slave 5095266f 0 1788289352276 1 connected\n" +
		"728d580b 127.0.0.1:6503@16503 slave,fail? fefa1f29 0 1788289353501 2 connected\n" +
		"5095266f 127.0.0.1:6500@16500 myself,master - 0 0 1 connected 0-5460\n" +
		"deadbeef 127.0.0.1:6501@16501 master,fail - 0 0 2 disconnected\n" +
		"\n"

	rows := parseClusterNodes(raw)
	if len(rows) != 5 {
		t.Fatalf("read %d rows, want 5", len(rows))
	}

	// The bus port after the @ is not something to connect to.
	if rows[0].Address != "127.0.0.1:6502" {
		t.Errorf("address = %q, want the bus port stripped", rows[0].Address)
	}
	if rows[0].Role != "master" || rows[0].Slots != "10923-16383" {
		t.Errorf("row = %+v", rows[0])
	}
	if rows[1].Role != "replica" {
		t.Errorf("a slave row read as %q", rows[1].Role)
	}
	// "myself" sits alongside the real role and must not hide it.
	if rows[3].Role != "master" {
		t.Errorf("the node we are connected to read as %q", rows[3].Role)
	}

	if !rows[2].Failing {
		t.Error("a node flagged fail? was not reported as failing")
	}
	if !rows[4].Failing {
		t.Error("a node flagged fail was not reported as failing")
	}
	if rows[0].Failing || rows[1].Failing {
		t.Error("a healthy node was reported as failing")
	}
}

func TestParseClusterNodesIgnoresShortLines(t *testing.T) {
	// A truncated read must not produce a node with no address that the page
	// would then try to connect to.
	rows := parseClusterNodes("5ed2bf68 127.0.0.1:6502@16502 master\n\n   \n")
	if len(rows) != 0 {
		t.Errorf("read %d rows from a truncated reply", len(rows))
	}
}
