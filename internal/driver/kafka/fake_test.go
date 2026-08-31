package kafka

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/twmb/franz-go/pkg/kfake"
	"github.com/twmb/franz-go/pkg/kmsg"

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

/*
 * A credential is not written until the cluster will admit it exists.
 *
 * Kafka stores a SCRAM credential in the metadata log and answers a describe
 * from whichever broker took the request, so "created" and "visible" are two
 * different instants. A create that returned at the first one left the access
 * page listing users without the one just added - which reads as a create that
 * silently failed. It showed up as a live test failing only under load, so it
 * is pinned here where the delay can be made to happen on purpose.
 */
func TestCreatingAUserWaitsUntilTheClusterListsIt(t *testing.T) {
	cluster, err := kfake.NewCluster()
	if err != nil {
		t.Fatalf("start the fake cluster: %v", err)
	}
	t.Cleanup(cluster.Close)

	const quiet = 2
	describes := 0
	cluster.ControlKey(kmsg.DescribeUserSCRAMCredentials.Int16(),
		func(request kmsg.Request) (kmsg.Response, error, bool) {
			cluster.KeepControl()
			describes++
			if describes > quiet {
				// Hand it back to the cluster, which now answers truthfully.
				return nil, nil, false
			}
			// The credential exists and this broker has not heard: a user with
			// no credentials, which is what a describe returns before the
			// record is applied.
			asked := request.(*kmsg.DescribeUserSCRAMCredentialsRequest)
			answer := asked.ResponseKind().(*kmsg.DescribeUserSCRAMCredentialsResponse)
			for _, user := range asked.Users {
				answer.Results = append(answer.Results,
					kmsg.DescribeUserSCRAMCredentialsResponseResult{User: user.Name})
			}
			return answer, nil, true
		})

	conn := openProfile(t, model.ConnectionProfile{
		Name:      "fake",
		Endpoints: strings.Join(cluster.ListenAddrs(), ","),
	})
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	if err := conn.PutPrincipal(ctx, model.AccessPrincipalSpec{
		Name: "alice", Secret: "a-password", Type: "SCRAM-SHA-512",
	}); err != nil {
		t.Fatalf("PutPrincipal: %v", err)
	}
	if describes <= quiet {
		t.Fatalf("the create returned after %d describe(s); it did not wait for the cluster", describes)
	}

	// And the thing the waiting is for: the page lists the user immediately
	// after the create, with no refresh and no retry of its own.
	principals, err := conn.ListPrincipals(ctx)
	if err != nil {
		t.Fatalf("ListPrincipals: %v", err)
	}
	for _, principal := range principals {
		if principal.Name == "alice" {
			return
		}
	}
	t.Fatalf("the user is not listed straight after being created: %v", principals)
}

// The same lag on the other half of the access page. An authorizer writes its
// rules to the metadata log too, and a describe answered before the record is
// applied showed the list without the rule just written.
func TestWritingARuleWaitsUntilTheClusterListsIt(t *testing.T) {
	cluster, err := kfake.NewCluster()
	if err != nil {
		t.Fatalf("start the fake cluster: %v", err)
	}
	t.Cleanup(cluster.Close)

	const quiet = 2
	describes := 0
	cluster.ControlKey(kmsg.DescribeACLs.Int16(),
		func(request kmsg.Request) (kmsg.Response, error, bool) {
			cluster.KeepControl()
			describes++
			if describes > quiet {
				return nil, nil, false
			}
			// No rules yet: what a broker that has not applied the record says.
			return request.ResponseKind().(*kmsg.DescribeACLsResponse), nil, true
		})

	conn := openProfile(t, model.ConnectionProfile{
		Name:      "fake",
		Endpoints: strings.Join(cluster.ListenAddrs(), ","),
	})
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	const subject = "User:alice"
	if err := conn.PutAccessRule(ctx, model.AccessRule{
		Subject:  subject,
		Policies: []model.AccessPolicy{{Resource: "topic:orders", Actions: []string{"READ"}, Effect: "Allow"}},
	}); err != nil {
		t.Fatalf("PutAccessRule: %v", err)
	}
	if describes <= quiet {
		t.Fatalf("the write returned after %d describe(s); it did not wait for the cluster", describes)
	}

	rules, err := conn.ListAccessRules(ctx)
	if err != nil {
		t.Fatalf("ListAccessRules: %v", err)
	}
	for _, rule := range rules {
		if rule.Subject == subject {
			return
		}
	}
	t.Fatalf("the rule is not listed straight after being written: %v", rules)
}
