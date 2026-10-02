package bridge

import (
	"context"
	"errors"
	"time"

	"github.com/amigoer/mq-studio/internal/agent/assistant"
	"github.com/amigoer/mq-studio/internal/agent/provider"
)

// AgentSettingsService sets up the window's assistant: the model services it
// runs on and how it treats writes. A key goes in and never comes back out.
type AgentSettingsService struct {
	store *assistant.Store
	// prune clears out the conversations a new retention no longer keeps,
	// as soon as it is chosen rather than at the next list.
	prune func() error
}

// NewAgentSettingsService fronts the assistant settings kept in store. Prune
// may be nil.
func NewAgentSettingsService(store *assistant.Store, prune func() error) *AgentSettingsService {
	return &AgentSettingsService{store: store, prune: prune}
}

// AgentSettingsView is the assistant's set-up as the settings page shows it.
type AgentSettingsView struct {
	Providers []AgentProviderView `json:"providers"`
	// Default is the provider a new conversation runs on; empty is the first.
	Default   string `json:"default"`
	Effort    string `json:"effort"`
	Writes    string `json:"writes"`
	BodyBytes int    `json:"bodyBytes"`
	// BodyLimits are the caps the page offers for BodyBytes.
	BodyLimits []int `json:"bodyLimits"`
	// Retention is how many days a conversation is kept; zero keeps none.
	Retention int `json:"retention"`
	// Retentions are the choices the page offers for Retention.
	Retentions []int `json:"retentions"`
	// Consented names the providers the person agreed to send data to.
	Consented []string `json:"consented"`
}

// AgentProviderView is a model service with its key replaced by whether one
// is set.
type AgentProviderView struct {
	ID               string `json:"id"`
	Name             string `json:"name"`
	Kind             string `json:"kind"`
	BaseURL          string `json:"baseURL"`
	Model            string `json:"model"`
	Proxy            string `json:"proxy"`
	Fallback         bool   `json:"fallback"`
	APIKeyConfigured bool   `json:"apiKeyConfigured"`
}

// AgentProviderInput is a model service form submission, and what a test or
// a model listing is run with before anything is saved.
type AgentProviderInput struct {
	// ID is empty for a service not saved yet.
	ID       string `json:"id"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	BaseURL  string `json:"baseURL"`
	Model    string `json:"model"`
	Proxy    string `json:"proxy"`
	Fallback bool   `json:"fallback"`
	APIKey   string `json:"apiKey"`
	// APIKeyMode is preserve, replace or clear. Preserve keeps the stored key
	// of the service ID names, and is no key at all for a new one.
	APIKeyMode string `json:"apiKeyMode"`
}

// AgentPreferencesInput is everything on the page that is not a provider.
type AgentPreferencesInput struct {
	Default   string `json:"default"`
	Effort    string `json:"effort"`
	Writes    string `json:"writes"`
	BodyBytes int    `json:"bodyBytes"`
	Retention int    `json:"retention"`
}

// AgentProbe is what a test of a model service found.
type AgentProbe struct {
	OK        bool          `json:"ok"`
	Model     string        `json:"model"`
	ElapsedMs int64         `json:"elapsedMs"`
	Failure   *AgentFailure `json:"failure,omitempty"`
}

// AgentModel is one model a service offers.
type AgentModel struct {
	ID   string `json:"id"`
	Name string `json:"name,omitempty"`
}

// AgentModels is a service's model listing, or why there is none.
type AgentModels struct {
	Models  []AgentModel  `json:"models"`
	Failure *AgentFailure `json:"failure,omitempty"`
}

/*
 * AgentFailure is why a call to a model service failed.
 *
 * Reason is one of provider.Reason, or "invalid" for a form the call could
 * not even be made from, so the page can say what to do about it in the
 * reader's language. Detail is the service's own words, for the rest.
 */
type AgentFailure struct {
	Reason string `json:"reason"`
	Status int    `json:"status"`
	Detail string `json:"detail"`
}

// Get returns the assistant's set-up, keys redacted.
func (s *AgentSettingsService) Get() (*AgentSettingsView, error) {
	settings, err := s.store.Settings()
	if err != nil {
		return nil, err
	}
	return viewOf(settings), nil
}

// SaveProvider adds a model service, or changes the one input.ID names.
func (s *AgentSettingsService) SaveProvider(input AgentProviderInput) (*AgentSettingsView, error) {
	if _, err := s.store.SaveProvider(input.provider(), assistant.KeyChange(input.APIKeyMode)); err != nil {
		return nil, err
	}
	return s.Get()
}

// Consent records that the person agreed to what is sent to a model service,
// which the assistant waits for before it sends anything there.
func (s *AgentSettingsService) Consent(id string) (*AgentSettingsView, error) {
	if err := s.store.Consent(id); err != nil {
		return nil, err
	}
	return s.Get()
}

// DeleteProvider removes a model service and its key.
func (s *AgentSettingsService) DeleteProvider(id string) (*AgentSettingsView, error) {
	if err := s.store.DeleteProvider(id); err != nil {
		return nil, err
	}
	return s.Get()
}

// SavePreferences replaces everything on the page that is not a provider.
func (s *AgentSettingsService) SavePreferences(input AgentPreferencesInput) (*AgentSettingsView, error) {
	if err := s.store.SavePreferences(assistant.Preferences{
		Default:   input.Default,
		Effort:    assistant.Effort(input.Effort),
		Writes:    assistant.Writes(input.Writes),
		BodyBytes: input.BodyBytes,
		Retention: input.Retention,
	}); err != nil {
		return nil, err
	}
	if s.prune != nil {
		if err := s.prune(); err != nil {
			return nil, err
		}
	}
	return s.Get()
}

// TestProvider sends the service one small request carrying a tool, with the
// form as it stands. Nothing is saved.
func (s *AgentSettingsService) TestProvider(input AgentProviderInput) AgentProbe {
	endpoint, err := s.endpoint(input)
	if err != nil {
		return AgentProbe{Failure: failureOf(err)}
	}
	ctx, cancel := context.WithTimeout(context.Background(), probeTimeout)
	defer cancel()
	check, err := provider.Probe(ctx, endpoint, input.Model)
	if err != nil {
		return AgentProbe{Model: input.Model, Failure: failureOf(err)}
	}
	return AgentProbe{OK: true, Model: check.Model, ElapsedMs: check.Elapsed.Milliseconds()}
}

// ListModels asks the service which models it offers, with the form as it
// stands.
func (s *AgentSettingsService) ListModels(input AgentProviderInput) AgentModels {
	endpoint, err := s.endpoint(input)
	if err != nil {
		return AgentModels{Models: []AgentModel{}, Failure: failureOf(err)}
	}
	ctx, cancel := context.WithTimeout(context.Background(), listTimeout)
	defer cancel()
	models, err := provider.Models(ctx, endpoint)
	if err != nil {
		return AgentModels{Models: []AgentModel{}, Failure: failureOf(err)}
	}
	listed := make([]AgentModel, 0, len(models))
	for _, model := range models {
		listed = append(listed, AgentModel{ID: model.ID, Name: model.Name})
	}
	return AgentModels{Models: listed}
}

// A model that thinks before it answers takes a few seconds even for a word;
// a listing is one lookup.
const (
	probeTimeout = 60 * time.Second
	listTimeout  = 20 * time.Second
)

// endpoint resolves a form into what to call, the key included: a key kept
// as stored is read from the store, since the page never had it.
func (s *AgentSettingsService) endpoint(input AgentProviderInput) (provider.Endpoint, error) {
	candidate := input.provider()
	if !candidate.Kind.Valid() {
		return provider.Endpoint{}, errors.New("choose the protocol the service speaks")
	}
	switch assistant.KeyChange(input.APIKeyMode) {
	case assistant.KeyPreserve, "":
		candidate.APIKey = ""
		if input.ID != "" {
			stored, found, err := s.store.Provider(input.ID)
			if err != nil {
				return provider.Endpoint{}, err
			}
			if found {
				candidate.APIKey = stored.APIKey
			}
		}
	case assistant.KeyClear:
		candidate.APIKey = ""
	}
	return candidate.Endpoint(), nil
}

func (input AgentProviderInput) provider() assistant.Provider {
	return assistant.Provider{
		ID:       input.ID,
		Name:     input.Name,
		Kind:     provider.Kind(input.Kind),
		BaseURL:  input.BaseURL,
		APIKey:   input.APIKey,
		Model:    input.Model,
		Proxy:    input.Proxy,
		Fallback: input.Fallback,
	}
}

func viewOf(settings assistant.Settings) *AgentSettingsView {
	view := &AgentSettingsView{
		Providers:  make([]AgentProviderView, 0, len(settings.Providers)),
		Default:    settings.Default,
		Effort:     string(settings.Effort),
		Writes:     string(settings.Writes),
		BodyBytes:  settings.BodyBytes,
		BodyLimits: append([]int(nil), assistant.BodyLimits...),
		Retention:  settings.Retention,
		Retentions: append([]int(nil), assistant.Retentions...),
		Consented:  append([]string{}, settings.Consented...),
	}
	for _, p := range settings.Providers {
		view.Providers = append(view.Providers, AgentProviderView{
			ID:               p.ID,
			Name:             p.Name,
			Kind:             string(p.Kind),
			BaseURL:          p.BaseURL,
			Model:            p.Model,
			Proxy:            p.Proxy,
			Fallback:         p.Fallback,
			APIKeyConfigured: p.APIKey != "",
		})
	}
	return view
}

func failureOf(err error) *AgentFailure {
	var failure *provider.Failure
	if errors.As(err, &failure) {
		return &AgentFailure{Reason: string(failure.Reason), Status: failure.Status, Detail: failure.Detail}
	}
	return &AgentFailure{Reason: "invalid", Detail: err.Error()}
}
