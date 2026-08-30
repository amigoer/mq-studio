package rabbitmq

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	rabbithole "github.com/michaelklishin/rabbit-hole/v3"
)

// mgmt is the management API call layer.
//
// rabbit-hole takes no context. It builds one http.Client per request from
// whatever timeout its own struct carries, and offers no way to interrupt a
// call in flight. Every driver's contract is the opposite: the service layer
// puts the request deadline on the context and expects it honoured. This is
// what closes that gap.
type mgmt struct {
	endpoint string
	username string
	password string

	// transport is shared across calls. rabbit-hole makes a client per
	// request, so without one supplied here every call would fall back to the
	// package default and TLS settings would have nowhere to live.
	transport http.RoundTripper
}

func newMgmt(endpoint, username, password string, transport http.RoundTripper) *mgmt {
	return &mgmt{endpoint: endpoint, username: username, password: password, transport: transport}
}

// ceilingTimeout bounds a call whose context carries no deadline. Nothing in
// this app should make one, but rabbit-hole's own default is no timeout at
// all, so a caller that slipped through would hang for good.
const ceilingTimeout = 30 * time.Second

// budget is how long a call may take. A zero timeout means "no timeout" to
// net/http, so an already-expired context has to yield a positive value the
// request fails on at once rather than a zero that removes the bound.
func (m *mgmt) budget(ctx context.Context) time.Duration {
	deadline, ok := ctx.Deadline()
	if !ok {
		return ceilingTimeout
	}
	if remaining := time.Until(deadline); remaining > 0 {
		return remaining
	}
	return time.Nanosecond
}

// client is bound to one context's deadline, so it is built per call rather
// than held on the connection. That costs nothing: rabbit-hole constructs a
// fresh http.Client inside every request regardless.
func (m *mgmt) client(ctx context.Context) (*rabbithole.Client, error) {
	client, err := rabbithole.NewClient(m.endpoint, m.username, m.password)
	if err != nil {
		return nil, fmt.Errorf("build management client: %w", err)
	}
	if m.transport != nil {
		client.SetTransport(m.transport)
	}
	client.SetTimeout(m.budget(ctx))
	return client, nil
}

type outcome[T any] struct {
	value T
	err   error
}

// call runs one management request under the context's deadline.
//
// The work runs in a goroutine because rabbit-hole cannot be interrupted: a
// cancelled context returns here at once while the request finishes on its
// own, and the HTTP timeout set above is what stops that goroutine outliving
// the deadline. The channel is buffered so the goroutine never blocks on a
// receiver that has already left.
func call[T any](ctx context.Context, m *mgmt, fn func(*rabbithole.Client) (T, error)) (T, error) {
	var zero T
	if err := ctx.Err(); err != nil {
		return zero, err
	}
	client, err := m.client(ctx)
	if err != nil {
		return zero, err
	}

	done := make(chan outcome[T], 1)
	go func() { value, err := fn(client); done <- outcome[T]{value, err} }()

	select {
	case <-ctx.Done():
		return zero, ctx.Err()
	case result := <-done:
		return result.value, result.err
	}
}

// exec runs a management request whose only interesting result is whether it
// worked.
//
// rabbit-hole hands back the raw response from every mutating call with the
// body still open, and closing it is the caller's job. Nothing here reads one,
// so this is the only place that has to remember.
func exec(ctx context.Context, m *mgmt, fn func(*rabbithole.Client) (*http.Response, error)) error {
	response, err := call(ctx, m, fn)
	if err != nil {
		return err
	}
	if response != nil && response.Body != nil {
		_ = response.Body.Close()
	}
	return nil
}

// postJSON sends a management request rabbit-hole does not wrap. The message
// endpoints are the ones that need it; the API is REST either way, and what is
// lost is only the typed wrapper.
func (m *mgmt) postJSON(ctx context.Context, path string, body, out any) error {
	encoded, err := json.Marshal(body)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(
		ctx, http.MethodPost, m.endpoint+path, bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	request.SetBasicAuth(m.username, m.password)
	request.Header.Set("Content-Type", "application/json")

	client := &http.Client{Transport: m.transport, Timeout: m.budget(ctx)}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()

	if response.StatusCode >= http.StatusBadRequest {
		return fmt.Errorf("management API returned %s", response.Status)
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(response.Body).Decode(out)
}
