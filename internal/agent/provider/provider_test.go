package provider

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// recorder is a stand-in model service that keeps every request it is sent.
type recorder struct {
	mu       sync.Mutex
	requests []recorded
	answer   func(w http.ResponseWriter, r *http.Request)
}

type recorded struct {
	method string
	path   string
	header http.Header
	body   map[string]any
}

func (rec *recorder) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(r.Body)
	var body map[string]any
	_ = json.Unmarshal(raw, &body)
	rec.mu.Lock()
	rec.requests = append(rec.requests, recorded{method: r.Method, path: r.URL.Path, header: r.Header.Clone(), body: body})
	rec.mu.Unlock()
	rec.answer(w, r)
}

func (rec *recorder) only(t *testing.T) recorded {
	t.Helper()
	rec.mu.Lock()
	defer rec.mu.Unlock()
	if len(rec.requests) != 1 {
		t.Fatalf("the service was sent %d requests, want one", len(rec.requests))
	}
	return rec.requests[0]
}

func serve(t *testing.T, answer func(w http.ResponseWriter, r *http.Request)) (*recorder, string) {
	t.Helper()
	rec := &recorder{answer: answer}
	server := httptest.NewServer(rec)
	t.Cleanup(server.Close)
	return rec, server.URL
}

func answerJSON(status int, body string) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}
}

const anthropicMessage = `{"id":"msg_1","type":"message","role":"assistant","model":"claude-opus-5-5",
	"content":[{"type":"text","text":"OK"}],"stop_reason":"end_turn","stop_sequence":null,
	"usage":{"input_tokens":12,"output_tokens":2}}`

// Everything another program might have configured for these SDKs, set for
// the length of a test so that none of it can be what a request carries.
func pollutedEnvironment(t *testing.T, elsewhere string) {
	t.Helper()
	for name, value := range map[string]string{
		"ANTHROPIC_API_KEY":     "sk-ant-from-the-shell",
		"ANTHROPIC_AUTH_TOKEN":  "token-from-the-shell",
		"ANTHROPIC_BASE_URL":    elsewhere,
		"OPENAI_API_KEY":        "sk-from-the-shell",
		"OPENAI_BASE_URL":       elsewhere,
		"OPENAI_ORG_ID":         "org-from-the-shell",
		"OPENAI_PROJECT_ID":     "proj-from-the-shell",
		"OPENAI_CUSTOM_HEADERS": "X-Leaked: from-the-shell",
	} {
		t.Setenv(name, value)
	}
}

func headersCarry(header http.Header, text string) bool {
	for _, values := range header {
		for _, value := range values {
			if strings.Contains(value, text) {
				return true
			}
		}
	}
	return false
}

func TestTheMessagesProbeCarriesOnlyWhatWasConfigured(t *testing.T) {
	_, elsewhere := serve(t, answerJSON(500, `{}`))
	pollutedEnvironment(t, elsewhere)
	rec, base := serve(t, answerJSON(200, anthropicMessage))

	check, err := Probe(context.Background(), Endpoint{Kind: Anthropic, BaseURL: base, APIKey: "sk-ant-configured"},
		"claude-sonnet-5-5")
	if err != nil {
		t.Fatalf("probe: %v", err)
	}
	if check.Model != "claude-sonnet-5-5" {
		t.Errorf("checked %q", check.Model)
	}

	sent := rec.only(t)
	if sent.method != http.MethodPost || sent.path != "/v1/messages" {
		t.Errorf("sent %s %s", sent.method, sent.path)
	}
	if got := sent.header.Get("X-Api-Key"); got != "sk-ant-configured" {
		t.Errorf("x-api-key = %q", got)
	}
	if headersCarry(sent.header, "from-the-shell") {
		t.Errorf("a credential from the environment travelled: %v", sent.header)
	}
	tools, _ := sent.body["tools"].([]any)
	if len(tools) != 1 || tools[0].(map[string]any)["name"] != probeTool {
		t.Errorf("the probe did not carry its tool: %v", sent.body["tools"])
	}
	if _, asked := sent.body["fallbacks"]; asked {
		t.Error("a model that takes no fallback was asked for one")
	}
}

// The fallback is asked for where the model takes it, and only when the
// endpoint has it on: a gateway that does not pass the option on is what the
// switch exists for.
func TestTheProbeAsksForTheFallbackWhereItApplies(t *testing.T) {
	for _, c := range []struct {
		fallback bool
		model    string
		want     bool
	}{
		{true, "claude-opus-5-5", true},
		{false, "claude-opus-5-5", false},
		{true, "claude-haiku-4-5", false},
	} {
		rec, base := serve(t, answerJSON(200, anthropicMessage))
		_, err := Probe(context.Background(), Endpoint{
			Kind: Anthropic, BaseURL: base, APIKey: "sk-ant-configured", Fallback: c.fallback}, c.model)
		if err != nil {
			t.Fatalf("%+v: %v", c, err)
		}
		sent := rec.only(t)
		asked := sent.body["fallbacks"] == "default"
		beta := strings.Contains(sent.header.Get("Anthropic-Beta"), "server-side-fallback-2026-07-01")
		if asked != c.want || beta != c.want {
			t.Errorf("%+v: fallbacks %v, beta header %v", c, sent.body["fallbacks"], sent.header.Get("Anthropic-Beta"))
		}
	}
}

func TestTheMessagesListingNamesEachModel(t *testing.T) {
	rec, base := serve(t, answerJSON(200, `{"data":[
		{"type":"model","id":"claude-opus-5-5","display_name":"Claude Opus 5.5","created_at":"2026-08-01T00:00:00Z"},
		{"type":"model","id":"claude-haiku-4-5","display_name":"Claude Haiku 4.5","created_at":"2025-10-01T00:00:00Z"}],
		"has_more":false,"first_id":"claude-opus-5-5","last_id":"claude-haiku-4-5"}`))

	models, err := Models(context.Background(), Endpoint{Kind: Anthropic, BaseURL: base, APIKey: "sk-ant-configured"})
	if err != nil {
		t.Fatalf("models: %v", err)
	}
	if len(models) != 2 || models[0].ID != "claude-opus-5-5" || models[0].Name != "Claude Opus 5.5" {
		t.Errorf("listed %+v", models)
	}
	if sent := rec.only(t); sent.method != http.MethodGet || sent.path != "/v1/models" {
		t.Errorf("sent %s %s", sent.method, sent.path)
	}
}

func TestTheChatProbeCarriesOnlyWhatWasConfigured(t *testing.T) {
	_, elsewhere := serve(t, answerJSON(500, `{}`))
	pollutedEnvironment(t, elsewhere)
	rec, base := serve(t, answerJSON(200, `{"id":"c1","object":"chat.completion","created":1,"model":"qwen3:14b",
		"choices":[{"index":0,"finish_reason":"stop","message":{"role":"assistant","content":"OK"}}]}`))

	if _, err := Probe(context.Background(), Endpoint{Kind: OpenAI, BaseURL: base + "/v1", APIKey: "sk-configured"},
		"qwen3:14b"); err != nil {
		t.Fatalf("probe: %v", err)
	}
	sent := rec.only(t)
	if sent.method != http.MethodPost || sent.path != "/v1/chat/completions" {
		t.Errorf("sent %s %s", sent.method, sent.path)
	}
	if got := sent.header.Get("Authorization"); got != "Bearer sk-configured" {
		t.Errorf("authorization = %q", got)
	}
	for _, name := range []string{"OpenAI-Organization", "OpenAI-Project", "X-Leaked"} {
		if sent.header.Get(name) != "" {
			t.Errorf("%s travelled from the environment: %q", name, sent.header.Get(name))
		}
	}
	if headersCarry(sent.header, "from-the-shell") {
		t.Errorf("something from the environment travelled: %v", sent.header)
	}
	tools, _ := sent.body["tools"].([]any)
	if len(tools) != 1 || tools[0].(map[string]any)["function"].(map[string]any)["name"] != probeTool {
		t.Errorf("the probe did not carry its tool: %v", sent.body["tools"])
	}
	for _, field := range []string{"max_tokens", "max_completion_tokens"} {
		if _, set := sent.body[field]; set {
			t.Errorf("%s was sent, and half the compatible services reject one or the other", field)
		}
	}
}

// A local runner takes no key, and one in the environment is no business of
// a service that never asked for it.
func TestAKeylessServiceIsSentNoKey(t *testing.T) {
	pollutedEnvironment(t, "http://127.0.0.1:1")
	rec, base := serve(t, answerJSON(200, `{"object":"list","data":[{"id":"qwen3:14b","object":"model","created":1,"owned_by":"library"}]}`))

	models, err := Models(context.Background(), Endpoint{Kind: OpenAI, BaseURL: base + "/v1"})
	if err != nil {
		t.Fatalf("models: %v", err)
	}
	if len(models) != 1 || models[0].ID != "qwen3:14b" {
		t.Errorf("listed %+v", models)
	}
	if got := rec.only(t).header.Get("Authorization"); strings.Contains(got, "sk-") {
		t.Errorf("a key nobody configured was sent: %q", got)
	}
}

// A service with no model listing answers 404 at the path, and that is not a
// wrong address: its models can still be named by hand.
func TestAServiceThatListsNoModelsSaysSo(t *testing.T) {
	_, base := serve(t, answerJSON(404, `{"error":{"message":"not found"}}`))
	_, err := Models(context.Background(), Endpoint{Kind: OpenAI, BaseURL: base + "/v1"})
	var failure *Failure
	if !errors.As(err, &failure) || failure.Reason != ReasonUnlisted {
		t.Fatalf("got %v", err)
	}
}

func TestFailuresSayWhatToDoAboutThem(t *testing.T) {
	for _, c := range []struct {
		status int
		body   string
		want   Reason
		detail string
	}{
		{401, `{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`, ReasonAuth, "invalid x-api-key"},
		{404, `{"type":"error","error":{"type":"not_found_error","message":"model: claude-nonesuch"}}`, ReasonNotFound, "claude-nonesuch"},
		{400, `{"type":"error","error":{"type":"invalid_request_error","message":"tools are not supported"}}`, ReasonRejected, "not supported"},
		{429, `{"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}`, ReasonRateLimited, "slow down"},
		{529, `{"type":"error","error":{"type":"overloaded_error","message":"overloaded"}}`, ReasonServer, "overloaded"},
	} {
		rec, base := serve(t, answerJSON(c.status, c.body))
		_, err := Probe(context.Background(), Endpoint{Kind: Anthropic, BaseURL: base, APIKey: "k"}, "claude-opus-5-5")
		var failure *Failure
		if !errors.As(err, &failure) {
			t.Errorf("%d: got %v", c.status, err)
			continue
		}
		if failure.Reason != c.want || failure.Status != c.status || !strings.Contains(failure.Detail, c.detail) {
			t.Errorf("%d: got %+v", c.status, failure)
		}
		// One attempt: a person is waiting on the answer.
		rec.only(t)
	}
}

func TestNoAnswerIsUnreachableOrLate(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	closed := "http://" + listener.Addr().String()
	_ = listener.Close()
	_, err = Models(context.Background(), Endpoint{Kind: OpenAI, BaseURL: closed})
	var failure *Failure
	if !errors.As(err, &failure) || failure.Reason != ReasonUnreachable {
		t.Errorf("a closed port: %v", err)
	}

	_, slow := serve(t, func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(5 * time.Second):
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	_, err = Models(ctx, Endpoint{Kind: OpenAI, BaseURL: slow})
	if !errors.As(err, &failure) || failure.Reason != ReasonTimeout {
		t.Errorf("a service that does not answer: %v", err)
	}
}

// A proxy is how the services are reached from a network that cannot reach
// them directly, so when one is named every request goes through it.
func TestANamedProxyCarriesTheRequests(t *testing.T) {
	via, proxy := serve(t, answerJSON(200, `{"object":"list","data":[{"id":"m","object":"model","created":1,"owned_by":"o"}]}`))
	if _, err := Models(context.Background(), Endpoint{
		Kind: OpenAI, BaseURL: "http://models.example.invalid/v1", Proxy: proxy}); err != nil {
		t.Fatalf("models through the proxy: %v", err)
	}
	if sent := via.only(t); sent.path != "/v1/models" {
		t.Errorf("the proxy was asked for %s", sent.path)
	}

	for _, bad := range []string{"not a url", "ftp://proxy.example:21", "http://"} {
		if _, err := Models(context.Background(), Endpoint{Kind: OpenAI, Proxy: bad}); err == nil {
			t.Errorf("proxy %q was taken", bad)
		}
	}
}
