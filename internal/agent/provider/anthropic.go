package provider

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/anthropics/anthropic-sdk-go/shared/constant"
)

/*
 * anthropicOptions are the request options for an endpoint, and nothing else.
 *
 * The services are built one by one rather than through anthropic.NewClient,
 * which would fall back to ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN,
 * ANTHROPIC_BASE_URL and the SDK's own profile files - and which builds every
 * service the API has, all of which the linker then has to keep.
 */
func anthropicOptions(endpoint Endpoint, client *http.Client) []option.RequestOption {
	options := []option.RequestOption{
		option.WithEnvironmentProduction(),
		option.WithHTTPClient(client),
		option.WithAPIKey(endpoint.APIKey),
		// A person is waiting on these calls; a retry would only make a wrong
		// key or address take three times as long to say so.
		option.WithMaxRetries(0),
	}
	if base := strings.TrimSpace(endpoint.BaseURL); base != "" {
		options = append(options, option.WithBaseURL(base))
	}
	return options
}

func anthropicModels(ctx context.Context, endpoint Endpoint, client *http.Client) ([]Model, error) {
	service := anthropic.NewModelService(anthropicOptions(endpoint, client)...)
	pager := service.ListAutoPaging(ctx, anthropic.ModelListParams{
		Limit: anthropic.Int(100),
	})
	var models []Model
	for pager.Next() && len(models) < maxModels {
		info := pager.Current()
		models = append(models, Model{ID: info.ID, Name: info.DisplayName})
	}
	if err := pager.Err(); err != nil {
		return nil, anthropicFailure(err)
	}
	return models, nil
}

func anthropicProbe(ctx context.Context, endpoint Endpoint, client *http.Client, model string) error {
	params := anthropic.BetaMessageNewParams{
		Model:     anthropic.Model(model),
		MaxTokens: 1024,
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock(probePrompt)),
		},
		Tools: []anthropic.BetaToolUnionParam{{OfTool: &anthropic.BetaToolParam{
			Name:        probeTool,
			Description: anthropic.String(probeDescription),
			InputSchema: anthropic.BetaToolInputSchemaParam{Properties: map[string]any{}},
		}}},
	}
	if endpoint.Fallback && FallsBack(model) {
		params.Fallbacks = anthropic.BetaFallbacksParamUnion{OfDefault: constant.ValueOf[constant.Default]()}
		params.Betas = []anthropic.AnthropicBeta{anthropic.AnthropicBetaServerSideFallback2026_07_01}
	}
	service := anthropic.NewBetaMessageService(anthropicOptions(endpoint, client)...)
	_, err := service.New(ctx, params)
	return anthropicFailure(err)
}

/*
 * FallsBack reports whether a model takes the server-side fallback: a request
 * its safety checks decline is answered by another model instead of coming
 * back refused. Claude Opus 5 and 5.5 take it; asking it of a model that does
 * not is a request the service rejects.
 */
func FallsBack(model string) bool {
	return strings.HasPrefix(model, "claude-opus-5")
}

func anthropicFailure(err error) error {
	if err == nil {
		return nil
	}
	var apiErr *anthropic.Error
	if errors.As(err, &apiErr) {
		return classify(err, apiErr.StatusCode, apiErr.RawJSON())
	}
	return classify(err, 0, "")
}

// maxModels bounds a listing: a gateway in front of many services can name
// thousands, and a menu of thousands is not a choice.
const maxModels = 500
