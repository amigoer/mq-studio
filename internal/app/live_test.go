package app

import (
	"context"
	"os"
	"testing"

	"github.com/amigoer/mq-studio/internal/crypto"
	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/driver/rocketmq"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/connection"
	"github.com/amigoer/mq-studio/internal/service/destination"
	"github.com/amigoer/mq-studio/internal/service/settings"
	"github.com/amigoer/mq-studio/internal/storage/layout"
)

// Exercises the stack the connection screen drives, against the broker
// `npm run e2e:up` starts. Opt-in, like the driver's own live tests:
//
//	npm run e2e:up && MQ_STUDIO_E2E=1 go test ./internal/app/...
const liveNameServer = "127.0.0.1:9876"

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
