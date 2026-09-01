package rocketmq_test

import (
	"context"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/driver/rocketmq"
	"github.com/amigoer/mq-studio/internal/e2e"
	"github.com/amigoer/mq-studio/internal/model"
)

// These run against the broker `npm run e2e:up` starts. Locally they are
// opt-in, so the rest of the suite passes with nothing listening; CI starts
// the broker and the opt-in does not apply there. See internal/e2e.
//
//	npm run e2e:up && MQ_STUDIO_E2E=1 go test ./internal/driver/rocketmq/...
const liveNameServer = "127.0.0.1:9876"

func liveContext(t *testing.T) context.Context {
	t.Helper()
	e2e.Require(t, e2e.Env{
		Name:  "the rocketmq broker",
		Start: "npm run e2e:up",
		Probe: e2e.DialTCP(liveNameServer),
	})
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func liveProfile(id int, name string) model.ConnectionProfile {
	return model.ConnectionProfile{
		ID:         id,
		Name:       name,
		Kind:       model.KindRocketMQ,
		Endpoints:  liveNameServer,
		TimeoutSec: 5,
	}
}

func newLiveRegistry(t *testing.T) *driver.Registry {
	t.Helper()
	// Register is process-wide and panics on a duplicate, so it is done once
	// here rather than per test.
	if _, ok := driver.Lookup(model.KindRocketMQ); !ok {
		driver.Register(rocketmq.New())
	}
	registry := driver.NewRegistry()
	t.Cleanup(registry.CloseAll)
	return registry
}

// The case the shared client got wrong: two profiles naming one NameServer are
// two connections, and closing either must leave the other working.
func TestLiveTwoProfilesOnOneNameServerAreIndependent(t *testing.T) {
	ctx := liveContext(t)
	registry := newLiveRegistry(t)

	for _, profile := range []model.ConnectionProfile{liveProfile(1, "first"), liveProfile(2, "second")} {
		if err := registry.Open(ctx, profile); err != nil {
			t.Fatalf("open %s: %v", profile.Name, err)
		}
	}

	first, ok := registry.Get(1)
	if !ok {
		t.Fatal("connection 1 is missing from the registry")
	}
	second, ok := registry.Get(2)
	if !ok {
		t.Fatal("connection 2 is missing from the registry")
	}
	if first == second {
		t.Fatal("both profiles resolved to the same connection")
	}

	if _, err := first.(driver.DestinationAdmin).ListDestinations(ctx, model.DestinationFilter{}); err != nil {
		t.Fatalf("list topics on connection 1: %v", err)
	}

	registry.Close(1)
	if _, stillOpen := registry.Get(1); stillOpen {
		t.Fatal("a closed connection is still in the registry")
	}
	if _, err := second.(driver.ClusterAdmin).ClusterOverview(ctx); err != nil {
		t.Fatalf("connection 2 broke when connection 1 closed: %v", err)
	}
}

// Reopening under the same id is what reconnecting from the UI does.
func TestLiveReopenUnderTheSameID(t *testing.T) {
	ctx := liveContext(t)
	registry := newLiveRegistry(t)

	for attempt := range 2 {
		if err := registry.Open(ctx, liveProfile(1, "first")); err != nil {
			t.Fatalf("open attempt %d: %v", attempt+1, err)
		}
	}
	conn, ok := registry.Get(1)
	if !ok {
		t.Fatal("connection missing after reopen")
	}
	if err := conn.Ping(ctx); err != nil {
		t.Fatalf("ping after reopen: %v", err)
	}
}

// A Proxy endpoint has no admin plane, so it is refused with an explanation
// rather than dialled and failing somewhere deep in the first admin call.
func TestLiveProxyProfileIsRefused(t *testing.T) {
	ctx := liveContext(t)
	registry := newLiveRegistry(t)

	profile := liveProfile(3, "proxy")
	profile.SetOption(rocketmq.OptionAccess, rocketmq.AccessProxy)
	if err := registry.Open(ctx, profile); err == nil {
		t.Fatal("a Proxy profile was accepted")
	}
}
