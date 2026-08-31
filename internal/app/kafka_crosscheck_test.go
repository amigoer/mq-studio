package app

import (
	"context"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/crypto"
	"github.com/amigoer/mq-studio/internal/driver"
	kafkadriver "github.com/amigoer/mq-studio/internal/driver/kafka"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/cluster"
	"github.com/amigoer/mq-studio/internal/service/destination"
	kafkaservice "github.com/amigoer/mq-studio/internal/service/kafka"
	"github.com/amigoer/mq-studio/internal/service/message"
	"github.com/amigoer/mq-studio/internal/service/settings"
	"github.com/amigoer/mq-studio/internal/service/subscription"
	"github.com/amigoer/mq-studio/internal/storage/layout"
)

/*
 * The cross-check.
 *
 * Every other test in this repository asks whether the code does what it was
 * written to do. This one asks whether the numbers it produces are right, and
 * it answers by getting each fact twice: once through the service layer every
 * board reads from, and once from Kafka's own command line inside the
 * container.
 *
 * The official CLI matters because it is a completely separate implementation.
 * Comparing a kadm call against another kadm call proves the two agree with
 * each other and nothing about whether either is correct; comparing against
 * kafka-topics.sh means a mistake has to be made twice, in two codebases, in
 * the same direction, to go unnoticed.
 *
 * The CLI runs on the INTERNAL listener: EXTERNAL advertises 127.0.0.1, which
 * inside a container is that container.
 */

const (
	kafkaSeeds     = "127.0.0.1:9092,127.0.0.1:9094,127.0.0.1:9096"
	kafkaContainer = "mq-studio-e2e-kafka-kafka-1-1"
	kafkaInternal  = "kafka-1:19092"
)

// kafkaStack assembles the same services the bridge is given, rooted in a temp
// directory so the test never touches a real configuration.
type kafkaStack struct {
	conn         driver.Conn
	cluster      *cluster.Service
	destinations *destination.Service
	subscription *subscription.Service
	messages     *message.Service
	kafka        *kafkaservice.Service
	connID       int
}

func newKafkaStack(t *testing.T) *kafkaStack {
	t.Helper()
	requireKafkaCLI(t)
	if _, ok := driver.Lookup(model.KindKafka); !ok {
		driver.Register(kafkadriver.New())
	}

	paths := layout.In(t.TempDir())
	if err := crypto.InitKey(paths.Directory); err != nil {
		t.Fatalf("initialize encryption key: %v", err)
	}
	settingsService := settings.New(paths.SettingsFile)
	registry := driver.NewRegistry()
	t.Cleanup(registry.CloseAll)

	const connID = 1
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := registry.Open(ctx, model.ConnectionProfile{
		ID: connID, Name: "crosscheck", Kind: model.KindKafka,
		Endpoints: kafkaSeeds, TimeoutSec: 10,
	}); err != nil {
		t.Fatalf("open the cluster: %v", err)
	}
	conn, ok := registry.Get(connID)
	if !ok {
		t.Fatal("the connection was opened and is not in the registry")
	}

	conns := newConnSource(registry)
	return &kafkaStack{
		conn:         conn,
		cluster:      cluster.New(paths.TPSHistoryFile, conns, settingsService),
		destinations: destination.New(conns, settingsService),
		subscription: subscription.New(conns, settingsService),
		messages:     message.New(conns, settingsService),
		kafka:        kafkaservice.New(conns, settingsService),
		connID:       connID,
	}
}

func requireKafkaCLI(t *testing.T) {
	t.Helper()
	if os.Getenv("MQ_STUDIO_E2E") == "" {
		t.Skip("set MQ_STUDIO_E2E=1 and run `npm run e2e:kafka:up` to cross-check against a real cluster")
	}
	if err := exec.Command("docker", "inspect", kafkaContainer).Run(); err != nil {
		if os.Getenv("CI") != "" {
			t.Fatalf("the kafka e2e cluster must be running in CI: %v", err)
		}
		t.Skipf("the kafka e2e cluster is not running; start it with npm run e2e:kafka:up (%v)", err)
	}
}

// cli runs one of Kafka's own tools inside the cluster and returns its output.
func cli(t *testing.T, tool string, args ...string) string {
	t.Helper()
	full := append([]string{
		"exec", kafkaContainer, "/opt/kafka/bin/" + tool,
		"--bootstrap-server", kafkaInternal,
	}, args...)

	output, err := exec.Command("docker", full...).Output()
	if err != nil {
		t.Fatalf("%s %v: %v", tool, args, err)
	}
	return string(output)
}

// lines drops the blank ones and the warnings the CLI prints to stdout.
func lines(raw string) []string {
	out := make([]string, 0)
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "[20") {
			continue
		}
		out = append(out, line)
	}
	return out
}

func fieldAfter(line, name string) string {
	fields := strings.Fields(line)
	for index, field := range fields {
		if strings.TrimSuffix(field, ":") == name && index+1 < len(fields) {
			return fields[index+1]
		}
	}
	return ""
}

/*
 * A topic built for the comparison rather than borrowed from the seed.
 *
 * The seed is for looking at, and a test that depended on it would pass or
 * fail depending on whether somebody had run it.
 */
func crossCheckTopic(t *testing.T, stack *kafkaStack, name string, partitions int) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	ref := model.DestinationRef{Name: name}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		_ = stack.kafka.DeleteTopic(cleanup, stack.connID, name)
	})
	if err := stack.kafka.CreateTopic(ctx, stack.connID, model.DestinationSpec{
		Ref: ref, Partitions: partitions,
		Attributes: map[string]string{
			kafkadriver.AttrReplicationFactor: "3",
			"cleanup.policy":                  "compact",
			"min.insync.replicas":             "2",
			"retention.ms":                    "604800000",
		},
	}); err != nil {
		t.Fatalf("create %s: %v", name, err)
	}
}

func TestLiveKafkaCrossCheck(t *testing.T) {
	stack := newKafkaStack(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	const topic = "mqs-xcheck-orders"
	const group = "mqs-xcheck-group"
	crossCheckTopic(t, stack, topic, 4)

	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		_ = stack.kafka.DeleteGroup(cleanup, stack.connID, group)
	})

	// Records and a group, so the message and consumer checks have something
	// with arithmetic behind it.
	for i := 0; i < 40; i++ {
		if _, err := stack.kafka.SendRecord(ctx, stack.connID, kafkadriver.RecordRequest{
			Topic: topic, Value: "value-" + strconv.Itoa(i), Acks: kafkadriver.AcksAll, Count: 1,
			Key: keyPtr("key-" + strconv.Itoa(i)),
		}); err != nil {
			t.Fatalf("produce: %v", err)
		}
	}
	if err := stack.kafka.ResetGroupOffsets(ctx, stack.connID, kafkadriver.OffsetResetRequest{
		Group: group, Topic: topic, Target: kafkadriver.OffsetLatest,
	}); err != nil {
		t.Fatalf("seed the group: %v", err)
	}
	if err := stack.kafka.ResetGroupOffsets(ctx, stack.connID, kafkadriver.OffsetResetRequest{
		Group: group, Topic: topic, Target: kafkadriver.OffsetShift, Value: -3,
	}); err != nil {
		t.Fatalf("shift the group: %v", err)
	}

	t.Run("the overview counts what the cluster counts", func(t *testing.T) {
		view, nodes, err := stack.cluster.Overview(ctx, stack.connID)
		if err != nil {
			t.Fatalf("Overview: %v", err)
		}

		// Brokers, against kafka-broker-api-versions.sh.
		brokers := 0
		for _, line := range lines(cli(t, "kafka-broker-api-versions.sh")) {
			if strings.Contains(line, "(id: ") {
				brokers++
			}
		}
		if brokers != len(nodes) || brokers != view.TotalNodes {
			t.Errorf("brokers: mq-studio %d/%d, kafka-broker-api-versions.sh %d",
				len(nodes), view.TotalNodes, brokers)
		}

		// Topics, against kafka-topics.sh --list. The CLI lists internal
		// topics too, so they are counted the same way here.
		listed := lines(cli(t, "kafka-topics.sh", "--list"))
		internal := 0
		for _, name := range listed {
			if strings.HasPrefix(name, "__") {
				internal++
			}
		}
		want := len(listed) - internal
		if got := view.Destinations; got != want {
			t.Errorf("topics: mq-studio %d, kafka-topics.sh %d", got, want)
		}

		// Partition health, against kafka-topics.sh --describe
		// --under-replicated-partitions, which is the CLI's own answer to the
		// same question.
		urp := len(lines(cli(t, "kafka-topics.sh", "--describe", "--under-replicated-partitions")))
		if got := view.Attribute(kafkadriver.AttrUnderReplicated); got != strconv.Itoa(urp) {
			t.Errorf("under-replicated: mq-studio %s, kafka-topics.sh %d", got, urp)
		}
		unavailable := len(lines(cli(t, "kafka-topics.sh", "--describe", "--unavailable-partitions")))
		if got := view.Attribute(kafkadriver.AttrLeaderlessPartition); got != strconv.Itoa(unavailable) {
			t.Errorf("leaderless: mq-studio %s, kafka-topics.sh %d", got, unavailable)
		}
	})

	t.Run("a topic matches what kafka-topics.sh describes", func(t *testing.T) {
		detail, err := stack.destinations.Detail(ctx, stack.connID, model.DestinationRef{Name: topic})
		if err != nil {
			t.Fatalf("Detail: %v", err)
		}

		described := lines(cli(t, "kafka-topics.sh", "--describe", "--topic", topic))
		header := described[0]
		if got, want := strconv.Itoa(detail.Partitions), fieldAfter(header, "PartitionCount"); got != want {
			t.Errorf("partitions: mq-studio %s, kafka-topics.sh %s", got, want)
		}
		if got, want := detail.Attribute(kafkadriver.AttrReplicationFactor), fieldAfter(header, "ReplicationFactor"); got != want {
			t.Errorf("replication factor: mq-studio %s, kafka-topics.sh %s", got, want)
		}

		// Every partition's leader and ISR, line by line.
		for _, line := range described[1:] {
			partition := fieldAfter(line, "Partition")
			leader := fieldAfter(line, "Leader")
			if partition == "" || leader == "" {
				continue
			}
			stats, err := stack.destinations.Stats(ctx, stack.connID, model.DestinationRef{Name: topic})
			if err != nil {
				t.Fatalf("Stats: %v", err)
			}
			rows, _ := stats["partitions"].([]map[string]interface{})
			found := false
			for _, row := range rows {
				if strconv.Itoa(int(row["partition"].(int32))) != partition {
					continue
				}
				found = true
				if got := strconv.Itoa(int(row["leader"].(int32))); got != leader {
					t.Errorf("partition %s leader: mq-studio %s, kafka-topics.sh %s",
						partition, got, leader)
				}
			}
			if !found {
				t.Errorf("partition %s is described by kafka-topics.sh and missing from mq-studio", partition)
			}
		}
	})

	t.Run("a topic's settings match kafka-configs.sh", func(t *testing.T) {
		detail, err := stack.destinations.Detail(ctx, stack.connID, model.DestinationRef{Name: topic})
		if err != nil {
			t.Fatalf("Detail: %v", err)
		}
		described := cli(t, "kafka-configs.sh", "--describe",
			"--entity-type", "topics", "--entity-name", topic)

		for _, setting := range []string{"cleanup.policy", "min.insync.replicas", "retention.ms"} {
			value := detail.Attributes[setting]
			if value == "" {
				t.Errorf("%s is missing from mq-studio's answer", setting)
				continue
			}
			if !strings.Contains(described, setting+"="+value) {
				t.Errorf("%s: mq-studio says %q, kafka-configs.sh does not agree", setting, value)
			}
		}
	})

	t.Run("a consumer group's lag matches kafka-consumer-groups.sh", func(t *testing.T) {
		// The list is what the consumer board reads; there is no per-group
		// detail call, because one Lag request answers every group at once.
		listed, err := stack.subscription.List(ctx, stack.connID)
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		var detail *model.Subscription
		for _, one := range listed {
			if one.Ref.Name == group {
				detail = one
			}
		}
		if detail == nil {
			t.Fatalf("mq-studio does not list the group it just created: %v", listed)
		}

		described := lines(cli(t, "kafka-consumer-groups.sh", "--describe", "--group", group))
		total := int64(0)
		partitions := 0
		for _, line := range described {
			fields := strings.Fields(line)
			// GROUP TOPIC PARTITION CURRENT-OFFSET LOG-END-OFFSET LAG ...
			if len(fields) < 6 || fields[0] != group {
				continue
			}
			lag, err := strconv.ParseInt(fields[5], 10, 64)
			if err != nil {
				continue
			}
			partitions++
			total += lag
		}
		if partitions == 0 {
			t.Fatal("kafka-consumer-groups.sh described no partitions for the group")
		}
		if detail.Backlog != total {
			t.Errorf("lag: mq-studio %d, kafka-consumer-groups.sh %d", detail.Backlog, total)
		}

		// And the group is listed by both.
		named := lines(cli(t, "kafka-consumer-groups.sh", "--list"))
		found := false
		for _, name := range named {
			if name == group {
				found = true
			}
		}
		if !found {
			t.Error("kafka-consumer-groups.sh does not list a group mq-studio just created")
		}
	})

	t.Run("the readable range matches kafka-get-offsets.sh", func(t *testing.T) {
		detail, err := stack.destinations.Detail(ctx, stack.connID, model.DestinationRef{Name: topic})
		if err != nil {
			t.Fatalf("Detail: %v", err)
		}

		// kafka-get-offsets.sh prints topic:partition:offset.
		sum := func(args ...string) int64 {
			total := int64(0)
			for _, line := range lines(cli(t, "kafka-get-offsets.sh", args...)) {
				parts := strings.Split(line, ":")
				if len(parts) != 3 {
					continue
				}
				value, err := strconv.ParseInt(parts[2], 10, 64)
				if err != nil {
					continue
				}
				total += value
			}
			return total
		}
		readable := sum("--topic", topic, "--time", "latest") -
			sum("--topic", topic, "--time", "earliest")

		if detail.Depth != readable {
			t.Errorf("records: mq-studio %d, kafka-get-offsets.sh %d", detail.Depth, readable)
		}
	})

	t.Run("a record reads back as the console consumer sees it", func(t *testing.T) {
		records, err := stack.messages.Query(ctx, stack.connID, model.MessageQueryParams{
			Topic: topic, MaxResults: 40,
			Filters: map[string]string{kafkadriver.FilterMode: kafkadriver.ModeOffset,
				kafkadriver.FilterStartOffset: "0"},
		})
		if err != nil {
			t.Fatalf("Query: %v", err)
		}
		if len(records) == 0 {
			t.Fatal("mq-studio read no records from a topic with forty in it")
		}

		// Everything the console consumer prints, keyed the way it prints it.
		printed := cli(t, "kafka-console-consumer.sh", "--topic", topic,
			"--from-beginning", "--max-messages", "40", "--timeout-ms", "10000",
			"--property", "print.key=true", "--property", "key.separator==")
		for _, record := range records {
			pair := record.Keys + "=" + record.Body
			if !strings.Contains(printed, pair) {
				t.Errorf("mq-studio read %q, which kafka-console-consumer.sh did not print", pair)
				break
			}
		}
	})

	t.Run("the log directories match kafka-log-dirs.sh", func(t *testing.T) {
		dirs, err := stack.kafka.LogDirs(ctx, stack.connID)
		if err != nil {
			t.Fatalf("LogDirs: %v", err)
		}
		if len(dirs) == 0 {
			t.Fatal("mq-studio reported no log directories")
		}

		described := cli(t, "kafka-log-dirs.sh", "--describe", "--topic-list", topic)
		for _, dir := range dirs {
			if dir.Err != "" {
				continue
			}
			if !strings.Contains(described, dir.Path) {
				t.Errorf("mq-studio reported directory %q, which kafka-log-dirs.sh did not", dir.Path)
			}
		}
	})
}

func keyPtr(value string) *string { return &value }

/*
 * What a cluster looks like when something is wrong.
 *
 * Every check above runs against a healthy cluster, which proves the numbers
 * agree and nothing about whether trouble is visible. This stops a broker and
 * asks whether the boards would show it - which is the one thing an operator
 * opens this app to find out.
 */
func TestLiveKafkaBrokerLoss(t *testing.T) {
	stack := newKafkaStack(t)
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	const topic = "mqs-xcheck-loss"
	crossCheckTopic(t, stack, topic, 3)

	healthy, _, err := stack.cluster.Overview(ctx, stack.connID)
	if err != nil {
		t.Fatalf("Overview: %v", err)
	}
	if healthy.Attribute(kafkadriver.AttrUnderReplicated) != "0" {
		t.Skip("the cluster is already degraded; this test needs a healthy one to start from")
	}

	// Broker 3 rather than 1: the CLI runs inside broker 1, and stopping the
	// container the test is talking through proves nothing about the cluster.
	const stopped = "mq-studio-e2e-kafka-kafka-3-1"
	restart := func() {
		out, err := exec.Command("docker", "start", stopped).CombinedOutput()
		if err != nil {
			t.Fatalf("restart %s: %v: %s", stopped, err, out)
		}
	}
	if out, err := exec.Command("docker", "stop", stopped).CombinedOutput(); err != nil {
		t.Fatalf("stop %s: %v: %s", stopped, err, out)
	}
	t.Cleanup(restart)

	// The controller notices a broker leaving on its session timeout, not
	// instantly, so this waits for the cluster to agree rather than asserting
	// on the first read.
	var degraded *model.ClusterOverview
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		view, _, err := stack.cluster.Overview(ctx, stack.connID)
		if err == nil && view.Attribute(kafkadriver.AttrUnderReplicated) != "0" {
			degraded = view
			break
		}
		time.Sleep(time.Second)
	}
	if degraded == nil {
		t.Fatal("a broker was stopped and no partition was reported as under-replicated")
	}

	// The same fact from the other side: the CLI's own count of
	// under-replicated partitions.
	urp := len(lines(cli(t, "kafka-topics.sh", "--describe", "--under-replicated-partitions")))
	if urp == 0 {
		t.Fatal("mq-studio reports under-replicated partitions and kafka-topics.sh reports none")
	}
	if got := degraded.Attribute(kafkadriver.AttrUnderReplicated); got != strconv.Itoa(urp) {
		t.Errorf("under-replicated: mq-studio %s, kafka-topics.sh %d", got, urp)
	}

	// The topic board has to name which topic, not only that something is
	// wrong somewhere.
	detail, err := stack.destinations.Detail(ctx, stack.connID, model.DestinationRef{Name: topic})
	if err != nil {
		t.Fatalf("Detail: %v", err)
	}
	if detail.Attribute(kafkadriver.AttrTopicUnderRep) == "0" {
		t.Errorf("%s has replicas on the stopped broker and reports none under-replicated", topic)
	}

	restart()
	// And it clears again, which matters as much: an alert that never
	// recovers is one people learn to ignore.
	recovered := false
	deadline = time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		view, _, err := stack.cluster.Overview(ctx, stack.connID)
		if err == nil && view.Attribute(kafkadriver.AttrUnderReplicated) == "0" {
			recovered = true
			break
		}
		time.Sleep(time.Second)
	}
	if !recovered {
		t.Error("the broker came back and the cluster still reports under-replicated partitions")
	}
}

/*
 * Everything the app can do to a cluster, in order, with the cluster's own
 * tools checking each step - and the cluster left as it was found.
 *
 * The last assertion is the one that catches what the others cannot: an
 * operation that half worked leaves something behind, and a suite whose
 * fixtures accumulate stops being able to tell a leak from a slow cluster.
 */
func TestLiveKafkaFullRoundTrip(t *testing.T) {
	stack := newKafkaStack(t)
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	const topic = "mqs-xcheck-roundtrip"
	const group = "mqs-xcheck-roundtrip-group"

	before := lines(cli(t, "kafka-topics.sh", "--list"))
	beforeGroups := lines(cli(t, "kafka-consumer-groups.sh", "--list"))

	ref := model.DestinationRef{Name: topic}
	if err := stack.kafka.CreateTopic(ctx, stack.connID, model.DestinationSpec{
		Ref: ref, Partitions: 2,
		Attributes: map[string]string{kafkadriver.AttrReplicationFactor: "3"},
	}); err != nil {
		t.Fatalf("create: %v", err)
	}
	if !strings.Contains(cli(t, "kafka-topics.sh", "--list"), topic) {
		t.Fatal("kafka-topics.sh does not list a topic mq-studio just created")
	}

	if err := stack.kafka.AlterTopicConfigs(ctx, stack.connID, model.DestinationSpec{
		Ref: ref, Attributes: map[string]string{"retention.ms": "7200000"},
	}); err != nil {
		t.Fatalf("alter: %v", err)
	}
	if !strings.Contains(cli(t, "kafka-configs.sh", "--describe",
		"--entity-type", "topics", "--entity-name", topic), "retention.ms=7200000") {
		t.Error("kafka-configs.sh does not show the setting mq-studio just wrote")
	}

	for i := 0; i < 10; i++ {
		if _, err := stack.kafka.SendRecord(ctx, stack.connID, kafkadriver.RecordRequest{
			Topic: topic, Value: "v" + strconv.Itoa(i), Acks: kafkadriver.AcksAll, Count: 1,
		}); err != nil {
			t.Fatalf("produce: %v", err)
		}
	}

	records, err := stack.messages.Query(ctx, stack.connID, model.MessageQueryParams{
		Topic: topic, MaxResults: 10,
	})
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if len(records) != 10 {
		t.Errorf("wrote 10 records and read %d back", len(records))
	}

	if err := stack.kafka.ResetGroupOffsets(ctx, stack.connID, kafkadriver.OffsetResetRequest{
		Group: group, Topic: topic, Target: kafkadriver.OffsetEarliest,
	}); err != nil {
		t.Fatalf("seed the group: %v", err)
	}
	if !strings.Contains(cli(t, "kafka-consumer-groups.sh", "--list"), group) {
		t.Error("kafka-consumer-groups.sh does not list a group mq-studio just created")
	}

	// And back to how it started.
	if err := stack.kafka.DeleteGroup(ctx, stack.connID, group); err != nil {
		t.Fatalf("delete the group: %v", err)
	}
	if err := stack.kafka.DeleteTopic(ctx, stack.connID, topic); err != nil {
		t.Fatalf("delete the topic: %v", err)
	}

	after := lines(cli(t, "kafka-topics.sh", "--list"))
	afterGroups := lines(cli(t, "kafka-consumer-groups.sh", "--list"))
	if len(after) != len(before) {
		t.Errorf("topics: started with %d, ended with %d", len(before), len(after))
	}
	if len(afterGroups) != len(beforeGroups) {
		t.Errorf("consumer groups: started with %d, ended with %d",
			len(beforeGroups), len(afterGroups))
	}
}
