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

func TestProbeReportsNothingListeningAsUnreachable(t *testing.T) {
	// A port that was listening and is not any more: with the management
	// plugin off, this is exactly what the broker looks like.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	address := listener.Addr().String()
	_ = listener.Close()

	if got := probeAgainst(t, "http://"+address, 2); got != endpointUnreachable {
		t.Errorf("reason = %q, want %q", got, endpointUnreachable)
	}
}

func TestProbeReportsASilentHostAsTimedOut(t *testing.T) {
	server := hangingServer(t)
	if got := probeAgainst(t, server.URL, 1); got != endpointTimedOut {
		t.Errorf("reason = %q, want %q", got, endpointTimedOut)
	}
}

// A healthy endpoint degrades nothing. The caveat on browsing is a separate
// state and must survive.
func TestProbeLeavesAHealthyEndpointUndegraded(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"rabbitmq_version":"4.1.0","node":"rabbit@test"}`))
	}))
	defer server.Close()

	profile := model.ConnectionProfile{
		Kind:      model.KindRabbitMQ,
		Endpoints: server.URL,
		Secrets:   map[string]string{SecretUsername: "guest", SecretPassword: "guest"},
	}
	conn, err := New().Open(context.Background(), profile)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer func() { _ = conn.Close() }()

	capabilities := conn.Capabilities()
	if _, degraded := capabilities.DegradedReason(model.CapDestinationList); degraded {
		t.Error("a healthy endpoint degraded destination.list")
	}
	if !capabilities.Has(model.CapMessageQuery) {
		t.Error("message.query is not supported on a healthy endpoint")
	}
}
