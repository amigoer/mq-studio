package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// stream is a stand-in service that answers each request with the next of a
// list of scripted responses, and keeps every request body it was sent.
type stream struct {
	mu        sync.Mutex
	bodies    []map[string]any
	paths     []string
	keys      []string
	responses []func(http.ResponseWriter, *http.Request)
}

func (s *stream) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(r.Body)
	var body map[string]any
	_ = json.Unmarshal(raw, &body)
	s.mu.Lock()
	s.bodies = append(s.bodies, body)
	s.paths = append(s.paths, r.URL.Path)
	s.keys = append(s.keys, r.Header.Get("Authorization")+r.Header.Get("X-Api-Key"))
	index := len(s.paths) - 1
	s.mu.Unlock()
	if index >= len(s.responses) {
		http.Error(w, "unscripted", http.StatusTeapot)
		return
	}
	s.responses[index](w, r)
}

func (s *stream) body(t *testing.T, index int) map[string]any {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	if index >= len(s.bodies) {
		t.Fatalf("request %d was never sent; the service saw %v", index, s.paths)
	}
	return s.bodies[index]
}

// sentKeys is the key each request carried, in either protocol's header.
func (s *stream) sentKeys() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.keys...)
}

func sse(events ...string) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		for _, event := range events {
			_, _ = io.WriteString(w, event+"\n\n")
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
		}
	}
}

// messages is the Messages API's stream for a list of (event, data) pairs.
func messages(pairs ...string) func(http.ResponseWriter, *http.Request) {
	events := make([]string, 0, len(pairs)/2)
	for i := 0; i+1 < len(pairs); i += 2 {
		events = append(events, fmt.Sprintf("event: %s\ndata: %s", pairs[i], pairs[i+1]))
	}
	return sse(events...)
}

const capableModel = `{"type":"model","id":"claude-opus-5-5","display_name":"Claude Opus 5.5",
	"created_at":"2026-08-01T00:00:00Z","max_input_tokens":1000000,"max_tokens":128000,
	"capabilities":{"thinking":{"supported":true,"types":{"adaptive":{"supported":true},"enabled":{"supported":false}}},
	"effort":{"supported":true,"low":{"supported":true},"medium":{"supported":true},"high":{"supported":true},
	"xhigh":{"supported":true},"max":{"supported":true}}}}`

// toolTurn thinks, says something, and asks for one tool with its input
// streamed in two pieces.
var toolTurn = messages(
	"message_start", `{"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-opus-5-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":120,"output_tokens":1,"cache_read_input_tokens":100,"cache_creation_input_tokens":0}}}`,
	"content_block_start", `{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}`,
	"content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Checking the lag."}}`,
	"content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig-abc"}}`,
	"content_block_stop", `{"type":"content_block_stop","index":0}`,
	"content_block_start", `{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}`,
	"content_block_delta", `{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Let me "}}`,
	"content_block_delta", `{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"look."}}`,
	"content_block_stop", `{"type":"content_block_stop","index":1}`,
	"content_block_start", `{"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_1","name":"subscription_lag","input":{}}}`,
	"content_block_delta", `{"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\"connection\": 1,"}}`,
	"content_block_delta", `{"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":" \"group\": \"legacy-sync\"}"}}`,
	"content_block_stop", `{"type":"content_block_stop","index":2}`,
	"message_delta", `{"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":42}}`,
	"message_stop", `{"type":"message_stop"}`,
)

var endTurn = messages(
	"message_start", `{"type":"message_start","message":{"id":"msg_2","type":"message","role":"assistant","model":"claude-opus-5-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":200,"output_tokens":1}}}`,
	"content_block_start", `{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
	"content_block_delta", `{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"It is behind."}}`,
	"content_block_stop", `{"type":"content_block_stop","index":0}`,
	"message_delta", `{"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":5}}`,
	"message_stop", `{"type":"message_stop"}`,
)

var lagTool = Tool{
	Name:        "subscription_lag",
	Description: "Read consume progress.",
	Schema: map[string]any{
		"type":                 "object",
		"properties":           map[string]any{"connection": map[string]any{"type": "integer"}, "group": map[string]any{"type": "string"}},
		"required":             []any{"connection", "group"},
		"additionalProperties": map[string]any{"not": map[string]any{}},
	},
}

func serveStream(t *testing.T, responses ...func(http.ResponseWriter, *http.Request)) (*stream, string) {
	t.Helper()
	service := &stream{responses: responses}
	server := httptest.NewServer(service)
	t.Cleanup(server.Close)
	return service, server.URL
}

func collect() (func(Delta), func() (string, string)) {
	var text, thinking strings.Builder
	return func(d Delta) {
			if d.Thinking {
				thinking.WriteString(d.Text)
			} else {
				text.WriteString(d.Text)
			}
		}, func() (string, string) {
			return text.String(), thinking.String()
		}
}

func TestAMessagesTurnStreamsAndHandsBackItsCalls(t *testing.T) {
	service, base := serveStream(t, answerJSON(200, capableModel), toolTurn, endTurn)
	chat, err := NewChat(context.Background(), Endpoint{Kind: Anthropic, BaseURL: base, APIKey: "k"},
		Options{Model: "claude-opus-5-5", System: "You work brokers.", Tools: []Tool{lagTool}, Effort: "low"})
	if err != nil {
		t.Fatal(err)
	}
	chat.User("Why is legacy-sync behind?")
	delta, streamed := collect()
	turn, err := chat.Next(context.Background(), delta)
	if err != nil {
		t.Fatal(err)
	}
	if text, thinking := streamed(); text != "Let me look." || thinking != "Checking the lag." {
		t.Errorf("streamed %q and thought %q", text, thinking)
	}
	if turn.Stop != StopTools || len(turn.Calls) != 1 || turn.Calls[0].ID != "toolu_1" ||
		turn.Calls[0].Name != "subscription_lag" {
		t.Fatalf("turn %+v", turn)
	}
	var input map[string]any
	if err := json.Unmarshal(turn.Calls[0].Input, &input); err != nil || input["group"] != "legacy-sync" {
		t.Errorf("input %s: %v", turn.Calls[0].Input, err)
	}
	if turn.Usage.Input != 120 || turn.Usage.Output != 42 || turn.Usage.CacheRead != 100 {
		t.Errorf("usage %+v", turn.Usage)
	}

	// What the model takes was asked first, and is what the request carried.
	first := service.body(t, 1)
	if thinking, _ := first["thinking"].(map[string]any); thinking["type"] != "adaptive" || thinking["display"] != "summarized" {
		t.Errorf("thinking %v", first["thinking"])
	}
	if config, _ := first["output_config"].(map[string]any); config["effort"] != "low" {
		t.Errorf("output_config %v", first["output_config"])
	}
	if _, cached := first["cache_control"]; !cached {
		t.Error("the conversation's tail is not cached")
	}
	system, _ := first["system"].([]any)
	if len(system) != 1 || system[0].(map[string]any)["cache_control"] == nil {
		t.Errorf("the system prompt is not a cache breakpoint: %v", first["system"])
	}
	tool := first["tools"].([]any)[0].(map[string]any)
	if tool["eager_input_streaming"] != true {
		t.Error("tool arguments do not stream as they are written")
	}
	if schema := tool["input_schema"].(map[string]any); schema["additionalProperties"] != false {
		t.Errorf("the input schema is not closed: %v", schema)
	}

	chat.Results([]Result{{CallID: "toolu_1", Content: `{"progress":{}}`}})
	if turn, err = chat.Next(context.Background(), func(Delta) {}); err != nil || turn.Stop != StopDone || turn.Text != "It is behind." {
		t.Fatalf("second turn %+v %v", turn, err)
	}

	// The thinking goes back exactly as it came, signature and all, and the
	// results answer the call they were asked by.
	history := service.body(t, 2)["messages"].([]any)
	if len(history) != 3 {
		t.Fatalf("sent %d messages, want the question, the tool turn and its results", len(history))
	}
	assistant := history[1].(map[string]any)["content"].([]any)
	thinking := assistant[0].(map[string]any)
	if thinking["type"] != "thinking" || thinking["signature"] != "sig-abc" || thinking["thinking"] != "Checking the lag." {
		t.Errorf("the thinking came back as %v", thinking)
	}
	result := history[2].(map[string]any)["content"].([]any)[0].(map[string]any)
	if result["type"] != "tool_result" || result["tool_use_id"] != "toolu_1" {
		t.Errorf("the result went back as %v", result)
	}
}

// A gateway without the Models API cannot say what a model takes, and then
// neither setting is sent rather than one the model may refuse.
func TestAModelNobodyDescribedIsSentNeitherSetting(t *testing.T) {
	service, base := serveStream(t, answerJSON(404, `{"error":{"message":"no models here"}}`), endTurn)
	chat, err := NewChat(context.Background(), Endpoint{Kind: Anthropic, BaseURL: base, APIKey: "k"},
		Options{Model: "claude-opus-5-5", Effort: "high"})
	if err != nil {
		t.Fatal(err)
	}
	chat.User("hello")
	if _, err := chat.Next(context.Background(), func(Delta) {}); err != nil {
		t.Fatal(err)
	}
	body := service.body(t, 1)
	for _, field := range []string{"thinking", "output_config"} {
		if _, sent := body[field]; sent {
			t.Errorf("%s was sent for a model nothing described", field)
		}
	}
}

func TestARefusalSaysWhy(t *testing.T) {
	_, base := serveStream(t, answerJSON(200, capableModel), messages(
		"message_start", `{"type":"message_start","message":{"id":"msg_3","type":"message","role":"assistant","model":"claude-opus-5-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":1,"output_tokens":0}}}`,
		"message_delta", `{"type":"message_delta","delta":{"stop_reason":"refusal","stop_sequence":null,"stop_details":{"type":"refusal","category":"cyber","explanation":"declined by policy"}},"usage":{"output_tokens":0}}`,
		"message_stop", `{"type":"message_stop"}`,
	))
	chat, _ := NewChat(context.Background(), Endpoint{Kind: Anthropic, BaseURL: base, APIKey: "k"}, Options{Model: "claude-opus-5-5"})
	chat.User("hello")
	turn, err := chat.Next(context.Background(), func(Delta) {})
	if err != nil {
		t.Fatal(err)
	}
	if turn.Stop != StopRefused {
		t.Errorf("stop %q", turn.Stop)
	}
}

// chatTurn is a chat completion stream that thinks, says a word, and asks for
// one tool whose arguments arrive in two pieces.
var chatTurn = sse(
	`data: {"id":"c1","object":"chat.completion.chunk","model":"qwen3:14b","choices":[{"index":0,"delta":{"role":"assistant","reasoning_content":"Checking."}}]}`,
	`data: {"choices":[{"index":0,"delta":{"content":"Looking."}}]}`,
	`data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"subscription_lag","arguments":""}}]}}]}`,
	`data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"connection\":1,"}}]}}]}`,
	`data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"group\":\"legacy-sync\"}"}}]}}]}`,
	`data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}`,
	`data: [DONE]`,
)

var chatEnd = sse(
	`data: {"choices":[{"index":0,"delta":{"content":"Behind."},"finish_reason":"stop"}]}`,
	`data: [DONE]`,
)

func TestAChatCompletionTurnStreamsAndHandsBackItsCalls(t *testing.T) {
	service, base := serveStream(t, chatTurn, chatEnd)
	chat, err := NewChat(context.Background(), Endpoint{Kind: OpenAI, BaseURL: base + "/v1"},
		Options{Model: "qwen3:14b", System: "You work brokers.", Tools: []Tool{lagTool}})
	if err != nil {
		t.Fatal(err)
	}
	chat.User("Why is legacy-sync behind?")
	delta, streamed := collect()
	turn, err := chat.Next(context.Background(), delta)
	if err != nil {
		t.Fatal(err)
	}
	if text, thinking := streamed(); text != "Looking." || thinking != "Checking." {
		t.Errorf("streamed %q and thought %q", text, thinking)
	}
	if turn.Stop != StopTools || len(turn.Calls) != 1 || turn.Calls[0].ID != "call_a" ||
		string(turn.Calls[0].Input) != `{"connection":1,"group":"legacy-sync"}` {
		t.Fatalf("turn %+v, input %s", turn, turn.Calls[0].Input)
	}

	first := service.body(t, 0)
	if first["stream"] != true || first["model"] != "qwen3:14b" {
		t.Errorf("request %v", first)
	}
	tool := first["tools"].([]any)[0].(map[string]any)["function"].(map[string]any)
	if tool["parameters"].(map[string]any)["additionalProperties"] != false {
		t.Errorf("the parameters are not closed: %v", tool["parameters"])
	}

	chat.Results([]Result{{CallID: "call_a", Content: "the group has no consumers", IsError: false}})
	if turn, err = chat.Next(context.Background(), func(Delta) {}); err != nil || turn.Stop != StopDone || turn.Text != "Behind." {
		t.Fatalf("second turn %+v %v", turn, err)
	}
	history := service.body(t, 1)["messages"].([]any)
	if len(history) != 4 {
		t.Fatalf("sent %d messages, want the system prompt, the question, the call and its result", len(history))
	}
	assistant := history[2].(map[string]any)
	if _, echoed := assistant["reasoning_content"]; echoed {
		t.Error("the reasoning went back, which DeepSeek refuses")
	}
	if calls := assistant["tool_calls"].([]any); len(calls) != 1 || calls[0].(map[string]any)["id"] != "call_a" {
		t.Errorf("the call went back as %v", assistant["tool_calls"])
	}
	if result := history[3].(map[string]any); result["role"] != "tool" || result["tool_call_id"] != "call_a" {
		t.Errorf("the result went back as %v", result)
	}
}

func TestAStreamThatFailsSaysWhy(t *testing.T) {
	_, base := serveStream(t, answerJSON(401, `{"error":{"message":"bad key"}}`),
		sse(`data: {"error":{"message":"the model is overloaded"}}`))
	chat, _ := NewChat(context.Background(), Endpoint{Kind: OpenAI, BaseURL: base}, Options{Model: "m"})
	chat.User("hello")
	var failure *Failure
	if _, err := chat.Next(context.Background(), func(Delta) {}); !errors.As(err, &failure) || failure.Reason != ReasonAuth {
		t.Errorf("before the stream: %v", err)
	}
	if _, err := chat.Next(context.Background(), func(Delta) {}); !errors.As(err, &failure) || !strings.Contains(failure.Detail, "overloaded") {
		t.Errorf("inside the stream: %v", err)
	}
}

// Stopping a turn is cancelling its context, and it has to end the stream
// promptly rather than wait for the model to finish talking.
func TestAStoppedTurnEndsAtOnce(t *testing.T) {
	_, base := serveStream(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, `data: {"choices":[{"index":0,"delta":{"content":"Thinking"}}]}`+"\n\n")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	})
	chat, _ := NewChat(context.Background(), Endpoint{Kind: OpenAI, BaseURL: base}, Options{Model: "m"})
	chat.User("hello")
	ctx, cancel := context.WithCancel(context.Background())
	started := make(chan struct{})
	go func() {
		<-started
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()
	began := time.Now()
	_, err := chat.Next(ctx, func(Delta) {
		select {
		case <-started:
		default:
			close(started)
		}
	})
	if !errors.Is(err, context.Canceled) {
		t.Errorf("a stopped turn ended with %v", err)
	}
	if time.Since(began) > 2*time.Second {
		t.Errorf("stopping took %v", time.Since(began))
	}
}

// A message after a turn that failed is the same person-turn to both
// protocols, which take no two in a row.
func TestTwoMessagesInARowAreOneTurn(t *testing.T) {
	service, base := serveStream(t, chatEnd)
	chat, _ := NewChat(context.Background(), Endpoint{Kind: OpenAI, BaseURL: base}, Options{Model: "m"})
	chat.User("first")
	chat.User("second")
	if _, err := chat.Next(context.Background(), func(Delta) {}); err != nil {
		t.Fatal(err)
	}
	history := service.body(t, 0)["messages"].([]any)
	if len(history) != 1 || history[0].(map[string]any)["content"] != "first\n\nsecond" {
		t.Errorf("sent %v", history)
	}

	messagesService, messagesBase := serveStream(t, answerJSON(404, `{}`), endTurn)
	anthropicChat, _ := NewChat(context.Background(), Endpoint{Kind: Anthropic, BaseURL: messagesBase, APIKey: "k"},
		Options{Model: "claude-opus-5-5"})
	anthropicChat.User("first")
	anthropicChat.User("second")
	if _, err := anthropicChat.Next(context.Background(), func(Delta) {}); err != nil {
		t.Fatal(err)
	}
	sent := messagesService.body(t, 1)["messages"].([]any)
	if len(sent) != 1 || len(sent[0].(map[string]any)["content"].([]any)) != 2 {
		t.Errorf("sent %v", sent)
	}
}

// A key replaced while a conversation is open reaches its next turn: the
// person who fixed a key and pressed retry is not starting over.
func TestAConversationReachesTheServiceAsItIsSetUpNow(t *testing.T) {
	service, base := serveStream(t, chatEnd, chatEnd)
	chat, _ := NewChat(context.Background(), Endpoint{Kind: OpenAI, BaseURL: base, APIKey: "old"}, Options{Model: "m"})
	chat.User("first")
	if _, err := chat.Next(context.Background(), func(Delta) {}); err != nil {
		t.Fatal(err)
	}
	if err := chat.Reach(Endpoint{Kind: OpenAI, BaseURL: base, APIKey: "new"}); err != nil {
		t.Fatal(err)
	}
	chat.User("second")
	if _, err := chat.Next(context.Background(), func(Delta) {}); err != nil {
		t.Fatal(err)
	}
	if keys := service.sentKeys(); keys[0] != "Bearer old" || keys[1] != "Bearer new" {
		t.Errorf("sent %q", keys)
	}
	if history := service.body(t, 1)["messages"].([]any); len(history) != 3 {
		t.Errorf("the history did not survive: %v", history)
	}

	messagesService, messagesBase := serveStream(t, answerJSON(404, `{}`), endTurn, endTurn)
	anthropicChat, _ := NewChat(context.Background(),
		Endpoint{Kind: Anthropic, BaseURL: messagesBase, APIKey: "old"}, Options{Model: "claude-opus-5-5"})
	anthropicChat.User("first")
	if _, err := anthropicChat.Next(context.Background(), func(Delta) {}); err != nil {
		t.Fatal(err)
	}
	if err := anthropicChat.Reach(Endpoint{Kind: Anthropic, BaseURL: messagesBase, APIKey: "new", Fallback: true}); err != nil {
		t.Fatal(err)
	}
	anthropicChat.User("second")
	if _, err := anthropicChat.Next(context.Background(), func(Delta) {}); err != nil {
		t.Fatal(err)
	}
	if keys := messagesService.sentKeys(); keys[1] != "old" || keys[2] != "new" {
		t.Errorf("sent %q", keys)
	}
	if body := messagesService.body(t, 2); body["fallbacks"] != "default" || len(body["messages"].([]any)) != 3 {
		t.Errorf("the fallback or the history did not follow: %v", body)
	}
}

// A rate limit or a failing service is waited out, as the Messages client
// does; a refused key is not, since waiting does not change it.
func TestAChatCompletionRetriesWhatWaitingCanFix(t *testing.T) {
	service, base := serveStream(t, answerJSON(503, `{"error":{"message":"overloaded"}}`),
		answerJSON(429, `{}`), chatEnd)
	chat, _ := NewChat(context.Background(), Endpoint{Kind: OpenAI, BaseURL: base}, Options{Model: "m"})
	chat.(*openAIChat).backoff = time.Millisecond
	chat.User("hello")
	if turn, err := chat.Next(context.Background(), func(Delta) {}); err != nil || turn.Text != "Behind." {
		t.Fatalf("after two retries: %+v %v", turn, err)
	}
	if sent := len(service.sentKeys()); sent != 3 {
		t.Errorf("sent %d requests", sent)
	}

	refused, refusedBase := serveStream(t, answerJSON(401, `{}`), chatEnd)
	chat, _ = NewChat(context.Background(), Endpoint{Kind: OpenAI, BaseURL: refusedBase}, Options{Model: "m"})
	chat.(*openAIChat).backoff = time.Millisecond
	chat.User("hello")
	if _, err := chat.Next(context.Background(), func(Delta) {}); err == nil {
		t.Error("a refused key went through")
	}
	if sent := len(refused.sentKeys()); sent != 1 {
		t.Errorf("a refused key was sent %d times", sent)
	}
}
