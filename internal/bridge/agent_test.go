package bridge

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/amigoer/mq-studio/internal/agent/assistant"
	"github.com/amigoer/mq-studio/internal/crypto"
)

func TestMain(m *testing.M) {
	directory, err := os.MkdirTemp("", "bridge-key-")
	if err != nil {
		panic(err)
	}
	if err := crypto.InitKey(directory); err != nil {
		panic(err)
	}
	code := m.Run()
	_ = os.RemoveAll(directory)
	os.Exit(code)
}

func agentSettings(t *testing.T) *AgentSettingsService {
	t.Helper()
	return NewAgentSettingsService(assistant.NewStore(filepath.Join(t.TempDir(), "agent.json")), nil)
}

func savedService(t *testing.T, service *AgentSettingsService, base string) AgentProviderView {
	t.Helper()
	view, err := service.SaveProvider(AgentProviderInput{
		Name: "Anthropic", Kind: "anthropic", BaseURL: base, Model: "claude-opus-5-5",
		APIKey: "sk-ant-stored", APIKeyMode: "replace",
	})
	if err != nil {
		t.Fatal(err)
	}
	return view.Providers[0]
}

// The page sees whether a key is set and nothing more: the key never crosses
// into the renderer, where any script could read it.
func TestTheSettingsViewNeverCarriesAKey(t *testing.T) {
	service := agentSettings(t)
	saved := savedService(t, service, "")
	if !saved.APIKeyConfigured || saved.ID == "" {
		t.Fatalf("saved %+v", saved)
	}
	view, err := service.Get()
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(view)
	if strings.Contains(string(encoded), "sk-ant-stored") {
		t.Fatalf("the key reached the renderer: %s", encoded)
	}
	if view.Effort != "medium" || view.Writes != "approve" || len(view.BodyLimits) == 0 {
		t.Errorf("view %+v", view)
	}
	if view.Consented == nil || len(view.Consented) != 0 {
		t.Errorf("a service nobody agreed to reads as %#v", view.Consented)
	}
	agreed, err := service.Consent(saved.ID)
	if err != nil || len(agreed.Consented) != 1 || agreed.Consented[0] != saved.ID {
		t.Errorf("after agreeing: %+v, %v", agreed, err)
	}
}

// A form editing a saved service never has its key, so a test run from it
// with the key left alone has to reach for the stored one - and a test of a
// replaced key has to use the new one, before anything is saved.
func TestATestUsesTheKeyTheFormMeans(t *testing.T) {
	var seen []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Header.Get("X-Api-Key"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"m","type":"message","role":"assistant","model":"claude-opus-5-5",
			"content":[{"type":"text","text":"OK"}],"stop_reason":"end_turn","stop_sequence":null,
			"usage":{"input_tokens":1,"output_tokens":1}}`)
	}))
	t.Cleanup(server.Close)

	service := agentSettings(t)
	saved := savedService(t, service, server.URL)
	form := AgentProviderInput{ID: saved.ID, Name: saved.Name, Kind: saved.Kind, BaseURL: server.URL,
		Model: saved.Model, APIKeyMode: "preserve"}
	if probe := service.TestProvider(form); !probe.OK {
		t.Fatalf("preserve: %+v", probe.Failure)
	}
	form.APIKeyMode, form.APIKey = "replace", "sk-ant-typed"
	if probe := service.TestProvider(form); !probe.OK {
		t.Fatalf("replace: %+v", probe.Failure)
	}
	if len(seen) != 2 || seen[0] != "sk-ant-stored" || seen[1] != "sk-ant-typed" {
		t.Errorf("the service was sent keys %q", seen)
	}

	stored, err := service.Get()
	if err != nil || stored.Providers[0].ID != saved.ID {
		t.Fatal(err)
	}
	if _, found, _ := service.store.Provider(saved.ID); !found {
		t.Fatal("the saved service is gone")
	}
	if kept, _, _ := service.store.Provider(saved.ID); kept.APIKey != "sk-ant-stored" {
		t.Errorf("a test saved the key it was run with: %q", kept.APIKey)
	}
}

func TestAFailedCallSaysWhy(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`)
	}))
	t.Cleanup(server.Close)

	service := agentSettings(t)
	listed := service.ListModels(AgentProviderInput{Kind: "anthropic", BaseURL: server.URL,
		APIKey: "sk-ant-wrong", APIKeyMode: "replace"})
	if listed.Failure == nil || listed.Failure.Reason != "auth" || listed.Failure.Status != 401 ||
		listed.Failure.Detail != "invalid x-api-key" || listed.Models == nil {
		t.Errorf("listed %+v %+v", listed, listed.Failure)
	}

	probe := service.TestProvider(AgentProviderInput{Kind: "grpc", Model: "m"})
	if probe.OK || probe.Failure == nil || probe.Failure.Reason != "invalid" {
		t.Errorf("a form naming no protocol: %+v", probe)
	}
}
