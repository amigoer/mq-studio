package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/anthropics/anthropic-sdk-go/shared/constant"
)

// anthropicChat keeps the conversation as the Messages API's own params, so a
// turn with thinking goes back exactly as it came.
type anthropicChat struct {
	messages anthropic.BetaMessageService
	params   anthropic.BetaMessageNewParams
	history  []anthropic.BetaMessageParam
}

// conversationOptions are anthropicOptions for a conversation, which retries
// a dropped connection as a person waiting on a settings test does not. The
// SDK retries 429 and 5xx with backoff.
func conversationOptions(endpoint Endpoint, client *http.Client) []option.RequestOption {
	return append(anthropicOptions(endpoint, client), option.WithMaxRetries(2))
}

func newAnthropicChat(ctx context.Context, endpoint Endpoint, client *http.Client, options Options) (*anthropicChat, error) {
	requestOptions := conversationOptions(endpoint, client)
	var history []anthropic.BetaMessageParam
	if len(options.History) > 0 {
		if err := json.Unmarshal(options.History, &history); err != nil {
			return nil, fmt.Errorf("the conversation could not be read back: %w", err)
		}
	}

	params := anthropic.BetaMessageNewParams{
		Model:     anthropic.Model(options.Model),
		MaxTokens: options.MaxTokens,
		// The last system block caches the tools and the system prompt
		// together; the top-level mark caches the conversation up to its tail.
		System:       []anthropic.BetaTextBlockParam{{Text: options.System, CacheControl: anthropic.NewBetaCacheControlEphemeralParam()}},
		CacheControl: anthropic.NewBetaCacheControlEphemeralParam(),
		Tools:        anthropicTools(options.Tools),
	}
	capabilities := anthropicCapabilities(ctx, requestOptions, options.Model)
	if capabilities.adaptive {
		params.Thinking = anthropic.BetaThinkingConfigParamUnion{OfAdaptive: &anthropic.BetaThinkingConfigAdaptiveParam{
			Display: anthropic.BetaThinkingConfigAdaptiveDisplaySummarized,
		}}
	}
	if effort := anthropic.BetaOutputConfigEffort(options.Effort); capabilities.efforts[options.Effort] {
		params.OutputConfig = anthropic.BetaOutputConfigParam{Effort: effort}
	}
	chat := &anthropicChat{messages: anthropic.NewBetaMessageService(requestOptions...), params: params, history: history}
	chat.fallBack(endpoint)
	return chat, nil
}

func (c *anthropicChat) History() (json.RawMessage, error) {
	return json.Marshal(c.history)
}

// fallBack asks for the server-side fallback where the endpoint wants it and
// the model takes it. It is per request, so a conversation can change it.
func (c *anthropicChat) fallBack(endpoint Endpoint) {
	c.params.Fallbacks, c.params.Betas = anthropic.BetaFallbacksParamUnion{}, nil
	if endpoint.Fallback && FallsBack(string(c.params.Model)) {
		c.params.Fallbacks = anthropic.BetaFallbacksParamUnion{OfDefault: constant.ValueOf[constant.Default]()}
		c.params.Betas = []anthropic.AnthropicBeta{anthropic.AnthropicBetaServerSideFallback2026_07_01}
	}
}

func anthropicTools(offered []Tool) []anthropic.BetaToolUnionParam {
	tools := make([]anthropic.BetaToolUnionParam, 0, len(offered))
	for _, tool := range offered {
		schema := closedSchema(tool.Schema)
		input := anthropic.BetaToolInputSchemaParam{Properties: schema["properties"], ExtraFields: map[string]any{}}
		for key, value := range schema {
			switch key {
			case "type", "properties":
			case "required":
				if names, ok := value.([]any); ok {
					for _, name := range names {
						if text, ok := name.(string); ok {
							input.Required = append(input.Required, text)
						}
					}
				}
			default:
				input.ExtraFields[key] = value
			}
		}
		tools = append(tools, anthropic.BetaToolUnionParam{OfTool: &anthropic.BetaToolParam{
			Name:        tool.Name,
			Description: anthropic.String(tool.Description),
			InputSchema: input,
			// Arguments stream as they are written rather than in one burst
			// at the end. The tolerant parser can hand back a cut-short input
			// instead of failing, which is why every input is checked against
			// its schema before anything runs.
			EagerInputStreaming: anthropic.Bool(true),
		}})
	}
	return tools
}

func (c *anthropicChat) Offer(tools []Tool) {
	c.params.Tools = anthropicTools(tools)
}

func (c *anthropicChat) Reach(endpoint Endpoint) error {
	client, err := httpClient(endpoint.Proxy)
	if err != nil {
		return err
	}
	c.messages = anthropic.NewBetaMessageService(conversationOptions(endpoint, client)...)
	c.fallBack(endpoint)
	return nil
}

// modelCapabilities is what the Models API says one model takes.
type modelCapabilities struct {
	adaptive bool
	efforts  map[string]bool
}

/*
 * anthropicCapabilities asks the service what a model takes before the first
 * turn, rather than keeping a list of model names to go stale.
 *
 * A gateway with no Models API answers nothing, and then neither setting is
 * sent: a model that thinks anyway still does, and one that cannot would
 * have refused the request outright.
 */
func anthropicCapabilities(ctx context.Context, options []option.RequestOption, model string) modelCapabilities {
	found := modelCapabilities{efforts: map[string]bool{}}
	service := anthropic.NewModelService(options...)
	info, err := service.Get(ctx, model, anthropic.ModelGetParams{})
	if err != nil || info == nil {
		return found
	}
	found.adaptive = info.Capabilities.Thinking.Types.Adaptive.Supported
	effort := info.Capabilities.Effort
	if effort.Supported {
		found.efforts["low"] = effort.Low.Supported
		found.efforts["medium"] = effort.Medium.Supported
		found.efforts["high"] = effort.High.Supported
	}
	return found
}

func (c *anthropicChat) User(text string) {
	block := anthropic.NewBetaTextBlock(text)
	// Two people-turns in a row - a message after a turn that failed - are
	// one turn to the API, so the text joins the last one.
	if n := len(c.history); n > 0 && c.history[n-1].Role == anthropic.BetaMessageParamRoleUser {
		c.history[n-1].Content = append(c.history[n-1].Content, block)
		return
	}
	c.history = append(c.history, anthropic.NewBetaUserMessage(block))
}

func (c *anthropicChat) Results(results []Result) {
	blocks := make([]anthropic.BetaContentBlockParamUnion, 0, len(results))
	for _, result := range results {
		blocks = append(blocks, anthropic.NewBetaToolResultBlock(result.CallID, result.Content, result.IsError))
	}
	c.history = append(c.history, anthropic.NewBetaUserMessage(blocks...))
}

func (c *anthropicChat) Next(ctx context.Context, delta func(Delta)) (Turn, error) {
	params := c.params
	params.Messages = c.history
	stream := c.messages.NewStreaming(ctx, params)
	message := anthropic.BetaMessage{}
	for stream.Next() {
		event := stream.Current()
		if err := message.Accumulate(event); err != nil {
			_ = stream.Close()
			return Turn{}, err
		}
		if block, ok := event.AsAny().(anthropic.BetaRawContentBlockDeltaEvent); ok {
			switch piece := block.Delta.AsAny().(type) {
			case anthropic.BetaTextDelta:
				delta(Delta{Text: piece.Text})
			case anthropic.BetaThinkingDelta:
				delta(Delta{Thinking: true, Text: piece.Thinking})
			}
		}
	}
	if err := stream.Err(); err != nil {
		return Turn{}, anthropicFailure(err)
	}
	c.history = append(c.history, message.ToParam())

	turn := Turn{
		Model: string(message.Model),
		Usage: Usage{
			Input:      message.Usage.InputTokens,
			Output:     message.Usage.OutputTokens,
			CacheRead:  message.Usage.CacheReadInputTokens,
			CacheWrite: message.Usage.CacheCreationInputTokens,
		},
	}
	var text strings.Builder
	for _, block := range message.Content {
		switch content := block.AsAny().(type) {
		case anthropic.BetaTextBlock:
			text.WriteString(content.Text)
		case anthropic.BetaToolUseBlock:
			input := json.RawMessage(content.JSON.Input.Raw())
			if len(input) == 0 {
				input = json.RawMessage(`{}`)
			}
			turn.Calls = append(turn.Calls, Call{ID: content.ID, Name: content.Name, Input: input})
		}
	}
	turn.Text = text.String()
	switch message.StopReason {
	case anthropic.BetaStopReasonEndTurn, anthropic.BetaStopReasonStopSequence:
		turn.Stop = StopDone
	case anthropic.BetaStopReasonToolUse:
		turn.Stop = StopTools
	case anthropic.BetaStopReasonMaxTokens:
		turn.Stop = StopLength
	case anthropic.BetaStopReasonRefusal:
		turn.Stop, turn.Explanation = StopRefused, message.StopDetails.Explanation
	case anthropic.BetaStopReasonModelContextWindowExceeded:
		turn.Stop = StopContext
	default:
		turn.Stop = StopOther
	}
	return turn, nil
}
