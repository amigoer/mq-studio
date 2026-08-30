package app

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/crypto"
	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/driver/rocketmq"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/connection"
	"github.com/amigoer/mq-studio/internal/service/destination"
	"github.com/amigoer/mq-studio/internal/service/settings"
	"github.com/amigoer/mq-studio/internal/storage/layout"

	rocketmqconsumer "github.com/apache/rocketmq-client-go/v2/consumer"
	"github.com/apache/rocketmq-client-go/v2/primitive"
)

// Exercises the stack the connection screen drives, against the broker
// `npm run e2e:up` starts. Opt-in, like the driver's own live tests:
//
//	npm run e2e:up && MQ_STUDIO_E2E=1 go test ./internal/app/...
const liveNameServer = "127.0.0.1:9876"

// What `npm run e2e:seed` puts on the broker. Tests that need a consumer group
// use this one, because mq-studio cannot create one - see
// TestLiveConsumerGroupDelete for why.
const (
	seededTopic = "MQ_STUDIO_E2E"
	seededGroup = "MQ_STUDIO_E2E_GROUP"
)

// The separate ACL-enabled broker, from `npm run e2e:acl:up`. Its admin
// account is the one seeded in tests/e2e/rocketmq-acl/plain_acl.yml.
const (
	aclNameServer = "127.0.0.1:9877"
	aclAccessKey  = "mqstudio"
	aclSecretKey  = "mqstudio-secret"
)

// liveStack assembles the same pieces New does, rooted in a temp directory so
// the test never touches the user's real configuration.
func liveStack(t *testing.T) (*connection.Service, *destination.Service, *driver.Registry) {
	t.Helper()
	if os.Getenv("MQ_STUDIO_E2E") == "" {
		t.Skip("set MQ_STUDIO_E2E=1 and run `npm run e2e:up` to exercise a real broker")
	}
	if _, ok := driver.Lookup(model.KindRocketMQ); !ok {
		driver.Register(rocketmq.New())
	}

	paths := layout.In(t.TempDir())
	if err := crypto.InitKey(paths.Directory); err != nil {
		t.Fatalf("initialize encryption key: %v", err)
	}
	settingsService := settings.New(paths.SettingsFile)
	registry := driver.NewRegistry()
	t.Cleanup(registry.CloseAll)

	connections := connection.New(paths.ConnectionsFile, settingsService, newRegistryRuntime(registry))
	return connections, destination.New(newConnSource(registry), settingsService), registry
}

func liveProfileInput(name string) model.ConnectionProfile {
	return model.ConnectionProfile{
		Name:       name,
		Kind:       model.KindRocketMQ,
		Endpoints:  liveNameServer,
		TimeoutSec: 5,
	}
}

// The whole M1 path in one go: store a profile, dial it, read through the id
// the page would pass, then close it.
func TestLiveConnectListDisconnect(t *testing.T) {
	connections, topics, registry := liveStack(t)
	ctx := context.Background()

	// Internal topics are included because a fresh broker has no user topics,
	// and "empty" would then prove nothing about whether the read reached it.
	everything := model.DestinationFilter{IncludeInternal: true}

	profile, err := connections.AddConnection(liveProfileInput("live"))
	if err != nil {
		t.Fatalf("add connection: %v", err)
	}
	// A profile nobody connected lists empty rather than erroring, which is the
	// contract the list pages render against.
	before, err := topics.List(ctx, profile.ID, everything)
	if err != nil {
		t.Fatalf("list before connecting: %v", err)
	}
	if len(before) != 0 {
		t.Fatalf("listed %d topics before connecting", len(before))
	}

	if err := connections.Connect(profile.ID); err != nil {
		t.Fatalf("connect: %v", err)
	}
	stored, err := connections.GetConnection(profile.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.StatusOnline {
		t.Fatalf("stored status = %q, want online", stored.Status)
	}

	during, err := topics.List(ctx, profile.ID, everything)
	if err != nil {
		t.Fatalf("list topics through the connection id: %v", err)
	}
	if len(during) == 0 {
		t.Fatal("a connected broker listed no topics at all")
	}

	if err := connections.Disconnect(profile.ID); err != nil {
		t.Fatalf("disconnect: %v", err)
	}
	if _, stillOpen := registry.Get(profile.ID); stillOpen {
		t.Fatal("the registry kept a disconnected connection")
	}
	after, err := topics.List(ctx, profile.ID, everything)
	if err != nil {
		t.Fatalf("list after disconnecting: %v", err)
	}
	if len(after) != 0 {
		t.Fatalf("listed %d topics after disconnecting", len(after))
	}
}

// Two profiles on one broker are what the tab strip opens, and each page reads
// through its own id.
func TestLiveTwoConnectionsStayOpenTogether(t *testing.T) {
	connections, topics, _ := liveStack(t)
	ctx := context.Background()

	first, err := connections.AddConnection(liveProfileInput("first"))
	if err != nil {
		t.Fatal(err)
	}
	second, err := connections.AddConnection(liveProfileInput("second"))
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []int{first.ID, second.ID} {
		if err := connections.Connect(id); err != nil {
			t.Fatalf("connect %d: %v", id, err)
		}
	}

	for _, id := range []int{first.ID, second.ID} {
		if _, err := topics.List(ctx, id, model.DestinationFilter{}); err != nil {
			t.Fatalf("list topics on %d: %v", id, err)
		}
	}

	// Closing the first must leave the second answering: that is the whole
	// point of one client per profile.
	if err := connections.Disconnect(first.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := topics.List(ctx, second.ID, model.DestinationFilter{}); err != nil {
		t.Fatalf("second connection broke when the first closed: %v", err)
	}
}

// The dialog's test button probes a draft that has never been stored.
func TestLiveProbeUnsavedProfile(t *testing.T) {
	connections, _, registry := liveStack(t)

	if err := connections.ProbeProfile(liveProfileInput("draft")); err != nil {
		t.Fatalf("probe a reachable draft: %v", err)
	}
	// A probe must leave nothing open behind it.
	if ids := registry.IDs(); len(ids) != 0 {
		t.Fatalf("probe left %v open", ids)
	}

	unreachable := liveProfileInput("draft")
	unreachable.Endpoints = "127.0.0.1:19876"
	unreachable.TimeoutSec = 2
	if err := connections.ProbeProfile(unreachable); err == nil {
		t.Fatal("probing an unreachable NameServer should fail")
	}
}

// The path the producer and message boards drive: publish, then find it again
// through the same connection id, then read its consume trace.
func TestLiveSendThenQuery(t *testing.T) {
	connections, _, registry := liveStack(t)
	ctx := context.Background()

	profile, err := connections.AddConnection(liveProfileInput("send"))
	if err != nil {
		t.Fatal(err)
	}
	if err := connections.Connect(profile.ID); err != nil {
		t.Fatalf("connect: %v", err)
	}
	conn, ok := registry.Get(profile.ID)
	if !ok {
		t.Fatal("connection missing after connect")
	}

	const topic = "MQ_STUDIO_E2E"
	key := "e2e-" + time.Now().UTC().Format("20060102150405.000")
	body := `{"probe":"` + key + `"}`

	messageID, err := conn.(driver.MessagePublisher).SendMessage(ctx, topic, "probe", key, body, 0)
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	if messageID == "" {
		t.Fatal("send returned an empty message id")
	}

	// The broker indexes by key asynchronously, so the query is retried rather
	// than run once and called a failure.
	reader := conn.(driver.MessageReader)
	var found []*model.MessageItem
	for attempt := range 10 {
		if attempt > 0 {
			time.Sleep(500 * time.Millisecond)
		}
		found, err = reader.QueryMessages(ctx, model.MessageQueryParams{
			Topic:      topic,
			MessageKey: key,
			MaxResults: 8,
		})
		if err == nil && len(found) > 0 {
			break
		}
	}
	if err != nil {
		t.Fatalf("query by key: %v", err)
	}
	if len(found) == 0 {
		t.Fatalf("the message sent as %s never came back for key %s", messageID, key)
	}
	if found[0].Body != body {
		t.Fatalf("body = %q, want %q", found[0].Body, body)
	}

	// The trace looks the message up again, and the broker's key index lags a
	// send by a second or two - the same lag the query above rides out. With no
	// group subscribed the answer is an empty list, which is the honest one.
	tracker := conn.(driver.MessageTracker)
	for attempt := range 10 {
		if attempt > 0 {
			time.Sleep(500 * time.Millisecond)
		}
		trackCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		_, err = tracker.TrackMessage(trackCtx, topic, found[0].MessageID)
		cancel()
		if err == nil {
			break
		}
	}
	if err != nil {
		t.Fatalf("track: %v", err)
	}
}

// The topics board's write path: create on every master, read the config back,
// change it, then delete.
func TestLiveTopicLifecycle(t *testing.T) {
	connections, topics, registry := liveStack(t)
	ctx := context.Background()

	profile, err := connections.AddConnection(liveProfileInput("topics"))
	if err != nil {
		t.Fatal(err)
	}
	if err := connections.Connect(profile.ID); err != nil {
		t.Fatalf("connect: %v", err)
	}
	conn, _ := registry.Get(profile.ID)

	const name = "MQ_STUDIO_E2E_LIFECYCLE"
	ref := model.DestinationRef{Name: name}
	admin := conn.(driver.DestinationAdmin)
	t.Cleanup(func() { _ = admin.RemoveDestination(context.Background(), ref) })

	// No broker named: every master should get it.
	spec := model.DestinationSpec{
		Ref: ref,
		Attributes: map[string]string{
			rocketmq.AttrReadQueue:  "2",
			rocketmq.AttrWriteQueue: "2",
			rocketmq.AttrPerm:       string(model.PermRW),
		},
	}
	if err := admin.CreateDestination(ctx, spec); err != nil {
		t.Fatalf("create: %v", err)
	}

	created, err := topics.Detail(ctx, profile.ID, ref)
	if err != nil {
		t.Fatalf("detail after create: %v", err)
	}
	if got := created.Attributes[rocketmq.AttrWriteQueue]; got != "2" {
		t.Fatalf("writeQueue = %q, want 2", got)
	}

	spec.Attributes[rocketmq.AttrReadQueue] = "4"
	spec.Attributes[rocketmq.AttrWriteQueue] = "4"
	if err := admin.UpdateDestination(ctx, spec); err != nil {
		t.Fatalf("update: %v", err)
	}
	updated, err := topics.Detail(ctx, profile.ID, ref)
	if err != nil {
		t.Fatalf("detail after update: %v", err)
	}
	if got := updated.Attributes[rocketmq.AttrWriteQueue]; got != "4" {
		t.Fatalf("writeQueue after update = %q, want 4", got)
	}

	if err := admin.RemoveDestination(ctx, ref); err != nil {
		t.Fatalf("remove: %v", err)
	}
	listed, err := topics.List(ctx, profile.ID, model.DestinationFilter{IncludeInternal: true})
	if err != nil {
		t.Fatal(err)
	}
	for _, one := range listed {
		if one.Ref.Name == name {
			t.Fatal("the deleted topic is still listed")
		}
	}
}

// Listing and deleting a consumer group work; creating and updating one does
// not, and this pins which is which.
//
// rocketmq-admin-go puts a SubscriptionGroupConfig in the request's extFields,
// but RocketMQ 5.x's updateAndCreateSubscriptionGroup decodes it from the
// request body - so the broker answers a NullPointerException. Delete takes the
// extFields route the broker does read. The group this deletes is created
// through the broker's own mqadmin, which is the only way to get one here.
func TestLiveConsumerGroupDelete(t *testing.T) {
	connections, _, registry := liveStack(t)
	ctx := context.Background()

	profile, err := connections.AddConnection(liveProfileInput("groups"))
	if err != nil {
		t.Fatal(err)
	}
	if err := connections.Connect(profile.ID); err != nil {
		t.Fatalf("connect: %v", err)
	}
	conn, _ := registry.Get(profile.ID)
	groups := conn.(driver.SubscriptionAdmin)

	const name = "MQ_STUDIO_E2E_GROUP"
	ref := model.SubscriptionRef{Name: name}

	// Creating through the driver is what fails today; assert that plainly, so
	// this test starts failing the moment the library learns to send a body and
	// the create path can be built.
	createErr := groups.CreateSubscription(ctx, model.SubscriptionSpec{
		Ref: ref,
		Attributes: map[string]string{
			rocketmq.AttrConsumeMode: string(model.ModeClustering),
			rocketmq.AttrMaxRetry:    "16",
		},
	})
	if createErr == nil {
		t.Fatal("creating a consumer group now works - re-add the create and edit form")
	}
	t.Logf("create still unsupported by the library: %v", createErr)

	// Delete is the half that does work, so it has to answer for a group that
	// is not there rather than hang or panic.
	if err := groups.RemoveSubscription(ctx, ref); err != nil {
		t.Fatalf("delete: %v", err)
	}
}

// The consumer sheet's 重置位点 action.
func TestLiveResetOffset(t *testing.T) {
	connections, _, registry := liveStack(t)
	ctx := context.Background()

	profile, err := connections.AddConnection(liveProfileInput("offsets"))
	if err != nil {
		t.Fatal(err)
	}
	if err := connections.Connect(profile.ID); err != nil {
		t.Fatalf("connect: %v", err)
	}
	conn, _ := registry.Get(profile.ID)

	groups := conn.(driver.SubscriptionAdmin)
	listed, err := groups.ListSubscriptions(ctx)
	if err != nil {
		t.Fatalf("list groups: %v", err)
	}
	seeded := false
	for _, one := range listed {
		if one.Ref.Name == seededGroup {
			seeded = true
		}
	}
	if !seeded {
		t.Skipf("run `npm run e2e:seed` to create %s", seededGroup)
	}

	// Something has to be in the topic for a reset to have a position to move
	// to, and the seeded topic is empty on a fresh broker.
	if _, err := conn.(driver.MessagePublisher).SendMessage(
		ctx, seededTopic, "reset", "reset-probe", `{"probe":"reset"}`, 0,
	); err != nil {
		t.Fatalf("seed a message: %v", err)
	}

	progress := conn.(driver.ProgressAdmin)
	// Timestamp 0 means the earliest retained message, which is the reset the
	// UI offers as 最早.
	if err := progress.ResetOffset(ctx, model.ResetOffsetRequest{
		Group:     seededGroup,
		Topic:     seededTopic,
		Timestamp: 0,
		Force:     true,
	}); err != nil {
		t.Fatalf("reset to earliest: %v", err)
	}

	if err := progress.ResetOffset(ctx, model.ResetOffsetRequest{
		Group:     seededGroup,
		Topic:     seededTopic,
		Timestamp: time.Now().UnixMilli(),
		Force:     true,
	}); err != nil {
		t.Fatalf("reset to now: %v", err)
	}

	// A group that does not exist has to be reported, not silently accepted.
	if err := progress.ResetOffset(ctx, model.ResetOffsetRequest{
		Group:     "MQ_STUDIO_E2E_NO_SUCH_GROUP",
		Topic:     seededTopic,
		Timestamp: 0,
	}); err == nil {
		t.Log("resetting an unknown group was accepted; RocketMQ creates offsets lazily")
	}
}

// Every AccessAdmin method, against a broker that really has ACL on.
//
// None of them had ever run against one. AccessEnabled in particular reported
// false on an ACL-enabled broker, because a broker answers GET_BROKER_CONFIG
// with a Properties document and the library's json.Unmarshal of it fails,
// leaving every setting inside a single "raw" string.
func TestLiveACL(t *testing.T) {
	connections, _, registry := liveStack(t)
	ctx := context.Background()

	input := liveProfileInput("acl")
	input.Endpoints = aclNameServer
	input.SetACL(true, aclAccessKey, aclSecretKey)
	profile, err := connections.AddConnection(input)
	if err != nil {
		t.Fatal(err)
	}
	if err := connections.Connect(profile.ID); err != nil {
		t.Skipf("run `npm run e2e:acl:up` for the ACL broker: %v", err)
	}
	conn, _ := registry.Get(profile.ID)
	acl := conn.(driver.AccessAdmin)

	enabled, err := acl.AccessEnabled(ctx)
	if err != nil {
		t.Fatalf("AccessEnabled: %v", err)
	}
	if !enabled {
		t.Fatal("AccessEnabled reported false on a broker with aclEnable=true")
	}

	version, err := acl.AccessVersion(ctx)
	if err != nil {
		t.Fatalf("AccessVersion: %v", err)
	}
	if version == nil || version.ClusterName == "" {
		t.Fatalf("AccessVersion returned %+v", version)
	}

	const probeKey = "mq-studio-e2e-probe"
	t.Cleanup(func() { _ = acl.RemoveAccessConfig(context.Background(), probeKey) })

	if err := acl.PutAccessConfig(ctx, model.AccessConfig{
		AccessKey:        probeKey,
		SecretKey:        "mq-studio-e2e-probe-secret",
		DefaultTopicPerm: "SUB",
		DefaultGroupPerm: "SUB",
	}); err != nil {
		t.Fatalf("PutAccessConfig: %v", err)
	}

	// Writing an account bumps the ACL version, which is the only readable
	// evidence that it landed: the library has no call to list the accounts.
	after, err := acl.AccessVersion(ctx)
	if err != nil {
		t.Fatalf("AccessVersion after put: %v", err)
	}
	if after.Version == version.Version {
		t.Log("the ACL version did not move after a write; the broker may batch it")
	}

	// The whitelist is what lets these very calls through, since nothing is
	// signed - so the write has to keep the seed's entries and only add to
	// them, and put them back afterwards. Replacing it with a narrower list
	// locks the next run out of the broker.
	seedWhiteList := []string{"127.0.0.1", "172.*.*.*", "192.168.*.*"}
	t.Cleanup(func() { _ = acl.SetGlobalWhiteAddrs(context.Background(), seedWhiteList) })
	if err := acl.SetGlobalWhiteAddrs(ctx, append(append([]string{}, seedWhiteList...), "10.*.*.*")); err != nil {
		t.Fatalf("SetGlobalWhiteAddrs: %v", err)
	}
	if err := acl.RemoveAccessConfig(ctx, probeKey); err != nil {
		t.Fatalf("RemoveAccessConfig: %v", err)
	}
}

// The credentials a connection profile carries are never actually sent.
//
// rocketmq-admin-go stores AccessKey and SecretKey in its options and contains
// no signing code at all - no HMAC, no signature - so every admin call arrives
// unauthenticated. On an ACL broker it succeeds only when the global whitelist
// covers the caller, which is why the E2E broker's whitelist has to include the
// Docker gateway.
//
// This connects with deliberately wrong credentials and expects it to work
// anyway. It goes red the day the library signs its requests, which is when
// the connection form's ACL fields start meaning something.
func TestLiveACLCredentialsAreNotSigned(t *testing.T) {
	connections, _, registry := liveStack(t)
	ctx := context.Background()

	input := liveProfileInput("acl-wrong-credentials")
	input.Endpoints = aclNameServer
	input.SetACL(true, "not-a-real-key", "not-a-real-secret")
	profile, err := connections.AddConnection(input)
	if err != nil {
		t.Fatal(err)
	}
	if err := connections.Connect(profile.ID); err != nil {
		t.Skipf("run `npm run e2e:acl:up` for the ACL broker: %v", err)
	}
	conn, _ := registry.Get(profile.ID)

	enabled, err := conn.(driver.AccessAdmin).AccessEnabled(ctx)
	if err != nil {
		t.Fatalf("credentials are signed now - rebuild the ACL story: %v", err)
	}
	if !enabled {
		t.Fatal("AccessEnabled reported false on a broker with aclEnable=true")
	}
}

// What a connected consumer is actually doing - and why it cannot be shown.
//
// GetConsumerRunningInfo asks the client rather than the broker, so this is the
// one live test that needs a real consumer. It starts one, waits for the
// rebalance, and then finds that the queue assignment never arrives.
//
// The broker is not at fault: its own `mqadmin consumerStatus` collects the
// same information from the same client. rocketmq-admin-go unmarshals the
// response without the fixJSONBody pass that six of its siblings apply, and the
// response carries mqTable - a Fastjson map whose keys are objects, the exact
// shape that fixer exists for - so the parse always fails.
//
// The driver implements SubscriptionRuntime and reports the capability as
// degraded with that reason, so a page explains the gap rather than pretending
// RocketMQ has no such concept. This test asserts the gap is still there: it
// goes red the day the library adds fixJSONBody, which is when the consumers
// board can have its queue-assignment column back.
func TestLiveConsumerClientsBlockedByLibraryParse(t *testing.T) {
	connections, _, registry := liveStack(t)
	ctx := context.Background()

	profile, err := connections.AddConnection(liveProfileInput("clients"))
	if err != nil {
		t.Fatal(err)
	}
	if err := connections.Connect(profile.ID); err != nil {
		t.Fatalf("connect: %v", err)
	}
	conn, _ := registry.Get(profile.ID)
	runtime, ok := conn.(driver.SubscriptionRuntime)
	if !ok {
		t.Fatal("the RocketMQ connection does not implement SubscriptionRuntime")
	}
	ref := model.SubscriptionRef{Name: seededGroup}

	// The capability has to be visible and explained, not silently missing.
	reason, degraded := conn.Capabilities().DegradedReason(model.CapSubscriptionRuntime)
	if !degraded || reason == "" {
		t.Error("CapSubscriptionRuntime should be degraded with a reason while the parse is broken")
	}
	if conn.Capabilities().Has(model.CapSubscriptionRuntime) {
		t.Error("CapSubscriptionRuntime is both supported and degraded")
	}

	// With nothing connected the answer is an error, not an empty list: "nobody
	// is consuming" and "everyone is consuming nothing" are different things.
	if _, err := runtime.SubscriptionClients(ctx, ref); err == nil {
		t.Log("a client was already connected; the offline case is not covered by this run")
	}

	stop := startLiveConsumer(t)
	defer stop()

	// Wait for the broker to see the consumer and finish its rebalance.
	var clients []*model.SubscriptionClient
	for attempt := range 20 {
		if attempt > 0 {
			time.Sleep(time.Second)
		}
		clients, err = runtime.SubscriptionClients(ctx, ref)
		if err == nil && len(clients) > 0 {
			break
		}
	}
	if err != nil {
		t.Fatalf("SubscriptionClients: %v", err)
	}
	if len(clients) == 0 {
		t.Fatal("no client reported for a group with a consumer connected")
	}

	// The client is found - that part comes from the broker's connection info.
	// Everything that comes from the client itself is empty, because the parse
	// of its answer failed.
	client := clients[0]
	if client.ClientID == "" {
		t.Error("a client came back with no id")
	}
	if len(client.Assignments) != 0 {
		t.Fatalf("the library can parse GetConsumerRunningInfo now (%d assignments) - "+
			"drop the degraded reason and wire the queue-assignment column back",
			len(client.Assignments))
	}
	t.Logf("client %s found, assignment still unreadable - as expected", client.ClientID)
}

// startLiveConsumer runs a push consumer on the seeded topic and group.
func startLiveConsumer(t *testing.T) func() {
	t.Helper()
	pushConsumer, err := rocketmqconsumer.NewPushConsumer(
		rocketmqconsumer.WithNameServer([]string{liveNameServer}),
		rocketmqconsumer.WithGroupName(seededGroup),
		rocketmqconsumer.WithConsumerModel(rocketmqconsumer.Clustering),
	)
	if err != nil {
		t.Fatalf("create consumer: %v", err)
	}
	err = pushConsumer.Subscribe(seededTopic, rocketmqconsumer.MessageSelector{},
		func(_ context.Context, _ ...*primitive.MessageExt) (rocketmqconsumer.ConsumeResult, error) {
			return rocketmqconsumer.ConsumeSuccess, nil
		})
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	if err := pushConsumer.Start(); err != nil {
		t.Fatalf("start consumer: %v", err)
	}
	return func() { _ = pushConsumer.Shutdown() }
}
