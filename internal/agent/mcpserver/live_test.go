package mcpserver_test

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"os"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/amigoer/mq-studio/internal/agent/catalog"
	"github.com/amigoer/mq-studio/internal/agent/mcpserver"
	"github.com/amigoer/mq-studio/internal/app"
	"github.com/amigoer/mq-studio/internal/driver/rabbitmq"
	"github.com/amigoer/mq-studio/internal/e2e"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/storage/layout"
)

/*
 * The MCP server against a real broker.
 *
 * Two things can only be shown here. The first is that a tool and the pages
 * agree: the server is a second adapter over the same services, and the whole
 * claim is that it answers the same question the same way - a tool that
 * quietly read something else would pass every offline test in this
 * repository.
 *
 * The second is that the server leaves the profile store alone. That is not a
 * style preference: the store is rewritten whole under an in-process lock, so
 * a second process that stamped a status into it would be racing the window
 * for the user's own edits. The file is hashed either side of a whole session.
 */

const liveRabbitEndpoint = "http://127.0.0.1:15672"

func requireLiveRabbit(t *testing.T) {
	t.Helper()
	e2e.Require(t, e2e.Env{
		Name:   "the rabbitmq broker",
		Family: e2e.RabbitMQ,
		Start:  "npm run e2e:rabbitmq:up",
		Probe:  e2e.HTTPGet(liveRabbitEndpoint + "/api/overview"),
	})
}

// liveServices is a whole application over a temporary directory, with one
// connection stored in it.
func liveServices(t *testing.T, profile model.ConnectionProfile) (*app.Services, int, layout.Layout) {
	t.Helper()

	directory := t.TempDir()
	paths := layout.In(directory)
	services, err := app.NewReadOnlyIn(directory)
	if err != nil {
		t.Fatalf("assemble: %v", err)
	}
	t.Cleanup(services.Close)

	stored, err := services.Connections.AddConnection(profile)
	if err != nil {
		t.Fatalf("store the profile: %v", err)
	}
	return services, stored.ID, paths
}

// mcpSession runs a real client against the real server over the in-memory
// transport, so what the test calls is what a client calls.
func mcpSession(t *testing.T, services *app.Services, allow catalog.Blast) *mcp.ClientSession {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	t.Cleanup(cancel)

	grants, err := mcpserver.Allowance{Everywhere: allow}.Grant(nil)
	if err != nil {
		t.Fatalf("grant %q everywhere: %v", allow, err)
	}
	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	go func() {
		if err := mcpserver.New(services, "test", grants, livePhrases).Run(ctx, serverTransport); err != nil && ctx.Err() == nil {
			t.Errorf("server stopped: %v", err)
		}
	}()

	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "test"}, nil)
	session, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { _ = session.Close() })
	return session
}

// livePhrases resolves the keys this suite expects to see. The real
// translations are the renderer's locale files, which only package main can
// embed; what matters here is that whatever a driver declared went through a
// phrasebook rather than reaching the caller as a key.
func livePhrases(key string) string {
	if key == "mq.rabbitmq.caveat.browseAltersQueue" {
		return "browsing requeues the message flagged redelivered"
	}
	return key
}

// call runs one tool and decodes its structured result.
func call[T any](t *testing.T, session *mcp.ClientSession, tool string, arguments map[string]any) T {
	t.Helper()
	return callWithin[T](t, session, tool, arguments, 1)
}

// callEventually is call for a read on a cluster whose other suite stops a
// broker on purpose: a partition can be between leaders for a moment, and a
// read is safe to ask again.
func callEventually[T any](t *testing.T, session *mcp.ClientSession, tool string, arguments map[string]any) T {
	t.Helper()
	return callWithin[T](t, session, tool, arguments, 4)
}

func callWithin[T any](
	t *testing.T, session *mcp.ClientSession, tool string, arguments map[string]any, attempts int,
) T {
	t.Helper()

	encoded, err := json.Marshal(arguments)
	if err != nil {
		t.Fatal(err)
	}
	var result *mcp.CallToolResult
	for attempt := 1; ; attempt++ {
		result, err = session.CallTool(context.Background(), &mcp.CallToolParams{
			Name:      tool,
			Arguments: json.RawMessage(encoded),
		})
		if err != nil {
			t.Fatalf("%s: %v", tool, err)
		}
		if !result.IsError {
			break
		}
		if attempt == attempts {
			t.Fatalf("%s refused: %v", tool, result.Content)
		}
		time.Sleep(time.Second)
	}

	var decoded T
	if err := json.Unmarshal(mustJSON(t, result.StructuredContent), &decoded); err != nil {
		t.Fatalf("%s returned something that does not decode: %v", tool, err)
	}
	return decoded
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func liveRabbitProfile() model.ConnectionProfile {
	profile := model.ConnectionProfile{
		Kind:      model.KindRabbitMQ,
		Name:      "mcp-live",
		Endpoints: liveRabbitEndpoint,
		Auth:      model.AuthConfig{Mechanism: model.AuthPlain},
	}
	profile.SetSecret(rabbitmq.SecretUsername, "mqstudio")
	profile.SetSecret(rabbitmq.SecretPassword, "mqstudio")
	return profile
}

// A tool and the service layer behind the pages have to answer the same
// question with the same list. Comparing names rather than whole records is
// deliberate: the shapes are the same types, so equality there would only
// prove that json.Marshal is a function.
func TestLiveMCPDestinationsMatchTheServiceLayer(t *testing.T) {
	requireLiveRabbit(t)

	services, connID, _ := liveServices(t, liveRabbitProfile())
	session := mcpSession(t, services, catalog.BlastRead)

	type destinationsResult struct {
		Destinations []*model.Destination `json:"destinations"`
		Caveat       string               `json:"caveat"`
	}
	viaTool := call[destinationsResult](t, session, "destinations_list",
		map[string]any{"connection": connID})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	viaServices, err := services.Topics.List(ctx, connID, model.DestinationFilter{})
	if err != nil {
		t.Fatalf("list through the services: %v", err)
	}

	if got, want := destinationNames(viaTool.Destinations), destinationNames(viaServices); !slices.Equal(got, want) {
		t.Fatalf("the tool listed %v and the services %v", got, want)
	}
	if len(destinationNames(viaServices)) == 0 {
		t.Log("the broker has no destinations; the comparison held but proved little")
	}
}

// churn is the prefix the driver suite names what it creates with. It runs
// beside this one against the same broker, so two listings taken a moment
// apart can differ by whatever it made or removed in between.
const churn = "mqs-test-"

// The caveat is the point of the whole capability model reaching this far. A
// RabbitMQ browse goes through basic.get and alters the queue, and a caller
// with no screen has nowhere else to learn that.
func TestLiveMCPCarriesTheBrowseCaveat(t *testing.T) {
	requireLiveRabbit(t)

	services, connID, _ := liveServices(t, liveRabbitProfile())
	session := mcpSession(t, services, catalog.BlastRead)

	type describeResult struct {
		Family     string `json:"family"`
		Operations []struct {
			ID     string `json:"id"`
			Blast  string `json:"blast"`
			Caveat string `json:"caveat"`
		} `json:"operations"`
	}
	described := call[describeResult](t, session, "capabilities_describe",
		map[string]any{"connection": connID})

	if described.Family != string(model.KindRabbitMQ) {
		t.Fatalf("family = %q", described.Family)
	}
	var browse *struct {
		ID     string `json:"id"`
		Blast  string `json:"blast"`
		Caveat string `json:"caveat"`
	}
	for i := range described.Operations {
		if described.Operations[i].ID == "message.query" {
			browse = &described.Operations[i]
		}
	}
	if browse == nil {
		t.Fatal("this connection cannot browse, so there is no caveat to carry")
	}
	if browse.Caveat == "" {
		t.Error("the browse caveat did not reach the tool; a caller would read it as side-effect free")
	}
	// The capability model stores i18n keys. One arriving unresolved is worse
	// than useless: it looks like a warning and cannot be read as one.
	if strings.HasPrefix(browse.Caveat, "mq.") {
		t.Errorf("the caveat arrived as a raw key: %q", browse.Caveat)
	}
	if browse.Blast != "read" {
		t.Errorf("browse blast radius = %q, want read", browse.Blast)
	}
}

/*
 * The read-only claim, asserted rather than asserted-in-a-comment.
 *
 * Connect stamps a status and a check time into the profile store and saves
 * the whole file. The MCP server dials through OpenReadOnly instead, and this
 * is what holds it there: a whole session - opening a connection it had not
 * opened, and reading through it - must leave the bytes on disk identical.
 */
func TestLiveMCPLeavesTheProfileStoreAlone(t *testing.T) {
	requireLiveRabbit(t)

	services, connID, paths := liveServices(t, liveRabbitProfile())
	before := hashFile(t, paths.ConnectionsFile)

	session := mcpSession(t, services, catalog.BlastRead)
	type destinationsResult struct {
		Destinations []*model.Destination `json:"destinations"`
	}
	// Opening the connection is the part that would write, so the tool has to
	// be one that dials rather than one answered from the stored profiles.
	call[destinationsResult](t, session, "destinations_list", map[string]any{"connection": connID})

	if after := hashFile(t, paths.ConnectionsFile); after != before {
		t.Error("the MCP server rewrote the profile store; the window is the only writer")
	}
}

func hashFile(t *testing.T, path string) [32]byte {
	t.Helper()
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return sha256.Sum256(contents)
}

/*
 * The write tools against a real broker.
 *
 * What an offline test cannot show is that the effect a tool reports is true.
 * "emptied the queue" is a sentence either way; only a broker can say whether
 * the queue is empty afterwards, and that is the whole value of the line.
 */
func TestLiveMCPWritesDoWhatTheySay(t *testing.T) {
	requireLiveRabbit(t)

	services, connID, paths := liveServices(t, liveRabbitProfile())
	session := mcpSession(t, services, catalog.BlastDestructive)
	before := hashFile(t, paths.ConnectionsFile)

	name := "mq-studio-mcp-" + strconv.FormatInt(time.Now().UnixNano(), 36)
	ref := model.DestinationRef{Name: name}

	type writeResult struct {
		Effect struct {
			Changed string `json:"changed"`
			Caveat  string `json:"caveat"`
		} `json:"effect"`
		Reference string `json:"reference"`
	}

	created := call[writeResult](t, session, "destination_create", map[string]any{
		"connection": connID,
		"name":       name,
		// Declared for this family by the catalogue, and read by the driver.
		"attributes": map[string]string{"durable": "true", "queueType": "classic"},
	})
	if created.Effect.Changed == "" {
		t.Error("creating a destination reported no effect")
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		_ = services.Topics.Remove(ctx, connID, ref)
	})

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := services.Topics.Detail(ctx, connID, ref); err != nil {
		t.Fatalf("the tool said it created %s and the broker does not have it: %v", name, err)
	}

	published := call[writeResult](t, session, "message_publish", map[string]any{
		"connection":  connID,
		"destination": name,
		"body":        "from the mcp server",
	})
	if published.Effect.Changed == "" {
		t.Error("publishing reported no effect")
	}

	// The broker counts asynchronously, so the depth is read until it shows
	// the message rather than once, immediately. Absence here would otherwise
	// be indistinguishable from a message that simply had not landed yet.
	if depth := awaitDepth(t, services, connID, ref, func(depth int64) bool { return depth > 0 }); depth == 0 {
		t.Fatal("the tool said it published and the queue never showed a message")
	}

	purged := call[writeResult](t, session, "destination_purge", map[string]any{
		"connection": connID,
		"name":       name,
	})
	if purged.Effect.Changed == "" {
		t.Error("emptying reported no effect")
	}
	if depth := awaitDepth(t, services, connID, ref, func(depth int64) bool { return depth == 0 }); depth != 0 {
		t.Errorf("the tool said it emptied %s and the queue still holds %d", name, depth)
	}

	deleted := call[writeResult](t, session, "destination_delete", map[string]any{
		"connection": connID,
		"name":       name,
	})
	if deleted.Effect.Changed == "" {
		t.Error("deleting reported no effect")
	}
	if _, err := services.Topics.Detail(ctx, connID, ref); err == nil {
		t.Errorf("the tool said it deleted %s and the broker still has it", name)
	}

	// Four writes to the broker and still not one to the profile store.
	if after := hashFile(t, paths.ConnectionsFile); after != before {
		t.Error("the MCP server rewrote the profile store")
	}
}

// Namespaces and routing against the seeded broker, which binds queues to
// exchanges in the default vhost. Each tool has to agree with the service
// behind the pages, and naming that vhost has to get through the check that
// refuses a namespace the family ignored.
func TestLiveMCPReadsNamespacesAndRouting(t *testing.T) {
	requireLiveRabbit(t)

	services, connID, _ := liveServices(t, liveRabbitProfile())
	session := mcpSession(t, services, catalog.BlastRead)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	type namespacesResult struct {
		Namespaces []*model.Namespace `json:"namespaces"`
	}
	listed := call[namespacesResult](t, session, "namespaces_list", map[string]any{"connection": connID})
	vhosts, err := services.RabbitMQ.Namespaces(ctx, connID)
	if err != nil {
		t.Fatalf("service layer: %v", err)
	}
	if got, want := namespaceNames(listed.Namespaces), namespaceNames(vhosts); !slices.Equal(got, want) {
		t.Errorf("the tool listed %v and the service %v", got, want)
	}
	if !slices.Contains(namespaceNames(listed.Namespaces), "/") {
		t.Error("the default vhost is not listed")
	}

	type exchangesResult struct {
		Exchanges []*model.Destination `json:"exchanges"`
	}
	exchanges := call[exchangesResult](t, session, "routing_exchanges", map[string]any{
		"connection": connID, "namespace": "/"})
	fromService, err := services.Routing.Exchanges(ctx, connID, "/")
	if err != nil {
		t.Fatalf("service layer: %v", err)
	}
	if got, want := destinationNames(exchanges.Exchanges), destinationNames(fromService); !slices.Equal(got, want) {
		t.Errorf("the tool listed exchanges %v and the service %v", got, want)
	}
	if !slices.Contains(destinationNames(exchanges.Exchanges), "mqs-seed-orders") {
		t.Fatal("the seeded exchange is missing; run npm run e2e:rabbitmq:seed")
	}

	type bindingsResult struct {
		Bindings []*model.Binding `json:"bindings"`
	}
	bindings := call[bindingsResult](t, session, "routing_bindings", map[string]any{
		"connection": connID, "namespace": "/"})
	routes, err := services.Routing.Bindings(ctx, connID, "/")
	if err != nil {
		t.Fatalf("service layer: %v", err)
	}
	if got, want := bindingRoutes(bindings.Bindings), bindingRoutes(routes); !slices.Equal(got, want) {
		t.Errorf("the tool listed bindings %v and the service %v", got, want)
	}
	if !slices.Contains(bindingRoutes(bindings.Bindings), "mqs-seed-orders -> mqs-seed-audit") {
		t.Error("the seeded binding from the orders exchange to the audit queue is missing")
	}
}

func namespaceNames(namespaces []*model.Namespace) []string {
	names := make([]string, 0, len(namespaces))
	for _, namespace := range namespaces {
		if !strings.HasPrefix(namespace.Name, churn) {
			names = append(names, namespace.Name)
		}
	}
	slices.Sort(names)
	return names
}

func destinationNames(destinations []*model.Destination) []string {
	names := make([]string, 0, len(destinations))
	for _, destination := range destinations {
		if !strings.HasPrefix(destination.Ref.Name, churn) {
			names = append(names, destination.Ref.Name)
		}
	}
	slices.Sort(names)
	return names
}

func bindingRoutes(bindings []*model.Binding) []string {
	routes := make([]string, 0, len(bindings))
	for _, binding := range bindings {
		if !strings.HasPrefix(binding.Source, churn) && !strings.HasPrefix(binding.Destination, churn) {
			routes = append(routes, binding.Source+" -> "+binding.Destination)
		}
	}
	slices.Sort(routes)
	return routes
}

const (
	liveKafkaSeeds     = "127.0.0.1:9092,127.0.0.1:9094,127.0.0.1:9096"
	liveKafkaContainer = "mq-studio-e2e-kafka-kafka-1-1"
	liveKafkaTopic     = "mqs-seed-orders"
)

func requireLiveKafka(t *testing.T) {
	t.Helper()
	e2e.Require(t, e2e.Env{
		Name:   "the kafka e2e cluster",
		Family: e2e.Kafka,
		Start:  "npm run e2e:kafka:up && npm run e2e:kafka:seed",
		Probe:  e2e.DockerContainer(liveKafkaContainer),
	})
}

// Partitions and a single message, on the family that has both. The seeded
// orders topic is six partitions replicated three times, so the figures only
// a partition view carries - a leader, the in-sync replicas - are there to
// come back wrong.
func TestLiveMCPReadsPartitionsAndOneMessage(t *testing.T) {
	requireLiveKafka(t)

	services, connID, _ := liveServices(t, model.ConnectionProfile{
		Kind: model.KindKafka, Name: "mcp-live-kafka", Endpoints: liveKafkaSeeds, TimeoutSec: 10,
	})
	session := mcpSession(t, services, catalog.BlastRead)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	type partitionsResult struct {
		Stats struct {
			Partitions []map[string]any `json:"partitions"`
		} `json:"stats"`
	}
	viaTool := callEventually[partitionsResult](t, session, "destination_partitions", map[string]any{
		"connection": connID, "name": liveKafkaTopic})
	var viaService map[string]interface{}
	var err error
	for attempt := 0; attempt < 4; attempt++ {
		if viaService, err = services.Topics.Stats(ctx, connID, model.DestinationRef{Name: liveKafkaTopic}); err == nil {
			break
		}
		time.Sleep(time.Second)
	}
	if err != nil {
		t.Fatalf("service layer: %v", err)
	}
	serviceRows, _ := viaService["partitions"].([]map[string]interface{})
	if len(viaTool.Stats.Partitions) != len(serviceRows) {
		t.Fatalf("the tool read %d partitions and the service %d", len(viaTool.Stats.Partitions), len(serviceRows))
	}
	if len(serviceRows) != 6 {
		t.Fatalf("%s has %d partitions; the seed makes six - run npm run e2e:kafka:seed", liveKafkaTopic, len(serviceRows))
	}
	for _, partition := range viaTool.Stats.Partitions {
		for _, figure := range []string{"leader", "isr", "replicas", "underReplicated"} {
			if _, ok := partition[figure]; !ok {
				t.Errorf("partition %v came back without %s", partition["partition"], figure)
			}
		}
	}

	type messagesResult struct {
		Messages []*model.MessageItem `json:"messages"`
	}
	browsed := callEventually[messagesResult](t, session, "messages_browse", map[string]any{
		"connection": connID, "destination": liveKafkaTopic, "maxResults": 1})
	if len(browsed.Messages) == 0 {
		t.Fatalf("%s holds no messages; run npm run e2e:kafka:seed", liveKafkaTopic)
	}
	named := browsed.Messages[0]

	type messageResult struct {
		Message *model.MessageItem `json:"message"`
	}
	found := callEventually[messageResult](t, session, "message_by_id", map[string]any{
		"connection": connID, "destination": liveKafkaTopic, "messageId": named.MessageID})
	if found.Message == nil || found.Message.MessageID != named.MessageID || found.Message.Body != named.Body {
		t.Fatalf("looked up %q and got %+v", named.MessageID, found.Message)
	}
}

// The cycle again, naming the vhost. Before deleting, the server now checks
// that the broker found the queue inside the namespace it was given, so a
// family that really scopes by one has to be seen getting through.
func TestLiveMCPActsInTheVhostItNames(t *testing.T) {
	requireLiveRabbit(t)

	services, connID, _ := liveServices(t, liveRabbitProfile())
	session := mcpSession(t, services, catalog.BlastDestructive)

	const vhost = "/"
	name := "mq-studio-mcp-vhost-" + strconv.FormatInt(time.Now().UnixNano(), 36)
	ref := model.DestinationRef{Namespace: vhost, Name: name}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		_ = services.Topics.Remove(ctx, connID, ref)
	})

	type writeResult struct {
		Effect struct {
			Changed string `json:"changed"`
		} `json:"effect"`
	}
	created := call[writeResult](t, session, "destination_create", map[string]any{
		"connection": connID, "name": name, "namespace": vhost,
	})
	if want := name + ` in "/" on rabbitmq`; !strings.HasSuffix(created.Effect.Changed, want) {
		t.Errorf("effect %q does not say it landed in the vhost named", created.Effect.Changed)
	}

	type listing struct {
		Destinations []*model.Destination `json:"destinations"`
	}
	listed := call[listing](t, session, "destinations_list", map[string]any{
		"connection": connID, "namespace": vhost,
	})
	found := false
	for _, destination := range listed.Destinations {
		if destination.Ref.Namespace != vhost {
			t.Errorf("%s listed from %q, not the vhost named", destination.Ref.Name, destination.Ref.Namespace)
		}
		found = found || destination.Ref.Name == name
	}
	if !found {
		t.Errorf("%s is not listed in %q", name, vhost)
	}

	call[writeResult](t, session, "destination_delete", map[string]any{
		"connection": connID, "name": name, "namespace": vhost,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := services.Topics.Detail(ctx, connID, ref); err == nil {
		t.Errorf("the tool said it deleted %s in %q and the broker still has it", name, vhost)
	}
}

// awaitDepth reads a destination's depth until it satisfies want, or gives up.
func awaitDepth(
	t *testing.T, services *app.Services, connID int,
	ref model.DestinationRef, want func(int64) bool,
) int64 {
	t.Helper()

	deadline := time.Now().Add(20 * time.Second)
	var depth int64
	for time.Now().Before(deadline) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		destination, err := services.Topics.Detail(ctx, connID, ref)
		cancel()
		if err == nil && destination != nil {
			depth = destination.Depth
			if want(depth) {
				return depth
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
	return depth
}

// A setting this family does not read has to be refused rather than dropped.
// The driver would ignore it and the call would succeed, which is the one
// outcome a caller cannot detect.
func TestLiveMCPRefusesASettingTheFamilyIgnores(t *testing.T) {
	requireLiveRabbit(t)

	services, connID, _ := liveServices(t, liveRabbitProfile())
	session := mcpSession(t, services, catalog.BlastDestructive)

	arguments, err := json.Marshal(map[string]any{
		"connection": connID,
		"name":       "mq-studio-mcp-never-created",
		"attributes": map[string]string{"replicationFactor": "3"},
	})
	if err != nil {
		t.Fatal(err)
	}
	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{
		Name:      "destination_create",
		Arguments: json.RawMessage(arguments),
	})
	if err != nil {
		t.Fatalf("call tool: %v", err)
	}
	if !result.IsError {
		t.Fatal("a setting rabbitmq does not read was accepted")
	}
}

// The default server is the one somebody gets by starting it without thinking
// about it, and it must not be able to write at all.
func TestLiveMCPDefaultServerCannotWrite(t *testing.T) {
	requireLiveRabbit(t)

	services, _, _ := liveServices(t, liveRabbitProfile())
	session := mcpSession(t, services, catalog.BlastRead)

	tools, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatalf("list tools: %v", err)
	}
	for _, tool := range tools.Tools {
		if tool.Annotations == nil || !tool.Annotations.ReadOnlyHint {
			t.Errorf("%s is offered by a default server and is not read-only", tool.Name)
		}
	}
}

/*
 * The two tools that answer why rather than what.
 *
 * RabbitMQ is the family the dead-letter topology port was designed for: there
 * is no per-group dead-letter object to read, so finding one means walking
 * backwards from every queue that declares a dead-letter exchange. A tool that
 * returned an empty list would look exactly like a broker with nothing wrong,
 * which is why this asserts against a seed that has one.
 */
func TestLiveMCPFindsDeadLettersAndProgress(t *testing.T) {
	requireLiveRabbit(t)

	services, connID, _ := liveServices(t, liveRabbitProfile())
	session := mcpSession(t, services, catalog.BlastRead)

	type queuesResult struct {
		Queues []*model.DeadLetterQueue `json:"queues"`
		Caveat string                   `json:"caveat"`
	}
	found := call[queuesResult](t, session, "dead_letter_queues", map[string]any{"connection": connID})
	if len(found.Queues) == 0 {
		t.Fatal("the seed declares a dead-letter exchange and the topology walk found nothing")
	}

	// The seed's dead letters land in a queue of their own; the tool has to
	// name it rather than the queue that feeds it.
	names := make([]string, 0, len(found.Queues))
	for _, queue := range found.Queues {
		names = append(names, queue.Name)
	}
	if !slices.ContainsFunc(names, func(name string) bool {
		return strings.Contains(name, "dlq")
	}) {
		t.Errorf("no dead-letter queue among %v", names)
	}

	/*
	 * And the other half of the same question, which this family answers by
	 * not answering it.
	 *
	 * RabbitMQ declares CapSubscriptionLag - a queue reports its backlog - and
	 * implements no per-partition stats call, because it has no partitions.
	 * Eleven other families declare the same capability and nine of them are
	 * in the same position. The catalogue has to withhold the operation here
	 * rather than offer one that fails when used.
	 */
	type describeResult struct {
		Operations []struct {
			ID   string `json:"id"`
			Tool string `json:"tool"`
		} `json:"operations"`
	}
	described := call[describeResult](t, session, "capabilities_describe",
		map[string]any{"connection": connID})
	for _, operation := range described.Operations {
		if operation.ID == "subscription.lag" {
			t.Errorf("subscription.lag was offered on a family with no per-partition stats (tool %q)",
				operation.Tool)
		}
	}

	// Calling it anyway has to say why, in terms of what this broker does
	// instead - not "unsupported".
	arguments, err := json.Marshal(map[string]any{"connection": connID, "group": "anything"})
	if err != nil {
		t.Fatal(err)
	}
	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{
		Name: "subscription_lag", Arguments: json.RawMessage(arguments),
	})
	if err != nil {
		t.Fatalf("call tool: %v", err)
	}
	if !result.IsError {
		t.Fatal("subscription_lag answered on a family that has no such call")
	}
}
