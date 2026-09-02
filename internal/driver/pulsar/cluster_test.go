package pulsar

import (
	"context"
	"net/http"
	"testing"

	"github.com/apache/pulsar-client-go/pulsaradmin/pkg/utils"

	"github.com/amigoer/mq-studio/internal/model"
)

// clusterRoutes is a two-broker cluster whose load report describes only the
// first, which is what a real listing behind a load balancer looks like.
func clusterRoutes() map[string]string {
	routes := adminRoutes()
	routes["/admin/v2/clusters"] = `["standalone"]`
	routes["/admin/v2/clusters/standalone"] = `{"serviceUrl":"http://127.0.0.1:8080",` +
		`"brokerServiceUrl":"pulsar://127.0.0.1:6650"}`
	routes["/admin/v2/brokers/standalone"] = `["127.0.0.1:8080","broker-2:8080"]`
	routes["/admin/v2/brokers/leaderBroker"] = `{"brokerId":"127.0.0.1:8080",` +
		`"serviceUrl":"http://127.0.0.1:8080"}`
	routes["/admin/v2/brokers/internal-configuration"] = `{"zookeeperServers":"zk:2181"}`
	return routes
}

func clusterConn(t *testing.T) *Conn {
	t.Helper()
	cluster := newFakeCluster(t, clusterRoutes(), http.StatusNotFound)
	return probedConn(t, cluster.config())
}

/*
 * A broker the load report does not describe reports unknown, never zero.
 *
 * GetLoadReport answers for whichever broker served the request. Spreading its
 * rates across the listing would put one broker's traffic on every row; using
 * zero instead would draw a flat line on the cluster page for a broker that
 * may be carrying the whole cluster. Only "not reported" is true.
 */
func TestListNodesOnlyAttachesTheReportToTheBrokerItDescribes(t *testing.T) {
	nodes, err := clusterConn(t).ListNodes(context.Background())
	if err != nil {
		t.Fatalf("ListNodes: %v", err)
	}
	if len(nodes) != 2 {
		t.Fatalf("listed %d brokers, want 2", len(nodes))
	}

	described, other := nodes[0], nodes[1]
	if described.Address != "127.0.0.1:8080" {
		t.Fatalf("first broker = %q", described.Address)
	}
	if described.RateIn != 0 || described.RateOut != 0 {
		t.Errorf("the described broker reports %d/%d, want the report's 0/0",
			described.RateIn, described.RateOut)
	}
	if described.Version != "4.0.13" {
		t.Errorf("version = %q, want the report's", described.Version)
	}

	if other.RateIn != model.UnknownMetric || other.RateOut != model.UnknownMetric {
		t.Errorf("an undescribed broker reports %d/%d, want unknown",
			other.RateIn, other.RateOut)
	}
	if other.Version != "" {
		t.Errorf("an undescribed broker claims version %q", other.Version)
	}
	if _, has := other.Attributes[AttrNodeTopics]; has {
		t.Error("an undescribed broker carries the other one's topic count")
	}
}

// Pulsar brokers are peers with no master and slave, so leadership is the only
// role there is - and it belongs to exactly one of them.
func TestListNodesMarksOneLeader(t *testing.T) {
	nodes, err := clusterConn(t).ListNodes(context.Background())
	if err != nil {
		t.Fatalf("ListNodes: %v", err)
	}

	leaders := 0
	for _, node := range nodes {
		if node.Attributes[AttrNodeLeader] == "true" {
			leaders++
		}
	}
	if leaders != 1 {
		t.Errorf("%d brokers claim leadership, want 1", leaders)
	}
}

/*
 * Nothing the header cannot count is reported as zero.
 *
 * Topics and subscriptions need a walk of every namespace, and Pulsar's
 * brokers report no disk figure at all - the messages are BookKeeper's. A zero
 * in any of the three reads as "this cluster is empty" or "this disk is free",
 * both of which are statements nobody made.
 */
func TestClusterOverviewReportsWhatItCannotCountAsUnknown(t *testing.T) {
	overview, err := clusterConn(t).ClusterOverview(context.Background())
	if err != nil {
		t.Fatalf("ClusterOverview: %v", err)
	}

	if overview.Name != "standalone" {
		t.Errorf("name = %q, want standalone", overview.Name)
	}
	if overview.TotalNodes != 2 || overview.OnlineNodes != 2 {
		t.Errorf("nodes = %d/%d, want 2/2", overview.OnlineNodes, overview.TotalNodes)
	}
	for name, value := range map[string]int{
		"destinations":  overview.Destinations,
		"subscriptions": overview.Subscriptions,
		"avgDiskUsage":  overview.AvgDiskUsage,
	} {
		if value != model.UnknownMetric {
			t.Errorf("%s = %d, want unknown", name, value)
		}
	}
	if overview.Attributes[AttrClusterMetadataStore] != "zk:2181" {
		t.Errorf("metadata store = %q", overview.Attributes[AttrClusterMetadataStore])
	}
}

/*
 * A resource with no limit gives no percentage.
 *
 * Pulsar reports CPU scaled across every core, so the limit is 100 per core
 * and the raw usage means nothing without it: 300 is idle on a 16-core broker
 * and saturated on a 3-core one. Dividing by a missing limit would produce
 * either a panic or an invented number, and both reach the page as a figure
 * somebody will act on.
 */
func TestUsagePercentNeedsALimit(t *testing.T) {
	cases := []struct {
		name  string
		usage utils.ResourceUsage
		want  string
	}{
		{name: "a tenth of eight cores", usage: utils.ResourceUsage{Usage: 80, Limit: 800}, want: "10"},
		{name: "memory in megabytes", usage: utils.ResourceUsage{Usage: 192, Limit: 1024}, want: "18"},
		{name: "no limit reported", usage: utils.ResourceUsage{Usage: 300, Limit: 0}, want: ""},
		{name: "a negative limit is not a limit", usage: utils.ResourceUsage{Usage: 1, Limit: -1}, want: ""},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := usagePercent(test.usage); got != test.want {
				t.Errorf("usagePercent(%v) = %q, want %q", test.usage, got, test.want)
			}
		})
	}
}

/*
 * The same broker written two ways has to compare equal.
 *
 * The active-broker listing gives "broker:8080" and the load report gives
 * "http://broker:8080". Comparing them literally attaches the report to
 * nothing, and the cluster page silently loses every figure it has.
 */
func TestHostOfNormalisesTheFormsPulsarUses(t *testing.T) {
	cases := []struct {
		raw  string
		want string
	}{
		{raw: "broker:8080", want: "broker:8080"},
		{raw: "http://broker:8080", want: "broker:8080"},
		{raw: "https://broker:8443", want: "broker:8443"},
		{raw: "http://broker:8080/", want: "broker:8080"},
		{raw: "  broker:8080  ", want: "broker:8080"},
		{raw: "", want: ""},
	}

	for _, test := range cases {
		if got := hostOf(test.raw); got != test.want {
			t.Errorf("hostOf(%q) = %q, want %q", test.raw, got, test.want)
		}
	}
}

// NodeDetail is looked up by the address the listing gave, so it has to accept
// that form - a detail panel that cannot find the row it was opened from is a
// panel that never opens.
func TestNodeDetailFindsTheBrokerTheListingNamed(t *testing.T) {
	conn := clusterConn(t)

	node, err := conn.NodeDetail(context.Background(), "broker-2:8080")
	if err != nil {
		t.Fatalf("NodeDetail: %v", err)
	}
	if node.Address != "broker-2:8080" {
		t.Errorf("detail is for %q", node.Address)
	}

	if _, err := conn.NodeDetail(context.Background(), "broker-9:8080"); err == nil {
		t.Error("a detail was returned for a broker that is not in the cluster")
	}
}

/*
 * A load manager that publishes nothing must not become a panic.
 *
 * pulsaradmin's GetLoadReport returns (nil, nil) for every error it meets, so
 * an unreachable broker and a 204 from NoopLoadManager both arrive as a nil
 * pointer with no error. Anything that dereferences the result without
 * checking takes the whole cluster page down.
 */
func TestLoadReportIsNilRatherThanAPanicWhenTheClusterPublishesNone(t *testing.T) {
	routes := clusterRoutes()
	delete(routes, "/admin/v2/broker-stats/load-report")
	cluster := newFakeCluster(t, routes, http.StatusNoContent)
	conn := probedConn(t, cluster.config())

	if report := conn.loadReport(context.Background()); report != nil {
		t.Fatalf("a cluster publishing no report gave %#v", report)
	}
	nodes, err := conn.ListNodes(context.Background())
	if err != nil {
		t.Fatalf("ListNodes without a load report: %v", err)
	}
	for _, node := range nodes {
		if node.RateIn != model.UnknownMetric || node.RateOut != model.UnknownMetric {
			t.Errorf("%s reports rates with no load report behind them", node.Address)
		}
	}
}

// And the capability says so, rather than the page quietly drawing zeros.
func TestMetricsAreDegradedWhenNoLoadReportIsPublished(t *testing.T) {
	routes := clusterRoutes()
	delete(routes, "/admin/v2/broker-stats/load-report")
	cluster := newFakeCluster(t, routes, http.StatusNoContent)
	conn := probedConn(t, cluster.config())

	reason, degraded := conn.Capabilities().DegradedReason(model.CapClusterMetrics)
	if !degraded {
		t.Fatal("metrics stayed supported on a cluster that publishes no figures")
	}
	if reason != loadReportUnavailable {
		t.Errorf("reason = %q, want %q", reason, loadReportUnavailable)
	}
}

// The health page distinguishes a check that failed from one the cluster
// cannot run. Reporting an absent load manager as a failure sends an operator
// to fix a cluster that is working.
func TestHealthReportsAnAbsentLoadManagerAsUnavailable(t *testing.T) {
	routes := clusterRoutes()
	routes["/admin/v2/brokers/health"] = `ok`
	delete(routes, "/admin/v2/broker-stats/load-report")
	cluster := newFakeCluster(t, routes, http.StatusNoContent)
	conn := probedConn(t, cluster.config())

	health, err := conn.Health(context.Background())
	if err != nil {
		t.Fatalf("Health: %v", err)
	}

	byID := make(map[string]*model.HealthCheck, len(health.Checks))
	for _, check := range health.Checks {
		byID[check.ID] = check
	}
	if check := byID[checkLoadReport]; check == nil {
		t.Fatal("no load report check")
	} else if !check.Unavailable {
		t.Error("an absent load manager is reported as a failure, not as unavailable")
	}
	if check := byID[checkBroker]; check == nil || !check.Passed {
		t.Errorf("the broker check did not pass: %#v", check)
	}
}
