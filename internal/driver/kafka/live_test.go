package kafka

import (
	"context"
	"net"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/model"
)

// liveSeeds is the cluster tests/e2e/kafka brings up: three brokers, each
// advertising its EXTERNAL listener on 127.0.0.1.
//
// Tests skip rather than fail when it is not running, so a checkout without
// docker still has a green suite - but in CI the skip is a failure, because a
// contract test that can silently not run asserts nothing.
const liveSeeds = "127.0.0.1:9092,127.0.0.1:9094,127.0.0.1:9096"

func requireLiveCluster(t *testing.T) {
	t.Helper()
	first := strings.Split(liveSeeds, ",")[0]
	conn, err := net.DialTimeout("tcp", first, 2*time.Second)
	if err != nil {
		if os.Getenv("CI") != "" {
			t.Fatalf("kafka must be running in CI: %v", err)
		}
		t.Skipf("kafka is not running; start it with npm run e2e:kafka:up (%v)", err)
	}
	_ = conn.Close()
}

func liveConn(t *testing.T, endpoints string) *Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	opened, err := New().Open(ctx, model.ConnectionProfile{
		Name:       "live",
		Endpoints:  endpoints,
		TimeoutSec: 5,
	})
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	t.Cleanup(func() { _ = opened.Close() })
	return opened.(*Conn)
}

func TestLiveConnect(t *testing.T) {
	requireLiveCluster(t)
	conn := liveConn(t, liveSeeds)

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := conn.Ping(ctx); err != nil {
		t.Fatalf("Ping failed against the live cluster: %v", err)
	}
	for capability, reason := range conn.Capabilities().Degraded {
		t.Errorf("%s was degraded (%s) against a cluster that answers", capability, reason)
	}
}

// Each broker advertises its own EXTERNAL address, and a client bootstrapping
// on one is handed the other two. If a single advertised listener is wrong,
// bootstrapping on the healthy one still works and the fault only shows up
// later as a partition nobody can reach - so each is dialled on its own.
func TestLiveEveryBrokerIsReachableOnItsOwn(t *testing.T) {
	requireLiveCluster(t)

	for _, seed := range strings.Split(liveSeeds, ",") {
		t.Run(seed, func(t *testing.T) {
			conn := liveConn(t, seed)
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			if err := conn.Ping(ctx); err != nil {
				t.Errorf("Ping through %s failed: %v", seed, err)
			}
		})
	}
}

// A profile pointed at a port nothing serves must report the address, not the
// credential. The inverse of the SASL case: those two reasons send an operator
// to different halves of the form.
func TestLiveWrongPortIsNotReportedAsACredentialProblem(t *testing.T) {
	requireLiveCluster(t)

	// The controller listener. Something is listening, so this is not a
	// refused dial - it just does not speak the client protocol.
	conn := liveConn(t, "127.0.0.1:19093")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err := conn.Ping(ctx)
	if err == nil {
		t.Fatal("Ping succeeded against a port that serves no client listener")
	}
	if reason := degradeReason(err, conn.authenticating); reason == credentialsRejected {
		t.Errorf("a wrong port was reported as a credential problem (error was %v)", err)
	}
}

// The connect timeout the form collects has to bound a real dial, not just sit
// in the profile. A blackholed address is the only way to see that: a refused
// connection returns at once whatever the timeout says.
func TestLiveDialTimeoutIsHonoured(t *testing.T) {
	requireLiveCluster(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	opened, err := New().Open(ctx, model.ConnectionProfile{
		Name: "blackhole",
		// TEST-NET-1. Reserved for documentation, routed nowhere.
		Endpoints:  "192.0.2.1:9092",
		TimeoutSec: 1,
	})
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer func() { _ = opened.Close() }()

	start := time.Now()
	pingCtx, pingCancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer pingCancel()
	if err := opened.(*Conn).Ping(pingCtx); err == nil {
		t.Fatal("Ping succeeded against an unrouted address")
	}
	// Generous: franz-go may try the seed more than once. What is being
	// asserted is that a 1s dial timeout is in force at all, rather than the
	// operating system's own multi-minute one.
	if elapsed := time.Since(start); elapsed > 15*time.Second {
		t.Errorf("Ping took %v against an unrouted address; the dial timeout is not in force", elapsed)
	}
}
