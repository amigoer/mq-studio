package provider

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
)

// openAIChat keeps the conversation as chat completion messages.
type openAIChat struct {
	endpoint Endpoint
	client   *http.Client
	model    string
	tools    []map[string]any
	history  []map[string]any
	// backoff is the wait before the first retry, doubled for the next.
	backoff time.Duration
}

// openAIRetries matches what the Messages client is set up with.
const openAIRetries = 2

func newOpenAIChat(endpoint Endpoint, client *http.Client, options Options) (*openAIChat, error) {
	chat := &openAIChat{endpoint: endpoint, client: client, model: options.Model, backoff: time.Second}
	if options.System != "" {
		chat.history = append(chat.history, map[string]any{"role": "system", "content": options.System})
	}
	if len(options.History) > 0 {
		var history []map[string]any
		if err := json.Unmarshal(options.History, &history); err != nil {
			return nil, fmt.Errorf("the conversation could not be read back: %w", err)
		}
		chat.history = append(chat.history, history...)
	}
	chat.Offer(options.Tools)
	return chat, nil
}

// History leaves the system prompt out, which a later chat sets afresh.
func (c *openAIChat) History() (json.RawMessage, error) {
	messages := c.history
	if len(messages) > 0 && messages[0]["role"] == "system" {
		messages = messages[1:]
	}
	return json.Marshal(messages)
}

func (c *openAIChat) Offer(tools []Tool) {
	c.tools = make([]map[string]any, 0, len(tools))
	for _, tool := range tools {
		c.tools = append(c.tools, map[string]any{
			"type": "function",
			"function": map[string]any{
				"name":        tool.Name,
				"description": tool.Description,
				"parameters":  closedSchema(tool.Schema),
			},
		})
	}
}

func (c *openAIChat) Reach(endpoint Endpoint) error {
	client, err := httpClient(endpoint.Proxy)
	if err != nil {
		return err
	}
	c.endpoint, c.client = endpoint, client
	return nil
}

func (c *openAIChat) User(text string) {
	if n := len(c.history); n > 0 && c.history[n-1]["role"] == "user" {
		c.history[n-1]["content"] = fmt.Sprint(c.history[n-1]["content"]) + "\n\n" + text
		return
	}
	c.history = append(c.history, map[string]any{"role": "user", "content": text})
}

// Results adds one tool message per call. The protocol has no error flag on
// a result, so a failure says so in its first word.
func (c *openAIChat) Results(results []Result) {
	for _, result := range results {
		content := result.Content
		if result.IsError {
			content = "Error: " + content
		}
		c.history = append(c.history, map[string]any{
			"role": "tool", "tool_call_id": result.CallID, "content": content,
		})
	}
}

// chunk is one streamed piece of a chat completion, read leniently: the
// services that copy the protocol fill different parts of it.
type chunk struct {
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
			// reasoning_content is DeepSeek's, reasoning several others'. It
			// is shown, and never sent back: DeepSeek refuses a request that
			// carries it.
			ReasoningContent string `json:"reasoning_content"`
			Reasoning        string `json:"reasoning"`
			ToolCalls        []struct {
				Index    int    `json:"index"`
				ID       string `json:"id"`
				Function struct {
					Name      string `json:"name"`
					Arguments string `json:"arguments"`
				} `json:"function"`
			} `json:"tool_calls"`
		} `json:"delta"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Model string `json:"model"`
	Usage *struct {
		PromptTokens        int64 `json:"prompt_tokens"`
		CompletionTokens    int64 `json:"completion_tokens"`
		PromptTokensDetails *struct {
			CachedTokens int64 `json:"cached_tokens"`
		} `json:"prompt_tokens_details"`
	} `json:"usage"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

/*
 * send posts a turn, retrying what a moment's wait can fix - a dropped
 * connection, a rate limit, a service failing on its side - as the Messages
 * client does. Nothing of the answer has been read when it retries, so a
 * retry cannot show any of it twice.
 */
func (c *openAIChat) send(ctx context.Context, body []byte) (*http.Response, error) {
	base := strings.TrimSpace(c.endpoint.BaseURL)
	if base == "" {
		base = openAIBaseURL
	}
	for attempt := 0; ; attempt++ {
		request, err := http.NewRequestWithContext(ctx, http.MethodPost,
			strings.TrimRight(base, "/")+"/chat/completions", bytes.NewReader(body))
		if err != nil {
			return nil, fmt.Errorf("%q is not an address a request can be sent to: %w", base, err)
		}
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Accept", "text/event-stream")
		if key := strings.TrimSpace(c.endpoint.APIKey); key != "" {
			request.Header.Set("Authorization", "Bearer "+key)
		}

		var failure error
		response, err := c.client.Do(request)
		switch {
		case err != nil:
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			failure = classify(err, 0, "")
		case response.StatusCode >= 200 && response.StatusCode <= 299:
			return response, nil
		default:
			answer, _ := io.ReadAll(io.LimitReader(response.Body, maxAnswer))
			_ = response.Body.Close()
			failure = classify(errors.New(response.Status), response.StatusCode, string(answer))
			if response.StatusCode != http.StatusTooManyRequests && response.StatusCode < 500 {
				return nil, failure
			}
		}
		if attempt == openAIRetries {
			return nil, failure
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(c.backoff << attempt):
		}
	}
}

type pendingCall struct {
	id        string
	name      string
	arguments strings.Builder
}

func (c *openAIChat) Next(ctx context.Context, delta func(Delta)) (Turn, error) {
	request := map[string]any{"model": c.model, "messages": c.history, "stream": true}
	if len(c.tools) > 0 {
		request["tools"] = c.tools
	}
	encoded, err := json.Marshal(request)
	if err != nil {
		return Turn{}, err
	}
	response, err := c.send(ctx, encoded)
	if err != nil {
		return Turn{}, err
	}
	defer response.Body.Close()

	var (
		text   strings.Builder
		calls  = map[int]*pendingCall{}
		finish string
		turn   Turn
	)
	reader := bufio.NewReaderSize(response.Body, 64*1024)
	for {
		line, err := reader.ReadString('\n')
		if payload, ok := strings.CutPrefix(strings.TrimSpace(line), "data:"); ok {
			payload = strings.TrimSpace(payload)
			if payload == "[DONE]" {
				break
			}
			var piece chunk
			if json.Unmarshal([]byte(payload), &piece) == nil {
				if piece.Error != nil {
					return Turn{}, &Failure{Reason: ReasonRejected, Status: response.StatusCode, Detail: piece.Error.Message}
				}
				if piece.Model != "" {
					turn.Model = piece.Model
				}
				if piece.Usage != nil {
					turn.Usage.Input, turn.Usage.Output = piece.Usage.PromptTokens, piece.Usage.CompletionTokens
					// The prompt count includes what was read from the cache,
					// which the Messages API reports beside it instead.
					if details := piece.Usage.PromptTokensDetails; details != nil {
						turn.Usage.CacheRead = min(details.CachedTokens, piece.Usage.PromptTokens)
						turn.Usage.Input -= turn.Usage.CacheRead
					}
				}
				for _, choice := range piece.Choices {
					if choice.Delta.Content != "" {
						text.WriteString(choice.Delta.Content)
						delta(Delta{Text: choice.Delta.Content})
					}
					if thinking := choice.Delta.ReasoningContent + choice.Delta.Reasoning; thinking != "" {
						delta(Delta{Thinking: true, Text: thinking})
					}
					for _, call := range choice.Delta.ToolCalls {
						pending := calls[call.Index]
						if pending == nil {
							pending = &pendingCall{}
							calls[call.Index] = pending
						}
						if call.ID != "" {
							pending.id = call.ID
						}
						pending.name += call.Function.Name
						pending.arguments.WriteString(call.Function.Arguments)
					}
					if choice.FinishReason != "" {
						finish = choice.FinishReason
					}
				}
			}
		}
		if err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			if ctx.Err() != nil {
				return Turn{}, ctx.Err()
			}
			return Turn{}, classify(err, 0, "")
		}
	}

	indexes := make([]int, 0, len(calls))
	for index := range calls {
		indexes = append(indexes, index)
	}
	sort.Ints(indexes)
	assistant := map[string]any{"role": "assistant", "content": text.String()}
	var toolCalls []map[string]any
	for _, index := range indexes {
		pending := calls[index]
		if pending.id == "" {
			// Some local runners leave the id out; the results still have to
			// name the call they answer.
			pending.id = fmt.Sprintf("call_%d", index)
		}
		arguments := pending.arguments.String()
		if strings.TrimSpace(arguments) == "" {
			arguments = "{}"
		}
		turn.Calls = append(turn.Calls, Call{ID: pending.id, Name: pending.name, Input: json.RawMessage(arguments)})
		toolCalls = append(toolCalls, map[string]any{
			"id": pending.id, "type": "function",
			"function": map[string]any{"name": pending.name, "arguments": arguments},
		})
	}
	if len(toolCalls) > 0 {
		assistant["tool_calls"] = toolCalls
		if text.Len() == 0 {
			assistant["content"] = nil
		}
	}
	c.history = append(c.history, assistant)

	turn.Text = text.String()
	switch {
	case finish == "length":
		turn.Stop = StopLength
	case finish == "content_filter":
		turn.Stop = StopRefused
	case len(turn.Calls) > 0:
		turn.Stop = StopTools
	case finish == "stop" || finish == "":
		turn.Stop = StopDone
	default:
		turn.Stop = StopOther
	}
	return turn, nil
}
