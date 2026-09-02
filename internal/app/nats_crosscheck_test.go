package app

import (
	"context"
	"encoding/json"
	"net/http"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/crypto"
	"github.com/amigoer/mq-studio/internal/driver"
	natsdriver "github.com/amigoer/mq-studio/internal/driver/nats"
	"github.com/amigoer/mq-studio/internal/e2e"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/cluster"
	"github.com/amigoer/mq-studio/internal/service/destination"
	"github.com/amigoer/mq-studio/internal/service/message"
	natsservice "github.com/amigoer/mq-studio/internal/service/nats"
	"github.com/amigoer/mq-studio/internal/service/settings"
	"github.com/amigoer/mq-studio/internal/service/subscription"
	"github.com/amigoer/mq-studio/internal/storage/layout"
)

/*
 * The NATS cross-check.
 *
 * Every other NATS test asks whether the code does what it was written to do.
 * This one asks whether the numbers it produces are right, and it answers by
 * getting each fact twice: once through the service layer every board reads
 * from, and once from a source that shares no code with it.
 *
 * Two such sources, because the driver has two tiers and they are not
 * interchangeable. The nats CLI is a separate program built on the same Go
 * client, which checks the requests and the mapping but not the client; the
 * monitoring endpoints are the server's own JSON, which shares nothing at all
 * with this codebase. Where a figure can be had both ways it is compared both
 * ways - a mistake then has to be made twice, in two places, in the same
 * direction, to go unnoticed.
 *
 * It reads the seeded streams rather than making its own, because the figures
 * worth checking are backlogs, replica sets and message counts, and comparing
 * zero against zero would pass whatever the driver did.
 */

const (
	natsBox = "mq-studio-e2e-nats-nats-box-1"
	// The streams scripts/e2e-nats-seed.sh builds.
	seedOrders = "MQS_SEED_ORDERS"
	seedEvents = "MQS_SEED_EVENTS"
	// The monitoring port of each server in the cluster, so a figure summed
	// across the fan-out can be summed again from outside.
	natsMonitor1 = "http://127.0.0.1:8222"
	natsMonitor2 = "http://127.0.0.1:8223"
	natsMonitor3 = "http://127.0.0.1:8224"
)

func requireNatsCLI(t *testing.T) {
	t.Helper()
	e2e.Require(t, e2e.Env{
		Family: e2e.NATS,
		Name:   "the nats e2e cluster",
		Start:  "npm run e2e:nats:up",
		// The cross-check runs the nats CLI inside the sidecar, so a reachable
		// port is not enough to say the environment is there.
		Probe: e2e.DockerContainer(natsBox),
	})
}

// natsCLI runs one nats command inside the cluster's sidecar.
func natsCLI(t *testing.T, args ...string) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	command := append([]string{"exec", natsBox, "nats"}, args...)
	output, err := exec.CommandContext(ctx, "docker", command...).CombinedOutput()
	if err != nil {
		t.Fatalf("nats %s: %v\n%s", strings.Join(args, " "), err, output)
	}
	return string(output)
}

/*
 * natsCLIJSON runs a command whose output is a JSON document.
 *
 * The document is found rather than assumed to start at byte zero: the CLI
 * prints its own progress lines to the same stream on several paths, and a
 * decode from the first byte would fail on the ones that do.
 */
func natsCLIJSON(t *testing.T, into any, args ...string) {
	t.Helper()
	raw := natsCLI(t, append(args, "--json")...)
	start := strings.IndexAny(raw, "{[")
	if start < 0 {
		t.Fatalf("nats %s printed no JSON:\n%s", strings.Join(args, " "), raw)
	}
	if err := json.Unmarshal([]byte(raw[start:]), into); err != nil {
		t.Fatalf("nats %s: %v\n%s", strings.Join(args, " "), err, raw[start:])
	}
}

// monitorJSON reads one monitoring endpoint straight off a server.
//
// The server's own document, decoded here rather than by the driver: it is the
// one source in this file that shares no line of code with what it is checking.
func monitorJSON(t *testing.T, into any, base, path string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, base+path, nil)
	if err != nil {
		t.Fatalf("build request for %s%s: %v", base, path, err)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET %s%s: %v", base, path, err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("GET %s%s answered %d", base, path, response.StatusCode)
	}
	if err := json.NewDecoder(response.Body).Decode(into); err != nil {
		t.Fatalf("decode %s%s: %v", base, path, err)
	}
}

// natsCrossStack is the services a board reads through, on a connection opened
// with every tier configured.
type natsCrossStack struct {
	connID       int
	cluster      *cluster.Service
	destinations *destination.Service
	subscription *subscription.Service
	messages     *message.Service
	nats         *natsservice.Service
}

func newNatsCrossStack(t *testing.T) *natsCrossStack {
	t.Helper()
	requireNatsCLI(t)
	requireLiveNats(t)
	if _, ok := driver.Lookup(model.KindNATS); !ok {
		driver.Register(natsdriver.New())
	}

	paths := layout.In(t.TempDir())
	if err := crypto.InitKey(paths.Directory); err != nil {
		t.Fatalf("initialize encryption key: %v", err)
	}
	registry := driver.NewRegistry()
	t.Cleanup(registry.CloseAll)

	profile := liveNatsProfile("nats-crosscheck", true, true)
	profile.ID = 1

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := registry.Open(ctx, profile); err != nil {
		t.Fatalf("open the seeded connection: %v", err)
	}

	settingsService := settings.New(paths.SettingsFile)
	conns := newConnSource(registry)
	return &natsCrossStack{
		connID:       profile.ID,
		cluster:      cluster.New(paths.TPSHistoryFile, conns, settingsService),
		destinations: destination.New(conns, settingsService),
		subscription: subscription.New(conns, settingsService),
		messages:     message.New(conns, settingsService),
		nats:         natsservice.New(conns, settingsService),
	}
}

// requireSeededNats skips - or in CI fails - when the seed has not been run,
// since every comparison below is against objects it creates.
func requireSeededNats(t *testing.T, stack *natsCrossStack) {
	t.Helper()
	streams, err := stack.destinations.List(context.Background(), stack.connID, model.DestinationFilter{})
	if err != nil {
		e2e.Missing(t, "the cluster did not answer a stream listing: %v", err)
	}
	for _, stream := range streams {
		if stream.Ref.Name == seedOrders {
			return
		}
	}
	e2e.Missing(t, "run `npm run e2e:nats:seed` to create %s", seedOrders)
}

// streamInfo is the part of `nats stream info --json` this file compares.
type streamInfo struct {
	Config struct {
		Subjects []string `json:"subjects"`
		Storage  string   `json:"storage"`
		Replicas int      `json:"num_replicas"`
	} `json:"config"`
	State struct {
		Messages  uint64 `json:"messages"`
		Bytes     uint64 `json:"bytes"`
		FirstSeq  uint64 `json:"first_seq"`
		LastSeq   uint64 `json:"last_seq"`
		Consumers int    `json:"consumer_count"`
		Subjects  int    `json:"num_subjects"`
	} `json:"state"`
	Cluster *struct {
		Name     string `json:"name"`
		Leader   string `json:"leader"`
		Replicas []struct {
			Name    string `json:"name"`
			Current bool   `json:"current"`
			Offline bool   `json:"offline"`
		} `json:"replicas"`
	} `json:"cluster"`
}

/*
 * Every seeded stream, compared field by field with the CLI's own answer.
 *
 * The counts are the obvious half. The replica set is the half worth the
 * second opinion: the driver flattens a stream's Raft group into a rendered
 * line and a healthy-peer count, and a flattening that dropped a peer or
 * called a lagging one current would look entirely healthy from inside this
 * codebase.
 */
func TestLiveNatsStreamsAgreeWithTheNatsCLI(t *testing.T) {
	stack := newNatsCrossStack(t)
	requireSeededNats(t, stack)
	ctx := context.Background()

	ours, err := stack.destinations.List(ctx, stack.connID, model.DestinationFilter{})
	if err != nil {
		t.Fatalf("List destinations: %v", err)
	}
	byName := make(map[string]*model.Destination, len(ours))
	for _, stream := range ours {
		byName[stream.Ref.Name] = stream
	}

	// The listing itself, both ways. A stream the CLI can see and this cannot
	// is a filter applied where none was asked for.
	var listed []string
	natsCLIJSON(t, &listed, "stream", "ls")
	for _, name := range listed {
		if strings.HasPrefix(name, "KV_") || strings.HasPrefix(name, "OBJ_") {
			// Deliberately hidden: a key-value bucket and an object store are
			// streams underneath, and listing them as streams would offer
			// operations that corrupt them.
			continue
		}
		if byName[name] == nil {
			t.Errorf("the CLI lists stream %q and the app does not", name)
		}
	}

	for _, name := range []string{seedOrders, seedEvents} {
		stream := byName[name]
		if stream == nil {
			t.Errorf("stream %q is missing from the app's listing", name)
			continue
		}
		var info streamInfo
		natsCLIJSON(t, &info, "stream", "info", name)

		if uint64(stream.Depth) != info.State.Messages {
			t.Errorf("%s: depth = %d, the CLI says %d", name, stream.Depth, info.State.Messages)
		}
		if stream.Subscribers != info.State.Consumers {
			t.Errorf("%s: consumers = %d, the CLI says %d",
				name, stream.Subscribers, info.State.Consumers)
		}
		if got := attrInt(t, stream.Attributes, natsdriver.AttrLastSeq); got != int64(info.State.LastSeq) {
			t.Errorf("%s: last sequence = %d, the CLI says %d", name, got, info.State.LastSeq)
		}
		if got := attrInt(t, stream.Attributes, natsdriver.AttrFirstSeq); got != int64(info.State.FirstSeq) {
			t.Errorf("%s: first sequence = %d, the CLI says %d", name, got, info.State.FirstSeq)
		}
		if got := attrInt(t, stream.Attributes, natsdriver.AttrBytes); got != int64(info.State.Bytes) {
			t.Errorf("%s: bytes = %d, the CLI says %d", name, got, info.State.Bytes)
		}
		if got := attrInt(t, stream.Attributes, natsdriver.AttrReplicas); got != int64(info.Config.Replicas) {
			t.Errorf("%s: replicas = %d, the CLI says %d", name, got, info.Config.Replicas)
		}
		if got := stream.Attributes[natsdriver.AttrStorage]; !strings.EqualFold(got, info.Config.Storage) {
			t.Errorf("%s: storage = %q, the CLI says %q", name, got, info.Config.Storage)
		}
		if got := stream.Attributes[natsdriver.AttrSubjects]; got != strings.Join(info.Config.Subjects, ", ") {
			t.Errorf("%s: subjects = %q, the CLI says %v", name, got, info.Config.Subjects)
		}

		if info.Cluster == nil {
			continue
		}
		if got := stream.Attributes[natsdriver.AttrLeader]; got != info.Cluster.Leader {
			t.Errorf("%s: leader = %q, the CLI says %q", name, got, info.Cluster.Leader)
		}
		// The leader counts itself, which is what makes 3 the answer for a
		// stream whose cluster block lists two followers.
		current := 1
		for _, replica := range info.Cluster.Replicas {
			if replica.Current && !replica.Offline {
				current++
			}
		}
		if got := attrInt(t, stream.Attributes, natsdriver.AttrReplicasHealthy); got != int64(current) {
			t.Errorf("%s: %d replicas current, the CLI says %d", name, got, current)
		}
	}
}

// consumerInfo is the part of `nats consumer info --json` this file compares.
type consumerInfo struct {
	Name   string `json:"name"`
	Config struct {
		Durable        string `json:"durable_name"`
		DeliverSubject string `json:"deliver_subject"`
		AckPolicy      string `json:"ack_policy"`
		MaxDeliver     int    `json:"max_deliver"`
	} `json:"config"`
	Delivered struct {
		Stream uint64 `json:"stream_seq"`
	} `json:"delivered"`
	AckFloor struct {
		Stream uint64 `json:"stream_seq"`
	} `json:"ack_floor"`
	Pending      uint64 `json:"num_pending"`
	AckPending   int    `json:"num_ack_pending"`
	Redelivered  int    `json:"num_redelivered"`
	Waiting      int    `json:"num_waiting"`
	PushBound    bool   `json:"push_bound"`
	ClusterBlock *struct {
		Leader string `json:"leader"`
	} `json:"cluster"`
}

/*
 * The seeded consumers and their backlogs, both ways.
 *
 * The backlog is the number the consumers board is opened for, and it is the
 * one this driver could most easily get wrong: JetStream reports several
 * counts that all look like "how far behind" - pending, ack pending,
 * redelivered, delivered against ack floor - and only one of them is the lag.
 *
 * seed-stuck is in here on purpose. It holds five deliveries unacknowledged
 * with an hour to wait, which is the state where the wrong count is most
 * plausible and most misleading.
 */
func TestLiveNatsConsumersAgreeWithTheNatsCLI(t *testing.T) {
	stack := newNatsCrossStack(t)
	requireSeededNats(t, stack)
	ctx := context.Background()

	ours, err := stack.subscription.List(ctx, stack.connID)
	if err != nil {
		t.Fatalf("List subscriptions: %v", err)
	}
	byName := make(map[string]*model.Subscription, len(ours))
	for _, consumer := range ours {
		byName[consumer.Ref.Namespace+"/"+consumer.Ref.Name] = consumer
	}

	var listed []string
	natsCLIJSON(t, &listed, "consumer", "ls", seedOrders)
	if len(listed) == 0 {
		e2e.Missing(t, "run `npm run e2e:nats:seed` to create the consumers on %s", seedOrders)
	}

	for _, name := range listed {
		consumer := byName[seedOrders+"/"+name]
		if consumer == nil {
			t.Errorf("the CLI lists consumer %q on %s and the app does not", name, seedOrders)
			continue
		}
		var info consumerInfo
		natsCLIJSON(t, &info, "consumer", "info", seedOrders, name)

		if uint64(consumer.Backlog) != info.Pending {
			t.Errorf("%s: backlog = %d, the CLI says %d pending",
				name, consumer.Backlog, info.Pending)
		}
		if got := attrInt(t, consumer.Attributes, natsdriver.AttrAckPending); got != int64(info.AckPending) {
			t.Errorf("%s: ack pending = %d, the CLI says %d", name, got, info.AckPending)
		}
		if got := attrInt(t, consumer.Attributes, natsdriver.AttrRedelivered); got != int64(info.Redelivered) {
			t.Errorf("%s: redelivered = %d, the CLI says %d", name, got, info.Redelivered)
		}
		if got := attrInt(t, consumer.Attributes, natsdriver.AttrDeliveredSeq); got != int64(info.Delivered.Stream) {
			t.Errorf("%s: delivered sequence = %d, the CLI says %d",
				name, got, info.Delivered.Stream)
		}
		if got := attrInt(t, consumer.Attributes, natsdriver.AttrAckFloorSeq); got != int64(info.AckFloor.Stream) {
			t.Errorf("%s: ack floor = %d, the CLI says %d", name, got, info.AckFloor.Stream)
		}

		// Push and pull are two different objects wearing one name, and half
		// of what the board draws depends on which this is.
		wantKind := "pull"
		if info.Config.DeliverSubject != "" {
			wantKind = "push"
		}
		if got := consumer.Attributes[natsdriver.AttrConsumerKind]; got != wantKind {
			t.Errorf("%s: kind = %q, the CLI says %q", name, got, wantKind)
		}
		// A pull consumer has nobody to count, which is not the same as
		// counting nobody.
		if wantKind == "pull" && consumer.Members != model.UnknownMetric {
			t.Errorf("%s: members = %d, want UnknownMetric for a pull consumer",
				name, consumer.Members)
		}
	}
}

/*
 * A page of messages, against the stream's own sequence numbers.
 *
 * The browse walks the stream through an ephemeral consumer and stops at the
 * last sequence, which is the part most likely to be off by one - and an
 * off-by-one here is a message the board never shows or a page that hangs
 * waiting for one that does not exist.
 */
func TestLiveNatsMessagesAgreeWithTheStreamState(t *testing.T) {
	stack := newNatsCrossStack(t)
	requireSeededNats(t, stack)
	ctx := context.Background()

	var info streamInfo
	natsCLIJSON(t, &info, "stream", "info", seedEvents)

	items, err := stack.messages.Query(ctx, stack.connID, model.MessageQueryParams{
		Topic:      seedEvents,
		MaxResults: int(info.State.Messages) + 10,
	})
	if err != nil {
		t.Fatalf("Query messages: %v", err)
	}
	if uint64(len(items)) != info.State.Messages {
		t.Fatalf("browsed %d messages, the stream holds %d", len(items), info.State.Messages)
	}

	// The sequences the browse reported, against the range the stream says it
	// holds. A message addressed by the wrong number cannot be fetched again.
	sequences := make([]uint64, 0, len(items))
	for _, item := range items {
		sequence, err := strconv.ParseUint(item.MessageID, 10, 64)
		if err != nil {
			t.Fatalf("message id %q is not a sequence: %v", item.MessageID, err)
		}
		sequences = append(sequences, sequence)
	}
	sort.Slice(sequences, func(i, j int) bool { return sequences[i] < sequences[j] })
	if sequences[0] != info.State.FirstSeq {
		t.Errorf("first sequence browsed = %d, the stream says %d",
			sequences[0], info.State.FirstSeq)
	}
	if sequences[len(sequences)-1] != info.State.LastSeq {
		t.Errorf("last sequence browsed = %d, the stream says %d",
			sequences[len(sequences)-1], info.State.LastSeq)
	}

	// And one of them fetched again by the id the browse handed back, which is
	// what the message detail panel does.
	one, err := stack.messages.Query(ctx, stack.connID, model.MessageQueryParams{
		Topic:     seedEvents,
		MessageID: strconv.FormatUint(info.State.LastSeq, 10),
	})
	if err != nil {
		t.Fatalf("fetch by sequence: %v", err)
	}
	if len(one) != 1 {
		t.Fatalf("fetching sequence %d returned %d messages", info.State.LastSeq, len(one))
	}
}

// varz is the part of a server's /varz this file compares.
type varz struct {
	Name          string `json:"server_name"`
	Version       string `json:"version"`
	Connections   int    `json:"connections"`
	Subscriptions uint32 `json:"subscriptions"`
	Routes        int    `json:"routes"`
	Cluster       struct {
		Name string `json:"name"`
	} `json:"cluster"`
}

/*
 * The three servers, against each one's own /varz.
 *
 * This is the assertion that the system account really does fan out. The
 * driver asks $SYS once and collects whatever answers; every server's
 * monitoring port is asked separately here, and comparing the two is what
 * would catch a fan-out that quietly returned only the server it happened to
 * be connected to.
 */
func TestLiveNatsServersAgreeWithEachMonitoringEndpoint(t *testing.T) {
	stack := newNatsCrossStack(t)
	ctx := context.Background()

	nodes, err := stack.cluster.GetBrokers(ctx, stack.connID)
	if err != nil {
		t.Fatalf("GetBrokers: %v", err)
	}
	byName := make(map[string]*model.Node, len(nodes))
	for _, node := range nodes {
		byName[node.Name] = node
	}

	for _, base := range []string{natsMonitor1, natsMonitor2, natsMonitor3} {
		var reported varz
		monitorJSON(t, &reported, base, "/varz")

		node := byName[reported.Name]
		if node == nil {
			t.Errorf("%s reports server %q and the app did not list it", base, reported.Name)
			continue
		}
		if node.Version != reported.Version {
			t.Errorf("%s: version = %q, /varz says %q", reported.Name, node.Version, reported.Version)
		}
		if node.Cluster != reported.Cluster.Name {
			t.Errorf("%s: cluster = %q, /varz says %q",
				reported.Name, node.Cluster, reported.Cluster.Name)
		}
		if got := attrInt(t, node.Attributes, natsdriver.AttrRoutes); got != int64(reported.Routes) {
			t.Errorf("%s: routes = %d, /varz says %d", reported.Name, got, reported.Routes)
		}
		// Every server is up: a NATS server that has gone stops answering
		// rather than reporting itself down, so a row exists only for one
		// that replied.
		if node.Status != model.NodeOnline {
			t.Errorf("%s: status = %q, and it just answered its own /varz",
				reported.Name, node.Status)
		}
	}
	if len(nodes) != 3 {
		t.Errorf("listed %d servers, want the three in the compose file", len(nodes))
	}
}

// connz is the part of a server's /connz this file compares.
type connz struct {
	Server struct {
		Name string `json:"server_name"`
	} `json:"server"`
	Total int `json:"total"`
}

/*
 * The connection listing, against the sum of every server's /connz.
 *
 * The one figure the fan-out has to add up rather than take from a single
 * answer, and adding up wrongly is invisible from inside: a listing that
 * dropped one server's connections still looks like a full list.
 *
 * Compared as a floor rather than an equality. The two reads are seconds
 * apart against a shared cluster, and a client that connected in between
 * would fail an exact match without anything being wrong.
 */
func TestLiveNatsConnectionsAgreeWithEveryConnz(t *testing.T) {
	stack := newNatsCrossStack(t)
	ctx := context.Background()

	ours, err := stack.nats.Connections(ctx, stack.connID, "")
	if err != nil {
		t.Fatalf("Connections: %v", err)
	}

	servers := map[string]bool{}
	for _, connection := range ours {
		servers[connection.Node] = true
	}
	if len(servers) == 0 {
		t.Fatal("the listing named no server at all")
	}

	total := 0
	for _, base := range []string{natsMonitor1, natsMonitor2, natsMonitor3} {
		var reported connz
		monitorJSON(t, &reported, base, "/connz")
		total += reported.Total
	}
	if total == 0 {
		t.Fatal("no server reports any connection, and this test is one")
	}
	// This app's own two sockets are in both counts, so the listing cannot be
	// smaller than what the servers report unless a server was skipped.
	if len(ours) < total {
		t.Errorf("listed %d connections, the three servers report %d between them",
			len(ours), total)
	}
}

// accountz and accstatz are the parts of those endpoints this file compares.
type accountz struct {
	SystemAccount string   `json:"system_account"`
	Accounts      []string `json:"accounts"`
}

type accstatz struct {
	Accounts []struct {
		Account string `json:"acc"`
		Conns   int    `json:"conns"`
		Subs    uint32 `json:"num_subscriptions"`
	} `json:"account_statz"`
}

/*
 * The accounts page, against the server's own two account endpoints.
 *
 * The roster is one document and the figures are another, and this driver
 * merges them - so a merge that lost an account, or attached one account's
 * figures to another's row, is exactly what a second opinion catches. The
 * system account is checked by name because that flag decides how half the
 * app's cluster pages behave.
 */
func TestLiveNatsAccountsAgreeWithTheMonitoringEndpoints(t *testing.T) {
	stack := newNatsCrossStack(t)
	ctx := context.Background()

	ours, err := stack.nats.Accounts(ctx, stack.connID)
	if err != nil {
		t.Fatalf("Accounts: %v", err)
	}
	byName := make(map[string]*model.Namespace, len(ours))
	for _, account := range ours {
		byName[account.Name] = account
	}

	var roster accountz
	monitorJSON(t, &roster, natsMonitor1, "/accountz")
	for _, name := range roster.Accounts {
		if byName[name] == nil {
			t.Errorf("/accountz lists account %q and the app does not", name)
		}
	}
	if roster.SystemAccount == "" {
		t.Fatal("the cluster names no system account, and tests/e2e/nats/nats.conf sets one")
	}
	for name, account := range byName {
		isSystem := account.Attributes[natsdriver.AttrIsSystemAccount] == "true"
		if isSystem != (name == roster.SystemAccount) {
			t.Errorf("account %q marked system=%v, /accountz says the system account is %q",
				name, isSystem, roster.SystemAccount)
		}
	}

	// The per-account figures, summed across the three servers the same way
	// the driver sums the fan-out. Connections are left out: they change while
	// this test runs, and the streams below do not.
	subscriptions := map[string]uint32{}
	for _, base := range []string{natsMonitor1, natsMonitor2, natsMonitor3} {
		var stats accstatz
		monitorJSON(t, &stats, base, "/accstatz?unused=1")
		for _, account := range stats.Accounts {
			subscriptions[account.Account] += account.Subs
		}
	}
	for name, want := range subscriptions {
		account := byName[name]
		if account == nil {
			t.Errorf("/accstatz reports account %q and the app does not list it", name)
			continue
		}
		// A floor rather than an equality: subscriptions come and go with the
		// clients holding them, and this app is one of those clients.
		got := attrInt(t, account.Attributes, natsdriver.AttrSubscriptions)
		if want > 0 && got == 0 {
			t.Errorf("account %q: subscriptions = 0, /accstatz reports %d across the cluster",
				name, want)
		}
	}
}

// attrInt reads one attribute as a number, or fails saying which was not one.
func attrInt(t *testing.T, attributes map[string]string, key string) int64 {
	t.Helper()
	raw, ok := attributes[key]
	if !ok {
		t.Errorf("attribute %q is missing", key)
		return -1
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		t.Errorf("attribute %q = %q, which is not a number", key, raw)
		return -1
	}
	return value
}
