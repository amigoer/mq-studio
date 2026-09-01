package app

import (
	"context"
	"encoding/json"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/crypto"
	"github.com/amigoer/mq-studio/internal/driver"
	pulsardriver "github.com/amigoer/mq-studio/internal/driver/pulsar"
	"github.com/amigoer/mq-studio/internal/e2e"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/cluster"
	pulsarservice "github.com/amigoer/mq-studio/internal/service/pulsar"
	"github.com/amigoer/mq-studio/internal/service/settings"
	"github.com/amigoer/mq-studio/internal/service/subscription"
	"github.com/amigoer/mq-studio/internal/storage/layout"
)

/*
 * The cross-check.
 *
 * Every other Pulsar test asks whether the code does what it was written to
 * do. This one asks whether the numbers it produces are right, and it answers
 * by getting each fact twice: once through the service layer every board reads
 * from, and once from Pulsar's own command line inside the container.
 *
 * The official CLI matters because it is a completely separate implementation
 * in a different language. Comparing one pulsaradmin call against another
 * proves the two agree with each other and nothing about whether either is
 * correct; comparing against pulsar-admin means a mistake has to be made
 * twice, in two codebases, in the same direction, to go unnoticed.
 *
 * It reads the seeded namespace rather than making its own, because the
 * figures worth checking are backlogs and partition counts - and comparing
 * zero against zero would pass whatever the driver did.
 */

const (
	pulsarContainer = "mq-studio-e2e-pulsar-pulsar-1"
	// The namespace scripts/e2e-pulsar-seed.sh builds.
	seededTenant    = "mq-studio-seed"
	seededNamespace = seededTenant + "/orders"
)

func requirePulsarCLI(t *testing.T) {
	t.Helper()
	e2e.Require(t, e2e.Env{
		Name:  "the pulsar e2e cluster",
		Start: "npm run e2e:pulsar:up",
		// The cross-check runs Pulsar's own tools inside the container, so a
		// reachable port is not enough to say the environment is there.
		Probe: e2e.DockerContainer(pulsarContainer),
	})
}

// pulsarAdmin runs one pulsar-admin command inside the cluster's container.
func pulsarAdmin(t *testing.T, args ...string) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	command := append([]string{"exec", pulsarContainer, "bin/pulsar-admin"}, args...)
	output, err := exec.CommandContext(ctx, "docker", command...).CombinedOutput()
	if err != nil {
		t.Fatalf("pulsar-admin %s: %v\n%s", strings.Join(args, " "), err, output)
	}
	return string(output)
}

/*
 * pulsarAdminJSON runs a command whose output is a JSON document.
 *
 * Only the stats commands are JSON: every listing pulsar-admin prints - topics,
 * brokers, namespaces, permissions - is plain text, one item per line, which is
 * why the helpers below read lines rather than parsing everything.
 *
 * The document is found rather than assumed to start at byte zero, because
 * pulsar-admin prints its own log lines to the same stream on some paths.
 */
func pulsarAdminJSON(t *testing.T, into any, args ...string) {
	t.Helper()
	raw := pulsarAdmin(t, args...)
	start := strings.IndexAny(raw, "{[")
	if start < 0 {
		t.Fatalf("pulsar-admin %s printed no JSON:\n%s", strings.Join(args, " "), raw)
	}
	if err := json.Unmarshal([]byte(raw[start:]), into); err != nil {
		t.Fatalf("pulsar-admin %s: %v\n%s", strings.Join(args, " "), err, raw)
	}
}

// pulsarAdminLines is one item per line, which is how pulsar-admin prints
// every listing it has.
func pulsarAdminLines(t *testing.T, args ...string) []string {
	t.Helper()
	lines := make([]string, 0)
	for _, line := range strings.Split(pulsarAdmin(t, args...), "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			lines = append(lines, trimmed)
		}
	}
	sort.Strings(lines)
	return lines
}

// pulsarStack assembles the same services the bridge is given, rooted in a
// temp directory so the test never touches a real configuration.
type pulsarStack struct {
	conn          driver.Conn
	cluster       *cluster.Service
	subscriptions *subscription.Service
	pulsar        *pulsarservice.Service
}

func newPulsarStack(t *testing.T) *pulsarStack {
	t.Helper()
	requirePulsarCLI(t)
	requireLivePulsar(t)
	if _, ok := driver.Lookup(model.KindPulsar); !ok {
		driver.Register(pulsardriver.New())
	}

	paths := layout.In(t.TempDir())
	if err := crypto.InitKey(paths.Directory); err != nil {
		t.Fatalf("initialize encryption key: %v", err)
	}
	registry := driver.NewRegistry()
	t.Cleanup(registry.CloseAll)

	// Scoped to the seeded namespace, because that is what has figures worth
	// comparing.
	profile := livePulsarProfile("pulsar-crosscheck")
	profile.ID = 1
	profile.Options[pulsardriver.OptionTenant] = seededTenant
	profile.Options[pulsardriver.OptionNamespace] = "orders"

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := registry.Open(ctx, profile); err != nil {
		t.Fatalf("open the seeded connection: %v", err)
	}
	conn, ok := registry.Get(profile.ID)
	if !ok {
		t.Fatal("opening stored no connection")
	}

	settingsService := settings.New(paths.SettingsFile)
	conns := newConnSource(registry)
	return &pulsarStack{
		conn:          conn,
		cluster:       cluster.New(paths.TPSHistoryFile, conns, settingsService),
		subscriptions: subscription.New(conns, settingsService),
		pulsar:        pulsarservice.New(conns, settingsService),
	}
}

// requireSeeded skips - or in CI fails - when the seed has not been run, since
// every comparison below is against objects it creates.
func requireSeeded(t *testing.T, stack *pulsarStack) {
	t.Helper()
	topics, err := stack.pulsar.Topics(context.Background(), 1, seededNamespace, false)
	if err != nil || len(topics) == 0 {
		e2e.Missing(t, "run `npm run e2e:pulsar:seed` to create %s", seededNamespace)
	}
}

/*
 * The topic list and every partition count, both ways.
 *
 * The partition count is the one worth the second opinion: Pulsar's two topic
 * shapes answer at two different endpoints, and the driver falls through from
 * one to the other on a 404. A fall-through that reported the wrong shape would
 * look entirely healthy from inside this codebase.
 */
func TestLivePulsarTopicsAgreeWithPulsarAdmin(t *testing.T) {
	stack := newPulsarStack(t)
	requireSeeded(t, stack)
	ctx := context.Background()

	topics, err := stack.pulsar.Topics(ctx, 1, seededNamespace, true)
	if err != nil {
		t.Fatalf("Topics: %v", err)
	}

	ours := make([]string, 0, len(topics))
	partitions := map[string]int{}
	for _, topic := range topics {
		scheme := "persistent"
		if topic.Attributes[pulsardriver.AttrTopicPersistent] == "false" {
			scheme = "non-persistent"
		}
		url := scheme + "://" + topic.Ref.Namespace + "/" + topic.Ref.Name
		ours = append(ours, url)
		partitions[url] = topic.Partitions
	}
	sort.Strings(ours)

	theirs := cliTopics(t)
	if len(ours) != len(theirs) {
		t.Fatalf("the app lists %d topics and pulsar-admin lists %d:\n app: %v\n cli: %v",
			len(ours), len(theirs), ours, theirs)
	}
	for i := range ours {
		if ours[i] != theirs[i] {
			t.Errorf("topic %d: app has %q, pulsar-admin has %q", i, ours[i], theirs[i])
		}
	}

	for url, count := range partitions {
		want := cliPartitions(t, url)
		if count != want {
			t.Errorf("%s: app reports %d partitions, pulsar-admin reports %d",
				url, count, want)
		}
	}
}

/*
 * Every subscription and its backlog, both ways.
 *
 * The backlog is the number an operator acts on, and the driver computes it
 * across a walk of every topic with a fall-through between two stats
 * endpoints. Both halves of that could be wrong in a way that still produces a
 * plausible number.
 */
func TestLivePulsarSubscriptionsAgreeWithPulsarAdmin(t *testing.T) {
	stack := newPulsarStack(t)
	requireSeeded(t, stack)
	ctx := context.Background()

	subscriptions, err := stack.subscriptions.List(ctx, 1)
	if err != nil {
		t.Fatalf("List subscriptions: %v", err)
	}

	ours := map[string]int64{}
	for _, found := range subscriptions {
		// The ref's namespace is the topic URL on this family, which is what
		// makes two subscriptions of the same name on two topics distinct.
		ours[found.Ref.Namespace+"|"+found.Ref.Name] = found.Backlog
	}

	theirs := map[string]int64{}
	for _, url := range cliTopics(t) {
		for name, backlog := range cliSubscriptions(t, url) {
			theirs[url+"|"+name] = backlog
		}
	}

	if len(ours) != len(theirs) {
		t.Fatalf("the app found %d subscriptions and pulsar-admin found %d:\n app: %v\n cli: %v",
			len(ours), len(theirs), ours, theirs)
	}
	for key, backlog := range theirs {
		found, ok := ours[key]
		if !ok {
			t.Errorf("%s is missing from the app's listing", key)
			continue
		}
		if found != backlog {
			t.Errorf("%s: app reports a backlog of %d, pulsar-admin reports %d",
				key, found, backlog)
		}
	}

	// And the seed put real messages behind at least one of them, so this
	// comparison is not zero against zero.
	nonZero := 0
	for _, backlog := range theirs {
		if backlog > 0 {
			nonZero++
		}
	}
	if nonZero == 0 {
		e2e.Missing(t, "the seeded namespace has no backlog; re-run `npm run e2e:pulsar:seed`")
	}
}

// The broker listing, both ways.
func TestLivePulsarBrokersAgreeWithPulsarAdmin(t *testing.T) {
	stack := newPulsarStack(t)
	ctx := context.Background()

	overview, nodes, err := stack.cluster.Overview(ctx, 1)
	if err != nil {
		t.Fatalf("cluster overview: %v", err)
	}

	ours := make([]string, 0, len(nodes))
	for _, node := range nodes {
		ours = append(ours, node.Address)
	}
	sort.Strings(ours)

	theirs := pulsarAdminLines(t, "brokers", "list", overview.Name)

	if len(ours) != len(theirs) {
		t.Fatalf("the app lists %v and pulsar-admin lists %v", ours, theirs)
	}
	for i := range ours {
		if ours[i] != theirs[i] {
			t.Errorf("broker %d: app has %q, pulsar-admin has %q", i, ours[i], theirs[i])
		}
	}
}

// The namespace listing and the limits on it, both ways.
func TestLivePulsarNamespacesAgreeWithPulsarAdmin(t *testing.T) {
	stack := newPulsarStack(t)
	requireSeeded(t, stack)
	ctx := context.Background()

	namespaces, err := stack.pulsar.Namespaces(ctx, 1)
	if err != nil {
		t.Fatalf("Namespaces: %v", err)
	}

	ours := make([]string, 0, len(namespaces))
	limits := map[string]map[string]int{}
	for _, namespace := range namespaces {
		ours = append(ours, namespace.Name)
		limits[namespace.Name] = namespace.Limits
	}
	sort.Strings(ours)

	theirs := pulsarAdminLines(t, "namespaces", "list", seededTenant)

	if len(ours) != len(theirs) {
		t.Fatalf("the app lists %v and pulsar-admin lists %v", ours, theirs)
	}

	// The seed sets a message TTL, which is the limit worth comparing: an
	// absent one and one set to zero are different facts, and the driver goes
	// out of its way to keep them apart.
	ttl, err := strconv.Atoi(strings.TrimSpace(pulsarAdmin(t, "namespaces", "get-message-ttl", seededNamespace)))
	if err != nil {
		t.Fatalf("read the seeded message TTL: %v", err)
	}
	if got, ok := limits[seededNamespace][pulsardriver.LimitMessageTTLSeconds]; !ok {
		t.Errorf("the app reports no message TTL on %s, pulsar-admin reports %d",
			seededNamespace, ttl)
	} else if got != ttl {
		t.Errorf("message TTL: app reports %d, pulsar-admin reports %d", got, ttl)
	}
}

/*
 * The dead-letter walk, checked against the names pulsar-admin lists.
 *
 * Nothing on the broker records which subscription filled a dead-letter topic,
 * so the driver resolves it from the namespace's own topic list. There is no
 * second implementation of that to compare against - what the CLI can confirm
 * is which topics exist, which is what the resolution is built on, and that
 * the orphan the seed creates really has no origin.
 */
func TestLivePulsarDeadLettersMatchTheTopicsThatExist(t *testing.T) {
	stack := newPulsarStack(t)
	requireSeeded(t, stack)
	ctx := context.Background()

	queues, err := stack.pulsar.DeadLetterQueues(ctx, 1, seededNamespace)
	if err != nil {
		t.Fatalf("DeadLetterQueues: %v", err)
	}

	existing := map[string]bool{}
	for _, url := range cliTopics(t) {
		if index := strings.LastIndex(url, "/"); index >= 0 {
			existing[url[index+1:]] = true
		}
	}

	byName := map[string]*model.DeadLetterQueue{}
	for _, queue := range queues {
		byName[queue.Name] = queue
		// Whatever the walk resolved as an origin has to be a topic that is
		// really there; resolving to one that is not would be the bug this
		// catches.
		for _, source := range queue.Sources {
			if !existing[source.Queue] {
				t.Errorf("%s was traced back to %q, which pulsar-admin does not list",
					queue.Name, source.Queue)
			}
		}
	}

	dlq, ok := byName["orders-worker-DLQ"]
	if !ok {
		t.Fatalf("the seeded dead-letter topic is missing; found %v", byName)
	}
	if len(dlq.Sources) != 1 ||
		dlq.Sources[0].Queue != "orders" ||
		dlq.Sources[0].Subscription != "worker" {
		t.Errorf("sources = %+v, want orders / worker", dlq.Sources)
	}
	if want := cliBacklog(t, "persistent://"+seededNamespace+"/orders-worker-DLQ"); dlq.Depth != want {
		t.Errorf("depth = %d, pulsar-admin reports %d", dlq.Depth, want)
	}

	orphan, ok := byName["gone-reader-DLQ"]
	if !ok {
		t.Fatal("the seeded orphan is missing")
	}
	if len(orphan.Sources) != 0 {
		t.Errorf("the orphan claims a source: %+v", orphan.Sources)
	}
}

// The role grants, both ways.
func TestLivePulsarGrantsAgreeWithPulsarAdmin(t *testing.T) {
	stack := newPulsarStack(t)
	requireSeeded(t, stack)
	ctx := context.Background()

	grants, err := stack.pulsar.NamespacePermissions(ctx, 1, seededNamespace)
	if err != nil {
		t.Fatalf("NamespacePermissions: %v", err)
	}

	// "role    [action, action]", one per line.
	theirs := map[string][]string{}
	for _, line := range pulsarAdminLines(t, "namespaces", "permissions", seededNamespace) {
		role, actions, found := strings.Cut(line, "[")
		if !found {
			continue
		}
		theirs[strings.TrimSpace(role)] = strings.Split(
			strings.TrimSuffix(strings.TrimSpace(actions), "]"), ",")
	}
	for role, actions := range theirs {
		for i, action := range actions {
			theirs[role][i] = strings.TrimSpace(action)
		}
	}

	if len(grants) != len(theirs) {
		t.Fatalf("the app reports %d grants and pulsar-admin reports %d: %v",
			len(grants), len(theirs), theirs)
	}
	for _, grant := range grants {
		actions, ok := theirs[grant.Identity]
		if !ok {
			t.Errorf("%s is not a role pulsar-admin knows about", grant.Identity)
			continue
		}
		// consume folds onto Read, and nothing else may.
		hasConsume := false
		for _, action := range actions {
			if action == "consume" {
				hasConsume = true
			}
		}
		if hasConsume && grant.Read != "allow" {
			t.Errorf("%s has consume but the app reports read %q", grant.Identity, grant.Read)
		}
		if !hasConsume && grant.Read == "allow" {
			t.Errorf("%s has no consume but the app reports it can read", grant.Identity)
		}
	}
}

/*
 * cliTopics is every topic in the seeded namespace, as the app counts them.
 *
 * Two commands, because pulsar-admin splits what the app joins. "topics list"
 * expands a partitioned topic into its partitions and does not print the
 * parent at all, while "list-partitioned-topics" prints only the parents - so
 * the objects an operator thinks of as topics are the second list plus
 * whatever in the first is not a partition of one.
 */
func cliTopics(t *testing.T) []string {
	t.Helper()

	topics := make([]string, 0)
	parents := pulsarAdminLines(t, "topics", "list-partitioned-topics", seededNamespace)
	topics = append(topics, parents...)

	for _, line := range pulsarAdminLines(t, "topics", "list", seededNamespace) {
		if !strings.HasPrefix(line, "persistent://") &&
			!strings.HasPrefix(line, "non-persistent://") {
			continue
		}
		if partitionOf(line, parents) {
			continue
		}
		topics = append(topics, line)
	}
	sort.Strings(topics)
	return topics
}

// partitionOf reports whether a listed topic is one partition of a partitioned
// parent, which the app reports as the parent rather than as N topics.
func partitionOf(topic string, parents []string) bool {
	for _, parent := range parents {
		if strings.HasPrefix(topic, parent+"-partition-") {
			return true
		}
	}
	return false
}

// cliPartitions is a topic's partition count, as pulsar-admin reports it.
func cliPartitions(t *testing.T, url string) int {
	t.Helper()
	var metadata struct {
		Partitions int `json:"partitions"`
	}
	pulsarAdminJSON(t, &metadata, "topics", "get-partitioned-topic-metadata", url)
	return metadata.Partitions
}

// cliSubscriptions is a topic's subscriptions and their backlogs.
func cliSubscriptions(t *testing.T, url string) map[string]int64 {
	t.Helper()

	var stats struct {
		Metadata struct {
			Partitions int `json:"partitions"`
		} `json:"metadata"`
		Subscriptions map[string]struct {
			MsgBacklog int64 `json:"msgBacklog"`
		} `json:"subscriptions"`
	}
	// The two shapes answer at two different commands, which is the same split
	// the driver has to make - so the CLI side makes it from the metadata
	// rather than by guessing.
	if cliPartitions(t, url) > 0 {
		pulsarAdminJSON(t, &stats, "topics", "partitioned-stats", url)
	} else {
		pulsarAdminJSON(t, &stats, "topics", "stats", url)
	}

	backlogs := make(map[string]int64, len(stats.Subscriptions))
	for name, subscription := range stats.Subscriptions {
		backlogs[name] = subscription.MsgBacklog
	}
	return backlogs
}

// cliBacklog is a topic's deepest subscription backlog, which is what the app
// reports as a topic's depth.
func cliBacklog(t *testing.T, url string) int64 {
	t.Helper()
	deepest := int64(0)
	for _, backlog := range cliSubscriptions(t, url) {
		if backlog > deepest {
			deepest = backlog
		}
	}
	return deepest
}
