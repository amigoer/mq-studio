package kafka

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/twmb/franz-go/pkg/kfake"

	"github.com/amigoer/mq-studio/internal/model"
)

// fakeCluster starts an in-process Kafka and returns its bootstrap list.
//
// It exists so the connection paths that matter - a cluster that answers, one
// that rejects a credential, one that is not there - are covered with nothing
// running. A real broker cannot be made to refuse a password on demand without
// a second container, and would not be available at all on a checkout with no
// docker.
func fakeCluster(t *testing.T, options ...kfake.Opt) string {
	t.Helper()
	cluster, err := kfake.NewCluster(options...)
	if err != nil {
		t.Fatalf("start the fake cluster: %v", err)
	}
	t.Cleanup(cluster.Close)
	return strings.Join(cluster.ListenAddrs(), ",")
}

func openProfile(t *testing.T, profile model.ConnectionProfile) *Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	opened, err := New().Open(ctx, profile)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	t.Cleanup(func() { _ = opened.Close() })

	conn, ok := opened.(*Conn)
	if !ok {
		t.Fatalf("Open returned %T, want *kafka.Conn", opened)
	}
	return conn
}

func TestOpenAgainstAReachableCluster(t *testing.T) {
	conn := openProfile(t, model.ConnectionProfile{
		Name:      "fake",
		Endpoints: fakeCluster(t),
	})

	if conn.Kind() != model.KindKafka {
		t.Errorf("kind = %q, want kafka", conn.Kind())
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := conn.Ping(ctx); err != nil {
		t.Fatalf("Ping failed against a running cluster: %v", err)
	}
	for capability, reason := range conn.Capabilities().Degraded {
		t.Errorf("%s was degraded (%s) against a cluster that answers", capability, reason)
	}
}

// A cluster that is not there has to read as unreachable rather than as a
// rejected credential: the two send an operator to completely different
// places, and the address is the one they can fix.
func TestOpenAgainstNothingReportsUnreachable(t *testing.T) {
	conn := openProfile(t, model.ConnectionProfile{
		Name:       "gone",
		Endpoints:  vacatedAddress(t),
		TimeoutSec: 1,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := conn.Ping(ctx); err == nil {
		t.Fatal("Ping succeeded against a cluster that is not running")
	} else if reason := degradeReason(err, false); reason != endpointUnreachable && reason != endpointTimedOut {
		t.Errorf("degrade reason = %q, want unreachable or timed out", reason)
	}
}

// vacatedAddress is an address nothing is listening on. It comes from a
// cluster that has been closed rather than from a guessed port number, so no
// other process can be holding it.
func vacatedAddress(t *testing.T) string {
	t.Helper()
	cluster, err := kfake.NewCluster()
	if err != nil {
		t.Fatalf("start the throwaway cluster: %v", err)
	}
	address := strings.Join(cluster.ListenAddrs(), ",")
	cluster.Close()
	return address
}

func TestPingClassifiesABadCredential(t *testing.T) {
	address := fakeCluster(t,
		kfake.EnableSASL(),
		kfake.Superuser("SCRAM-SHA-512", "admin", "right-password"),
	)

	cases := []struct {
		name     string
		password string
		digest   string
		wantOK   bool
		want     string
	}{
		{name: "the right credential connects", password: "right-password", digest: "512", wantOK: true},
		{name: "a wrong password is a credential problem", password: "wrong-password", digest: "512", want: credentialsRejected},
		{name: "the wrong scram digest is a credential problem too", password: "right-password", digest: "256", want: credentialsRejected},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			conn := openProfile(t, model.ConnectionProfile{
				Name:      "sasl",
				Endpoints: address,
				Auth:      model.AuthConfig{Mechanism: model.AuthSASLScram},
				Options:   map[string]string{OptionSCRAMSHA: test.digest},
				Secrets: map[string]string{
					SecretUsername: "admin",
					SecretPassword: test.password,
				},
			})

			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			err := conn.Ping(ctx)
			if test.wantOK {
				if err != nil {
					t.Fatalf("Ping failed with the right credential: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatal("Ping succeeded with a credential the cluster should refuse")
			}
			if reason := degradeReason(err, true); reason != test.want {
				t.Errorf("degrade reason = %q, want %q (error was %v)", reason, test.want, err)
			}
		})
	}
}

// The service layer puts the request deadline on the context and every driver
// is expected to honour it. franz-go takes a context on every call, so this is
// asserting the driver did not lose it on the way through.
func TestPingHonoursAnExpiredContext(t *testing.T) {
	conn := openProfile(t, model.ConnectionProfile{Name: "fake", Endpoints: fakeCluster(t)})

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	start := time.Now()
	err := conn.Ping(ctx)
	if err == nil {
		t.Fatal("Ping succeeded on a cancelled context")
	}
	if !errors.Is(err, context.Canceled) {
		t.Errorf("error = %v, want context.Canceled", err)
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Errorf("Ping took %v to notice a cancelled context", elapsed)
	}
}

// The registry closes a connection on disconnect and again on shutdown.
func TestCloseIsRepeatable(t *testing.T) {
	conn := openProfile(t, model.ConnectionProfile{Name: "fake", Endpoints: fakeCluster(t)})

	for attempt := 1; attempt <= 3; attempt++ {
		if err := conn.Close(); err != nil {
			t.Fatalf("Close attempt %d failed: %v", attempt, err)
		}
	}
}

// Open reads the profile before it builds anything, so a profile that cannot
// produce a client has to fail here rather than yield a connection that fails
// on its first use.
func TestOpenRefusesAProfileItCannotDial(t *testing.T) {
	cases := []struct {
		name    string
		profile model.ConnectionProfile
	}{
		{"no bootstrap servers", model.ConnectionProfile{Name: "empty"}},
		{
			"an unusable scram digest",
			model.ConnectionProfile{
				Name:      "bad-digest",
				Endpoints: "localhost:9092",
				Auth:      model.AuthConfig{Mechanism: model.AuthSASLScram},
				Options:   map[string]string{OptionSCRAMSHA: "1"},
			},
		},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			conn, err := New().Open(context.Background(), test.profile)
			if err == nil {
				_ = conn.Close()
				t.Fatal("Open succeeded on a profile it cannot dial")
			}
		})
	}
}
