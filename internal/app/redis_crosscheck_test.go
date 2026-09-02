package app

import (
	"context"
	"os/exec"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/crypto"
	"github.com/amigoer/mq-studio/internal/driver"
	redisdriver "github.com/amigoer/mq-studio/internal/driver/redisstream"
	"github.com/amigoer/mq-studio/internal/e2e"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/cluster"
	"github.com/amigoer/mq-studio/internal/service/destination"
	"github.com/amigoer/mq-studio/internal/service/message"
	redisservice "github.com/amigoer/mq-studio/internal/service/redisstream"
	"github.com/amigoer/mq-studio/internal/service/settings"
	"github.com/amigoer/mq-studio/internal/service/subscription"
	"github.com/amigoer/mq-studio/internal/storage/layout"
)

/*
 * The Redis cross-check.
 *
 * Every other test in this package asks whether the code does what it was
 * written to do. This one asks whether the numbers it produces are right, and
 * it answers by getting each fact twice: once through the service layer every
 * board reads from, and once from redis-cli inside the container.
 *
 * The CLI matters because it is a separate implementation. Comparing a
 * go-redis call against another go-redis call proves the two agree with each
 * other and nothing about whether either is correct; comparing against
 * redis-cli means a mistake has to be made twice, in two codebases, in the
 * same direction, to go unnoticed. It is also the form an operator would check
 * with, so a disagreement here is a disagreement they would eventually hit.
 */

const (
	redisAddr      = "127.0.0.1:6479"
	redisContainer = "mq-studio-e2e-redis-redis-1"
	redisUser      = "mqstudio"
	redisPassword  = "mqstudio"
	// Everything this file creates, so a failed run leaves nothing behind that
	// the seed or another suite would trip over.
	crossPrefix = "mqs-cross:"
)

// redisStack assembles the same services the bridge is given, rooted in a temp
// directory so the test never touches a real configuration.
type redisStack struct {
	conn         driver.Conn
	cluster      *cluster.Service
	destinations *destination.Service
	subscription *subscription.Service
	messages     *message.Service
	redis        *redisservice.Service
	connID       int
}

func newRedisStack(t *testing.T) *redisStack {
	t.Helper()
	requireRedisCLI(t)
	if _, ok := driver.Lookup(model.KindRedisStream); !ok {
		driver.Register(redisdriver.New())
	}

	paths := layout.In(t.TempDir())
	if err := crypto.InitKey(paths.Directory); err != nil {
		t.Fatalf("initialize encryption key: %v", err)
	}
	settingsService := settings.New(paths.SettingsFile)
	registry := driver.NewRegistry()
	t.Cleanup(registry.CloseAll)

	const connID = 1
	profile := model.ConnectionProfile{
		ID: connID, Name: "crosscheck", Kind: model.KindRedisStream,
		Endpoints: redisAddr, TimeoutSec: 10,
		Auth: model.AuthConfig{Mechanism: model.AuthPlain},
		// Scoped to this file's own keys, so the counts it compares are of
		// things it created rather than of whatever else is on the broker.
		Options: map[string]string{redisdriver.OptionStreamFilter: crossPrefix + "*"},
	}
	profile.SetSecret(redisdriver.SecretUsername, redisUser)
	profile.SetSecret(redisdriver.SecretPassword, redisPassword)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := registry.Open(ctx, profile); err != nil {
		t.Fatalf("open the server: %v", err)
	}
	conn, ok := registry.Get(connID)
	if !ok {
		t.Fatal("the connection was opened and is not in the registry")
	}

	conns := newConnSource(registry)
	return &redisStack{
		conn:         conn,
		cluster:      cluster.New(paths.TPSHistoryFile, conns, settingsService),
		destinations: destination.New(conns, settingsService),
		subscription: subscription.New(conns, settingsService),
		messages:     message.New(conns, settingsService),
		redis:        redisservice.New(conns, settingsService),
		connID:       connID,
	}
}

func requireRedisCLI(t *testing.T) {
	t.Helper()
	e2e.Require(t, e2e.Env{
		Name:  "the redis e2e server",
		Start: "npm run e2e:redis:up",
		// The cross-checks run redis-cli inside the container, so a reachable
		// port is not enough: the container itself has to be there.
		Probe: e2e.DockerContainer(redisContainer),
	})
}

// redisCLI runs a command through redis-cli in the container and returns its
// output. Named for the tool because kafka_crosscheck_test.go owns `cli`.
func redisCLI(t *testing.T, args ...string) string {
	t.Helper()
	full := append([]string{
		"exec", redisContainer, "redis-cli",
		"--user", redisUser, "--pass", redisPassword, "--no-auth-warning",
	}, args...)
	output, err := exec.Command("docker", full...).CombinedOutput()
	if err != nil {
		t.Fatalf("redis-cli %s: %v\n%s", strings.Join(args, " "), err, output)
	}
	return strings.TrimSpace(string(output))
}

func redisCLIInt(t *testing.T, args ...string) int64 {
	t.Helper()
	raw := redisCLI(t, args...)
	value, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil {
		t.Fatalf("redis-cli %s returned %q, which is not a number", strings.Join(args, " "), raw)
	}
	return value
}

// seedCross writes entries through redis-cli, so what the service layer reads
// was put there by the other implementation.
func seedCross(t *testing.T, key string, count int) {
	t.Helper()
	t.Cleanup(func() {
		_ = exec.Command("docker", "exec", redisContainer, "redis-cli",
			"--user", redisUser, "--pass", redisPassword, "--no-auth-warning", "DEL", key).Run()
	})
	for i := range count {
		redisCLI(t, "XADD", key, "*", "seq", strconv.Itoa(i))
	}
}

func crossContext(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	t.Cleanup(cancel)
	return ctx
}

/*
 * The stream board's list, against XLEN and XINFO read by the CLI.
 *
 * The depth is the figure most likely to be silently wrong: it is the one a
 * reader acts on, and reading it from the wrong field of XINFO STREAM would
 * produce a plausible number every time.
 */
func TestLiveCrossCheckStreamList(t *testing.T) {
	stack := newRedisStack(t)
	ctx := crossContext(t)

	seedCross(t, crossPrefix+"orders", 17)
	seedCross(t, crossPrefix+"payments", 4)
	redisCLI(t, "XGROUP", "CREATE", crossPrefix+"orders", "settle", "0")
	redisCLI(t, "XGROUP", "CREATE", crossPrefix+"orders", "notify", "$")
	t.Cleanup(func() {
		_ = exec.Command("docker", "exec", redisContainer, "redis-cli",
			"--user", redisUser, "--pass", redisPassword, "--no-auth-warning",
			"DEL", crossPrefix+"orders").Run()
	})

	listed, err := stack.destinations.List(ctx, stack.connID, model.DestinationFilter{})
	if err != nil {
		t.Fatalf("list destinations: %v", err)
	}
	byName := map[string]*model.Destination{}
	for _, destination := range listed {
		byName[destination.Ref.Name] = destination
	}
	if len(listed) != 2 {
		t.Fatalf("the board lists %d streams, the CLI created 2: %v", len(listed), byName)
	}

	for _, key := range []string{crossPrefix + "orders", crossPrefix + "payments"} {
		want := redisCLIInt(t, "XLEN", key)
		got := byName[key]
		if got == nil {
			t.Errorf("%s is on the server and not on the board", key)
			continue
		}
		if got.Depth != want {
			t.Errorf("%s: the board says %d entries, XLEN says %d", key, got.Depth, want)
		}
	}

	// The group count, which the listing reads from XINFO STREAM's own field
	// rather than by counting - so this is where reading the wrong field would
	// show as a plausible number.
	if byName[crossPrefix+"orders"].Subscribers != 2 {
		t.Errorf("the board says %d groups on orders, the CLI created 2",
			byName[crossPrefix+"orders"].Subscribers)
	}
}

/*
 * The consumer group board, against XINFO GROUPS.
 *
 * The pending count and the lag are the two an operator acts on, and both are
 * derived rather than copied - the lag through UnknownMetric and the pending
 * out of the attribute map.
 */
func TestLiveCrossCheckConsumerGroups(t *testing.T) {
	stack := newRedisStack(t)
	ctx := crossContext(t)

	key := crossPrefix + "groups"
	seedCross(t, key, 12)
	redisCLI(t, "XGROUP", "CREATE", key, "settle", "0")
	// Hand out five and acknowledge none, through the CLI.
	redisCLI(t, "XREADGROUP", "GROUP", "settle", "worker-1", "COUNT", "5", "STREAMS", key, ">")

	listed, err := stack.subscription.List(ctx, stack.connID)
	if err != nil {
		t.Fatalf("list subscriptions: %v", err)
	}
	var group *model.Subscription
	for _, candidate := range listed {
		if candidate.Ref.Namespace == key && candidate.Ref.Name == "settle" {
			group = candidate
		}
	}
	if group == nil {
		t.Fatalf("the group the CLI created is not on the board: %+v", listed)
	}

	// XPENDING's summary form answers the count directly, which is the number
	// the board shows.
	summary := redisCLI(t, "XPENDING", key, "settle")
	if !strings.HasPrefix(summary, "5") {
		t.Fatalf("the CLI reports a pending summary of %q, want it to start at 5", summary)
	}
	if got := group.Attributes["pending"]; got != "5" {
		t.Errorf("the board says %q pending, the CLI says 5", got)
	}
	// Twelve entries, five read: seven still to come.
	if group.Backlog != 7 {
		t.Errorf("the board says a lag of %d, the stream holds 12 and the group has read 5", group.Backlog)
	}
	if group.Members != 1 {
		t.Errorf("the board says %d consumers, the CLI created 1", group.Members)
	}
}

/*
 * The message board, against XREVRANGE.
 *
 * The ids have to match exactly and in the same order: the board reads newest
 * first, and a reversed list would look entirely plausible while showing the
 * oldest entries to someone looking for the newest.
 */
func TestLiveCrossCheckMessageBrowse(t *testing.T) {
	stack := newRedisStack(t)
	ctx := crossContext(t)

	key := crossPrefix + "browse"
	seedCross(t, key, 9)

	items, err := stack.messages.Query(ctx, stack.connID, model.MessageQueryParams{
		Topic:      key,
		MaxResults: 4,
	})
	if err != nil {
		t.Fatalf("query messages: %v", err)
	}
	if len(items) != 4 {
		t.Fatalf("the board read %d entries, asked for 4", len(items))
	}

	// The CLI's own newest-first read of the same window.
	raw := redisCLI(t, "XREVRANGE", key, "+", "-", "COUNT", "4")
	for _, item := range items {
		if !strings.Contains(raw, item.MessageID) {
			t.Errorf("the board shows entry %s, which is not in the CLI's newest four:\n%s",
				item.MessageID, raw)
		}
	}
	// And the order. The first row must be the last entry the CLI sees.
	newest := redisCLI(t, "XREVRANGE", key, "+", "-", "COUNT", "1")
	if !strings.Contains(newest, items[0].MessageID) {
		t.Errorf("the board's first row is %s, the newest entry is:\n%s", items[0].MessageID, newest)
	}

	// The fields, which travel as properties rather than as a body.
	if items[0].Properties["seq"] == "" {
		t.Errorf("the entry came back with no fields: %+v", items[0].Properties)
	}
}

/*
 * The pending board, against XPENDING's own extended form.
 *
 * The delivery count is the column that says an entry keeps failing, and it is
 * the one a driver reading the wrong element of the reply would get subtly
 * wrong - every entry would show 1 and the page would look healthy.
 */
func TestLiveCrossCheckPendingEntries(t *testing.T) {
	stack := newRedisStack(t)
	ctx := crossContext(t)

	key := crossPrefix + "pending"
	seedCross(t, key, 6)
	redisCLI(t, "XGROUP", "CREATE", key, "settle", "0")
	redisCLI(t, "XREADGROUP", "GROUP", "settle", "worker-1", "COUNT", "3", "STREAMS", key, ">")
	// Claim them into a second consumer, which raises the delivery count.
	redisCLI(t, "XAUTOCLAIM", key, "settle", "worker-2", "0", "-")

	ref := model.SubscriptionRef{Namespace: key, Name: "settle"}
	entries, err := stack.redis.PendingEntries(ctx, stack.connID, model.PendingQuery{Ref: ref})
	if err != nil {
		t.Fatalf("pending entries: %v", err)
	}
	if len(entries) != 3 {
		t.Fatalf("the board lists %d pending entries, the CLI left 3", len(entries))
	}

	raw := redisCLI(t, "XPENDING", key, "settle", "-", "+", "10")
	for _, entry := range entries {
		if !strings.Contains(raw, entry.ID) {
			t.Errorf("the board shows %s, which the CLI does not:\n%s", entry.ID, raw)
		}
		if entry.Consumer != "worker-2" {
			t.Errorf("entry %s is owned by %q, the CLI claimed it for worker-2", entry.ID, entry.Consumer)
		}
		// Read once, then claimed: twice.
		if entry.Deliveries < 2 {
			t.Errorf("entry %s reports %d deliveries after a claim; the CLI's own listing is:\n%s",
				entry.ID, entry.Deliveries, raw)
		}
	}

	summary, err := stack.redis.PendingSummary(ctx, stack.connID, ref)
	if err != nil {
		t.Fatalf("pending summary: %v", err)
	}
	if summary.Count != 3 {
		t.Errorf("the summary says %d owed, the CLI left 3", summary.Count)
	}
	if len(summary.PerConsumer) != 1 || summary.PerConsumer[0].Consumer != "worker-2" {
		t.Errorf("the per-consumer breakdown is %+v, want worker-2 holding all three", summary.PerConsumer)
	}
}

/*
 * The node board, against INFO read by the CLI.
 *
 * INFO is a text document parsed by hand, so this is where a field read from
 * the wrong place would show as a plausible number under the wrong heading.
 */
func TestLiveCrossCheckNode(t *testing.T) {
	stack := newRedisStack(t)
	ctx := crossContext(t)

	nodes, err := stack.cluster.GetBrokers(ctx, stack.connID)
	if err != nil {
		t.Fatalf("list nodes: %v", err)
	}
	if len(nodes) != 1 {
		t.Fatalf("the board lists %d nodes for a standalone server", len(nodes))
	}
	node := nodes[0]

	version := redisInfoValue(t, "Server", "redis_version")
	if node.Version != version {
		t.Errorf("the board says version %q, INFO says %q", node.Version, version)
	}
	role := redisInfoValue(t, "Replication", "role")
	if node.Attributes["role"] != role {
		t.Errorf("the board says role %q, INFO says %q", node.Attributes["role"], role)
	}
	mode := redisInfoValue(t, "Server", "redis_mode")
	if node.Attributes["mode"] != mode {
		t.Errorf("the board says mode %q, INFO says %q", node.Attributes["mode"], mode)
	}
	// The append-only file is on in this environment, so a board reading the
	// wrong field would show it off.
	if node.Attributes["aofEnabled"] != redisInfoValue(t, "Persistence", "aof_enabled") {
		t.Errorf("the board says aof %q, INFO says %q",
			node.Attributes["aofEnabled"], redisInfoValue(t, "Persistence", "aof_enabled"))
	}
}

// redisInfoValue reads one field out of an INFO section through the CLI.
func redisInfoValue(t *testing.T, section, key string) string {
	t.Helper()
	for _, line := range strings.Split(redisCLI(t, "INFO", section), "\n") {
		name, value, found := strings.Cut(strings.TrimSpace(line), ":")
		if found && name == key {
			return strings.TrimSpace(value)
		}
	}
	t.Fatalf("INFO %s has no %s", section, key)
	return ""
}

/*
 * The ACL board, against ACL LIST.
 *
 * The rule line is passed through verbatim, so this checks the page shows what
 * the operator would see in their own terminal - which is the whole claim the
 * board makes.
 */
func TestLiveCrossCheckAclUsers(t *testing.T) {
	stack := newRedisStack(t)
	ctx := crossContext(t)

	users, err := stack.redis.AclUsers(ctx, stack.connID)
	if err != nil {
		t.Fatalf("acl users: %v", err)
	}
	raw := redisCLI(t, "ACL", "LIST")
	lines := strings.Split(raw, "\n")
	if len(users) != len(lines) {
		t.Fatalf("the board lists %d users, ACL LIST has %d lines:\n%s", len(users), len(lines), raw)
	}
	for _, user := range users {
		if !strings.Contains(raw, user.Rule) {
			t.Errorf("the board shows a rule the CLI does not:\n  board: %s\n  cli:\n%s", user.Rule, raw)
		}
	}
}

/*
 * The clients board, against CLIENT LIST.
 *
 * This connection has to be in both, which is also the check that the id the
 * close button would send is the id the server knows it by.
 */
func TestLiveCrossCheckClientConnections(t *testing.T) {
	stack := newRedisStack(t)
	ctx := crossContext(t)

	connections, err := stack.redis.ClientConnections(ctx, stack.connID)
	if err != nil {
		t.Fatalf("client connections: %v", err)
	}
	if len(connections) == 0 {
		t.Fatal("the board lists no connections; this one is at least there")
	}

	raw := redisCLI(t, "CLIENT", "LIST")
	for _, connection := range connections {
		// The id is what a close request names, so it has to be one the server
		// would recognise.
		if !strings.Contains(raw, "id="+connection.Name+" ") {
			// The CLI's own connection comes and goes between the two reads,
			// so only this app's rows are asserted.
			if strings.HasPrefix(connection.ClientName, "mq-studio") {
				t.Errorf("the board shows client id %s, which CLIENT LIST does not:\n%s",
					connection.Name, raw)
			}
		}
	}
}
