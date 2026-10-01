package provider

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

/*
 * The OpenAI-compatible protocol is spoken directly over HTTP.
 *
 * OpenAI's own SDK was measured at 9 MB of the application for the handful of
 * calls the assistant makes, and it reads OPENAI_* settings from the
 * environment with no public switch to stop it. The services that copy the
 * protocol also vary at its edges, and reading only the fields the assistant
 * uses is what keeps a slightly different one working.
 */

// openAIBaseURL is OpenAI's own address, for an endpoint that names none.
const openAIBaseURL = "https://api.openai.com/v1"

// maxAnswer bounds what is read of an answer: a gateway's model listing runs
// to a few megabytes, and nothing the assistant asks for is larger.
const maxAnswer = 16 << 20

func openAIModels(ctx context.Context, endpoint Endpoint, client *http.Client) ([]Model, error) {
	var listing struct {
		Data []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"data"`
	}
	if err := openAICall(ctx, endpoint, client, http.MethodGet, "models", nil, &listing); err != nil {
		// A service that has no listing answers 404 at the path, which reads
		// as a wrong address when it is only a missing feature.
		var failure *Failure
		if errors.As(err, &failure) && failure.Reason == ReasonNotFound && failure.Status == http.StatusNotFound {
			failure.Reason = ReasonUnlisted
		}
		return nil, err
	}
	models := make([]Model, 0, len(listing.Data))
	for _, info := range listing.Data {
		if len(models) == maxModels {
			break
		}
		if info.ID != "" {
			models = append(models, Model{ID: info.ID, Name: info.Name})
		}
	}
	return models, nil
}

// openAIProbe sets no token limit: the field is max_tokens on most compatible
// services and max_completion_tokens on OpenAI's newer models, and each
// rejects the other. The prompt asks for one word.
func openAIProbe(ctx context.Context, endpoint Endpoint, client *http.Client, model string) error {
	request := map[string]any{
		"model":    model,
		"messages": []map[string]any{{"role": "user", "content": probePrompt}},
		"tools": []map[string]any{{
			"type": "function",
			"function": map[string]any{
				"name":        probeTool,
				"description": probeDescription,
				"parameters":  map[string]any{"type": "object", "properties": map[string]any{}},
			},
		}},
	}
	var answer struct {
		Choices []json.RawMessage `json:"choices"`
	}
	if err := openAICall(ctx, endpoint, client, http.MethodPost, "chat/completions", request, &answer); err != nil {
		return err
	}
	if len(answer.Choices) == 0 {
		return &Failure{Reason: ReasonNotFound,
			Detail: "the answer carried no choices, so this is not a chat completions endpoint"}
	}
	return nil
}

// openAICall makes one request and decodes the answer into answer. The key is
// sent as a bearer token when there is one; a local runner takes none.
func openAICall(
	ctx context.Context, endpoint Endpoint, client *http.Client, method, path string, body, answer any,
) error {
	base := strings.TrimSpace(endpoint.BaseURL)
	if base == "" {
		base = openAIBaseURL
	}
	var payload io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		payload = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(base, "/")+"/"+path, payload)
	if err != nil {
		return fmt.Errorf("%q is not an address a request can be sent to: %w", base, err)
	}
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if key := strings.TrimSpace(endpoint.APIKey); key != "" {
		request.Header.Set("Authorization", "Bearer "+key)
	}

	response, err := client.Do(request)
	if err != nil {
		return classify(err, 0, "")
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, maxAnswer))
	if err != nil {
		return classify(err, 0, "")
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return classify(fmt.Errorf("%s %s: %s", method, path, response.Status), response.StatusCode, string(data))
	}
	if err := json.Unmarshal(data, answer); err != nil {
		return &Failure{Reason: ReasonNotFound, Status: response.StatusCode,
			Detail: "the answer is not this protocol's: " + serviceMessage(string(data))}
	}
	return nil
}
