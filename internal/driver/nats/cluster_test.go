package nats

import (
	"strings"
	"testing"

	"github.com/amigoer/mq-studio/internal/model"
)

// monitorConn opens a connection with the monitoring endpoint but no system
// account - the single-server case.
func monitorConn(t *testing.T) *Conn {
	t.Helper()
	fake := startServer(t, serverOptions{jetStream: true, jetStreamAccount: true, monitor: true})
	return open(t, fake, true, false)
}

// systemConn opens a connection with the system account as well.
func systemConn(t *testing.T) *Conn {
	t.Helper()
	fake := startServer(t, serverOptions{
		jetStream: true, jetStreamAccount: true, monitor: true, systemAccount: true,
	})
	return open(t, fake, true, true)
}

func TestAServerIsListedWithWhatItReportsAboutItself(t *testing.T) {
	conn := monitorConn(t)

	nodes, err := conn.ListNodes(testContext(t))
	if err != nil {
		t.Fatalf("ListNodes: %v", err)
	}
	if len(nodes) != 1 {
		t.Fatalf("listed %d servers, want 1", len(nodes))
	}

	node := nodes[0]
	if node.Name == "" || node.Version == "" {
		t.Errorf("server = %q version %q, want both reported", node.Name, node.Version)
	}
	if node.Status != model.NodeOnline {
		t.Errorf("status = %q, want online - a server that answered is up", node.Status)
	}
	// None of these exist in NATS, and a zero would be an invented figure
	// beside real ones.
	if node.RateIn != model.UnknownMetric || node.RateOut != model.UnknownMetric {
		t.Errorf("rates = %d/%d, want UnknownMetric", node.RateIn, node.RateOut)
	}
	if node.DiskUsage != model.UnknownMetric {
		t.Errorf("disk = %d, want UnknownMetric - NATS reports no disk figure at all", node.DiskUsage)
	}
}

/*
 * Where a row came from is recorded on it, because the two sources differ in
 * reach rather than in content: the monitoring endpoint answers for the one
 * server whose port the form named, and $SYS answers for the cluster. A page
 * that could not tell them apart would show a cluster of one and call it the
 * cluster.
 */
func TestARowSaysWhichSourceAnsweredIt(t *testing.T) {
	monitored, err := monitorConn(t).ListNodes(testContext(t))
	if err != nil {
		t.Fatalf("ListNodes: %v", err)
	}
	if got := monitored[0].Attributes[AttrSource]; got != SourceMonitor {
		t.Errorf("source = %q, want %q", got, SourceMonitor)
	}

	fanned, err := systemConn(t).ListNodes(testContext(t))
	if err != nil {
		t.Fatalf("ListNodes: %v", err)
	}
	if got := fanned[0].Attributes[AttrSource]; got != SourceSystem {
		t.Errorf("source = %q, want %q", got, SourceSystem)
	}
}

// The system account is preferred where both answer, because it is the one
// that reaches more than one server.
func TestTheSystemAccountIsPreferredOverTheMonitoringEndpoint(t *testing.T) {
	conn := systemConn(t)
	nodes, err := conn.ListNodes(testContext(t))
	if err != nil {
		t.Fatalf("ListNodes: %v", err)
	}
	if nodes[0].Attributes[AttrSource] != SourceSystem {
		t.Error("the monitoring endpoint answered while a system account was available")
	}
}

func TestTheOverviewSumsWhatEveryServerReported(t *testing.T) {
	conn := systemConn(t)
	overview, err := conn.ClusterOverview(testContext(t))
	if err != nil {
		t.Fatalf("ClusterOverview: %v", err)
	}
	if overview.TotalNodes != 1 {
		t.Errorf("total nodes = %d, want 1", overview.TotalNodes)
	}
	// Every server in the list answered, so the two counts agree by
	// construction - a server that did not answer has no row at all.
	if overview.OnlineNodes != overview.TotalNodes {
		t.Errorf("online = %d of %d; a listed server is one that answered",
			overview.OnlineNodes, overview.TotalNodes)
	}
	// Not zero: streams are per account, and the destinations page answers
	// them. A zero here would read as an empty cluster.
	if overview.Destinations != model.UnknownMetric {
		t.Errorf("destinations = %d, want UnknownMetric", overview.Destinations)
	}
	if overview.AvgDiskUsage != model.UnknownMetric {
		t.Errorf("disk = %d, want UnknownMetric", overview.AvgDiskUsage)
	}
	if _, ok := overview.Attributes[AttrConnections]; !ok {
		t.Error("the overview reports no connection total")
	}
}

func TestNodeDetailNamesAServerThatDidNotAnswer(t *testing.T) {
	conn := monitorConn(t)
	_, err := conn.NodeDetail(testContext(t), "some-other-server")
	if err == nil {
		t.Fatal("reading a server this connection cannot reach succeeded")
	}
	if !strings.Contains(err.Error(), "some-other-server") {
		t.Errorf("error %q does not name the server", err)
	}
}

/*
 * The effective configuration, not the file. A server started with flags or
 * reloaded since reports what is in force, and that is the whole reason the
 * page exists: the file on disk is what somebody meant.
 */
func TestNodeConfigReadsWhatTheServerIsRunningWith(t *testing.T) {
	conn := monitorConn(t)
	nodes, err := conn.ListNodes(testContext(t))
	if err != nil {
		t.Fatalf("ListNodes: %v", err)
	}

	config, err := conn.NodeConfig(testContext(t), nodes[0].Name)
	if err != nil {
		t.Fatalf("NodeConfig: %v", err)
	}
	if config["server_name"] != nodes[0].Name {
		t.Errorf("server_name = %q, want %q", config["server_name"], nodes[0].Name)
	}
	// Nested objects keep their structure in the key rather than losing it.
	if _, ok := config["cluster.name"]; !ok {
		if _, empty := config["cluster"]; !empty {
			t.Errorf("the cluster block is neither flattened nor marked empty: %v", config["cluster"])
		}
	}
	// A port rendered as "4222.000000" is worse than useless.
	if port, ok := config["port"]; ok && strings.Contains(port, ".") {
		t.Errorf("port = %q, want a whole number", port)
	}
}

// NATS servers find each other by gossip, so there is no discovery tier with
// settings of its own - an empty map rather than an error.
func TestThereIsNoDiscoveryTierToConfigure(t *testing.T) {
	config, err := monitorConn(t).DirectoryConfig(testContext(t))
	if err != nil {
		t.Fatalf("DirectoryConfig: %v", err)
	}
	if len(config) != 0 {
		t.Errorf("DirectoryConfig returned %d settings; NATS has no discovery tier", len(config))
	}
}

/*
 * With neither tier the cluster pages cannot be answered, and the reason has
 * to be the system account's: that is the one that would answer for the whole
 * cluster, and sending somebody to configure the lesser of the two first is
 * the wrong order to fix it in.
 */
func TestClusterCallsWithNoSourceSayWhichToConfigure(t *testing.T) {
	conn := open(t, startServer(t, serverOptions{jetStream: true, jetStreamAccount: true}), false, false)
	ctx := testContext(t)

	calls := map[string]func() error{
		"list":     func() error { _, err := conn.ListNodes(ctx); return err },
		"detail":   func() error { _, err := conn.NodeDetail(ctx, "x"); return err },
		"overview": func() error { _, err := conn.ClusterOverview(ctx); return err },
		"config":   func() error { _, err := conn.NodeConfig(ctx, "x"); return err },
	}
	for name, call := range calls {
		t.Run(name, func(t *testing.T) {
			err := call()
			if err == nil {
				t.Fatal("succeeded with neither a monitoring endpoint nor a system account")
			}
			if err.Error() != systemAbsent {
				t.Errorf("error = %q, want %q", err, systemAbsent)
			}
		})
	}
}

// The three cluster capabilities go together, because they are answered by the
// same two tiers - and they degrade rather than vanish, so the page explains
// itself instead of disappearing.
func TestClusterCapabilitiesDegradeWhenNeitherTierAnswers(t *testing.T) {
	conn := open(t, startServer(t, serverOptions{jetStream: true, jetStreamAccount: true}), false, false)
	capabilities := conn.Capabilities()

	for _, capability := range clusterCapabilities {
		if capabilities.Has(capability) {
			t.Errorf("%s is supported with no source to answer it", capability)
		}
		reason, degraded := capabilities.DegradedReason(capability)
		if !degraded {
			t.Errorf("%s is absent rather than degraded; the page would vanish", capability)
		}
		if reason != systemAbsent {
			t.Errorf("%s degraded with %q, want %q", capability, reason, systemAbsent)
		}
	}
}

// One tier is enough. A monitoring endpoint alone answers for one server, and
// one row is a great deal better than a page that will not open.
func TestTheMonitoringEndpointAloneKeepsTheClusterPages(t *testing.T) {
	conn := monitorConn(t)
	for _, capability := range clusterCapabilities {
		if !conn.Capabilities().Has(capability) {
			t.Errorf("%s is missing with a monitoring endpoint available", capability)
		}
	}
}
