package provider

import (
	"context"
	"encoding/json"
	"fmt"
)

// Tool is a tool as a model is offered it.
type Tool struct {
	Name        string
	Description string
	// Schema is the JSON Schema of the tool's input, an object.
	Schema map[string]any
}

// Call is a tool a model asked for.
type Call struct {
	ID    string
	Name  string
	Input json.RawMessage
}

// Result is what a call came to, to hand back to the model.
type Result struct {
	CallID  string
	Content string
	IsError bool
}

// Delta is a piece of a turn as it streams in.
type Delta struct {
	// Thinking marks a piece of the model's reasoning summary rather than of
	// its answer.
	Thinking bool
	Text     string
}

// Stop is why a turn ended.
type Stop string

const (
	// StopDone is a turn that said what it had to say.
	StopDone Stop = "done"
	// StopTools is a turn that asked for tools, and waits for their results.
	StopTools Stop = "tools"
	// StopLength is a turn cut off at its token limit. A tool call in it may
	// be truncated, so none of them is run.
	StopLength Stop = "length"
	// StopRefused is a turn the model or the service declined to give.
	StopRefused Stop = "refused"
	// StopContext is a conversation too long for the model to take more of.
	StopContext Stop = "context"
	// StopOther is any reason this package does not know.
	StopOther Stop = "other"
)

// Usage is what a turn cost, in tokens, where the service says.
type Usage struct {
	Input      int64 `json:"input"`
	Output     int64 `json:"output"`
	CacheRead  int64 `json:"cacheRead,omitempty"`
	CacheWrite int64 `json:"cacheWrite,omitempty"`
}

// Turn is one model turn.
type Turn struct {
	Text  string
	Calls []Call
	Stop  Stop
	// Explanation is the service's account of a refusal, when it gives one.
	Explanation string
	// Model is the model that answered, which a fallback can change.
	Model string
	Usage Usage
}

/*
 * Chat is one conversation with one model on one service.
 *
 * The history is kept in the service's own shape rather than a neutral one: a
 * reasoning model's thinking has to go back exactly as it came, signature and
 * all, and only the service's own types carry that. It is also why a
 * conversation stays on the model it started with.
 */
type Chat interface {
	// User adds what the person said.
	User(text string)
	// Results adds what the calls of the last turn came to, all of them.
	Results(results []Result)
	// Next asks for the model's next turn, streaming it through delta.
	Next(ctx context.Context, delta func(Delta)) (Turn, error)
	// Offer replaces the tools the model is offered, from the next turn on.
	Offer(tools []Tool)
	// Reach sends the turns after it to the service as it is set up now: a
	// key replaced or a proxy changed since the conversation began. The model
	// and what it was found to take stay as they were, since the history was
	// written for them.
	Reach(endpoint Endpoint) error
}

// Options is how a conversation is set up.
type Options struct {
	Model  string
	System string
	Tools  []Tool
	// Effort is low, medium or high: how hard the model thinks, where the
	// model takes the setting.
	Effort string
	// MaxTokens bounds one turn's answer.
	MaxTokens int64
}

// NewChat starts a conversation. Nothing is sent until Next.
func NewChat(ctx context.Context, endpoint Endpoint, options Options) (Chat, error) {
	client, err := httpClient(endpoint.Proxy)
	if err != nil {
		return nil, err
	}
	if options.MaxTokens <= 0 {
		options.MaxTokens = defaultMaxTokens
	}
	switch endpoint.Kind {
	case Anthropic:
		return newAnthropicChat(ctx, endpoint, client, options), nil
	case OpenAI:
		return newOpenAIChat(endpoint, client, options), nil
	}
	return nil, fmt.Errorf("%q is not a protocol this application speaks", endpoint.Kind)
}

// defaultMaxTokens bounds a turn that set no bound: room for a long answer
// and the thinking before it, short of a runaway.
const defaultMaxTokens = 16000

// closedSchema writes the "no other properties" a schema library spells
// {"not": {}} as false, which every service reads the same way.
func closedSchema(schema map[string]any) map[string]any {
	out := make(map[string]any, len(schema))
	for key, value := range schema {
		switch typed := value.(type) {
		case map[string]any:
			if key == "additionalProperties" && len(typed) == 1 {
				if not, ok := typed["not"].(map[string]any); ok && len(not) == 0 {
					out[key] = false
					continue
				}
			}
			out[key] = closedSchema(typed)
		case []any:
			items := make([]any, len(typed))
			for i, item := range typed {
				if object, ok := item.(map[string]any); ok {
					items[i] = closedSchema(object)
				} else {
					items[i] = item
				}
			}
			out[key] = items
		default:
			out[key] = value
		}
	}
	return out
}
