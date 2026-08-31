package rabbitmq

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/model"
)

// probeAgainst opens a connection against one endpoint and reports the reason
// every capability was degraded with, or "" when none was.
func probeAgainst(t *testing.T, endpoint string, timeoutSec int) string {
	t.Helper()
	profile := model.ConnectionProfile{
		Kind:       model.KindRabbitMQ,
		Endpoints:  endpoint,
		TimeoutSec: timeoutSec,
		Secrets:    map[string]string{SecretUsername: "guest", SecretPassword: "guest"},
	}
	ctx, cancel := context.WithTimeout(context.Background(), 1200*time.Millisecond)
	defer cancel()

	conn, err := New().Open(ctx, profile)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })

	capabilities := conn.Capabilities()
	reason, degraded := capabilities.DegradedReason(model.CapDestinationList)
	if !degraded {
		return ""
	}
	return reason
}

func statusServer(t *testing.T, status int) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"error":"not_authorised","reason":"test"}`))
	}))
	t.Cleanup(server.Close)
	return server
}

// The bug: probe reported every failure as "enable the management plugin", so
// a wrong password sent the reader off to reconfigure a broker that was fine.
func TestProbeNamesTheActualFailure(t *testing.T) {
	cases := []struct {
		name   string
		status int
		want   string
	}{
		{"unauthorized", http.StatusUnauthorized, credentialsRejected},
		{"forbidden", http.StatusForbidden, credentialsForbidden},
		{"not found", http.StatusNotFound, managementPluginMissing},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			server := statusServer(t, testCase.status)
			if got := probeAgainst(t, server.URL, 2); got != testCase.want {
				t.Errorf("reason = %q, want %q", got, testCase.want)
			}
		})
	}
}

// closedPort returns an address nothing is listening on.
func closedPort(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	address := listener.Addr().String()
	_ = listener.Close()
	return address
}

func TestProbeReportsNothingListeningAsUnreachable(t *testing.T) {
	// A port that was listening and is not any more: with the management
	// plugin off, this is exactly what the broker looks like.
	if got := probeAgainst(t, "http://"+closedPort(t), 2); got != endpointUnreachable {
		t.Errorf("reason = %q, want %q", got, endpointUnreachable)
	}
}

func TestProbeReportsASilentHostAsTimedOut(t *testing.T) {
	server := hangingServer(t)
	if got := probeAgainst(t, server.URL, 1); got != endpointTimedOut {
		t.Errorf("reason = %q, want %q", got, endpointTimedOut)
	}
}

// A healthy management endpoint degrades nothing on the admin plane, and the
// caveat on browsing survives - it is a different state from degraded.
//
// The AMQP side is pointed at a closed port on purpose. Deriving it from the
// httptest host would aim it at whatever is really listening on 5672, which on
// a developer machine is the e2e broker and makes the result depend on
// credentials this test is not about.
func TestProbeLeavesTheAdminPlaneUndegraded(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"rabbitmq_version":"4.1.0","node":"rabbit@test"}`))
	}))
	defer server.Close()

	profile := model.ConnectionProfile{
		Kind:       model.KindRabbitMQ,
		Endpoints:  server.URL,
		TimeoutSec: 1,
		Options:    map[string]string{OptionAMQPEndpoint: closedPort(t)},
		Secrets:    map[string]string{SecretUsername: "guest", SecretPassword: "guest"},
	}
	conn, err := New().Open(context.Background(), profile)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer func() { _ = conn.Close() }()

	capabilities := conn.Capabilities()
	for _, capability := range []model.Capability{
		model.CapDestinationList, model.CapDestinationCreate, model.CapClusterTopology,
		model.CapRouting, model.CapSubscriptionList,
	} {
		if _, degraded := capabilities.DegradedReason(capability); degraded {
			t.Errorf("%s was degraded on a healthy management endpoint", capability)
		}
	}
	if reason, ok := capabilities.Caveat(model.CapMessageQuery); !ok || reason != browseCaveat {
		t.Errorf("the browse caveat did not survive: reason=%q ok=%v", reason, ok)
	}
}
