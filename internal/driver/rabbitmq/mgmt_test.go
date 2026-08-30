package rabbitmq

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	rabbithole "github.com/michaelklishin/rabbit-hole/v3"

	"github.com/amigoer/mq-studio/internal/model"
)

// hangingServer answers nothing until the test lets it, which is what a broker
// that has stopped responding looks like from here.
func hangingServer(t *testing.T) *httptest.Server {
	t.Helper()
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(func() { close(release); server.Close() })
	return server
}

func testMgmt(endpoint string) *mgmt {
	return newMgmt(endpoint, "guest", "guest", newTransport(2*time.Second, nil))
}

func overviewOf(m *mgmt, ctx context.Context) error {
	_, err := call(ctx, m, func(client *rabbithole.Client) (*rabbithole.Overview, error) {
		return client.Overview()
	})
	return err
}

// The bug this guards: rabbit-hole takes no context and defaults to no timeout,
// so before mgmt existed a broker that stopped answering held the request open
// for good and the deadline the service layer set meant nothing.
func TestCallReturnsWhenTheDeadlinePasses(t *testing.T) {
	server := hangingServer(t)
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()

	start := time.Now()
	err := overviewOf(testMgmt(server.URL), ctx)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("a call against a hung broker returned no error")
	}
	if elapsed > time.Second {
		t.Fatalf("took %s to give up on a 150ms deadline", elapsed)
	}
}

func TestCallReturnsWhenTheContextIsCancelled(t *testing.T) {
	server := hangingServer(t)
	ctx, cancel := context.WithCancel(context.Background())
	go func() { time.Sleep(50 * time.Millisecond); cancel() }()

	start := time.Now()
	err := overviewOf(testMgmt(server.URL), ctx)
	elapsed := time.Since(start)

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
	if elapsed > time.Second {
		t.Fatalf("took %s to notice a cancel at 50ms", elapsed)
	}
}

// An expired context must not reach the broker at all.
func TestCallRefusesAnAlreadyExpiredContext(t *testing.T) {
	reached := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reached = true
	}))
	defer server.Close()

	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()

	if err := overviewOf(testMgmt(server.URL), ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("err = %v, want context.DeadlineExceeded", err)
	}
	if reached {
		t.Error("an expired context still sent a request")
	}
}

func TestBudgetTracksTheContext(t *testing.T) {
	m := testMgmt("http://example.invalid")

	// No deadline: bounded anyway, because rabbit-hole's own default is none.
	if budget := m.budget(context.Background()); budget != ceilingTimeout {
		t.Errorf("budget without a deadline = %s, want the %s ceiling", budget, ceilingTimeout)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if budget := m.budget(ctx); budget <= 0 || budget > 2*time.Second {
		t.Errorf("budget = %s, want the remaining time under 2s", budget)
	}

	// Expired. Zero would mean "no timeout" to net/http, which is the opposite
	// of what an expired deadline should produce.
	expired, cancelExpired := context.WithDeadline(context.Background(), time.Now().Add(-time.Hour))
	defer cancelExpired()
	if budget := m.budget(expired); budget <= 0 {
		t.Errorf("budget on an expired context = %s, want a positive value", budget)
	}
}

// rabbit-hole builds a client per request, so the transport is the only thing
// that persists. Rebuilding it per call would leak sockets and leave TLS
// settings nowhere to live.
func TestEveryClientSharesOneTransport(t *testing.T) {
	m := testMgmt("http://example.invalid")
	ctx := context.Background()

	first, err := m.client(ctx)
	if err != nil {
		t.Fatalf("client: %v", err)
	}
	second, err := m.client(ctx)
	if err != nil {
		t.Fatalf("client: %v", err)
	}
	if first == second {
		t.Error("the same client was handed out twice; it carries a per-call deadline")
	}
	if m.transport == nil {
		t.Fatal("no transport to share")
	}
}

func TestPostJSONHonoursTheDeadline(t *testing.T) {
	server := hangingServer(t)
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()

	start := time.Now()
	err := testMgmt(server.URL).postJSON(ctx, "/api/queues/%2F/q/get", map[string]int{"count": 1}, nil)
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("postJSON against a hung broker returned no error")
	}
	if elapsed > time.Second {
		t.Fatalf("took %s to give up on a 150ms deadline", elapsed)
	}
}

func TestPostJSONCarriesCredentialsAndContentType(t *testing.T) {
	var (
		gotUser string
		gotType string
		gotBody string
	)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUser, _, _ = r.BasicAuth()
		gotType = r.Header.Get("Content-Type")
		buf := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(buf)
		gotBody = string(buf)
		_, _ = w.Write([]byte(`{"routed":true}`))
	}))
	defer server.Close()

	var out struct {
		Routed bool `json:"routed"`
	}
	if err := testMgmt(server.URL).postJSON(context.Background(), "/api/x", map[string]string{"a": "b"}, &out); err != nil {
		t.Fatalf("postJSON: %v", err)
	}
	if gotUser != "guest" {
		t.Errorf("basic auth user = %q, want guest", gotUser)
	}
	if gotType != "application/json" {
		t.Errorf("content type = %q", gotType)
	}
	if gotBody != `{"a":"b"}` {
		t.Errorf("body = %q", gotBody)
	}
	if !out.Routed {
		t.Error("the response was not decoded into out")
	}
}

func TestPostJSONReportsAnErrorStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	err := testMgmt(server.URL).postJSON(context.Background(), "/api/x", map[string]string{}, nil)
	if err == nil {
		t.Fatal("a 404 was reported as success")
	}
}

// The connection form collects a timeout, and before this it reached nothing
// on the RabbitMQ path: the driver dialled with the package default and every
// management call ran unbounded.
func TestDialTimeoutComesFromTheProfile(t *testing.T) {
	if got := dialTimeout(model.ConnectionProfile{TimeoutSec: 12}); got != 12*time.Second {
		t.Errorf("dialTimeout = %s, want 12s from the profile", got)
	}
	if got := dialTimeout(model.ConnectionProfile{}); got != defaultDialTimeout {
		t.Errorf("dialTimeout with no profile value = %s, want the %s default", got, defaultDialTimeout)
	}
	if got := dialTimeout(model.ConnectionProfile{TimeoutSec: -1}); got != defaultDialTimeout {
		t.Errorf("dialTimeout on a negative value = %s, want the default", got)
	}
}
