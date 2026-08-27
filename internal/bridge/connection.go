package bridge

import (
	"errors"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/connection"
)

// ConnectionService exposes connection management to the frontend.
type ConnectionService struct {
	service *connection.Service
}

// ConnectionView is the connection shape sent to the frontend.
//
// Stored credentials never leave the Go process. The renderer decides what to
// render from SecretsConfigured, which lists the keys that hold a value - a
// list rather than a pair of booleans, because how many credentials a
// connection has is the driver's business, not this struct's.
type ConnectionView struct {
	ID                int                    `json:"id"`
	Name              string                 `json:"name"`
	Group             string                 `json:"group"`
	Kind              model.MQKind           `json:"kind"`
	Endpoints         string                 `json:"endpoints"`
	TimeoutSec        int                    `json:"timeoutSec"`
	AuthMechanism     model.AuthMechanism    `json:"authMechanism"`
	Options           map[string]string      `json:"options"`
	SecretsConfigured []string               `json:"secretsConfigured"`
	Status            model.ConnectionStatus `json:"status"`
	LastCheck         string                 `json:"lastCheck"`
	IsDefault         bool                   `json:"isDefault"`
	Remark            string                 `json:"remark"`
}

// ConnectionInput carries a connection form submission.
//
// Secrets is write-only: it carries what the user just typed, and nothing ever
// sends one back.
type ConnectionInput struct {
	Name       string              `json:"name"`
	Group      string              `json:"group"`
	Kind       model.MQKind        `json:"kind"`
	Endpoints  string              `json:"endpoints"`
	TimeoutSec int                 `json:"timeoutSec"`
	Auth       model.AuthMechanism `json:"authMechanism"`
	Options    map[string]string   `json:"options"`
	Secrets    map[string]string   `json:"secrets"`
	Remark     string              `json:"remark"`

	// CredentialsMode says what to do with secrets the form left blank:
	// preserve what is stored, replace it with what was typed, or clear it.
	CredentialsMode string `json:"credentialsMode"`
}

func (input ConnectionInput) profile() model.ConnectionProfile {
	profile := model.ConnectionProfile{
		Name:       input.Name,
		Group:      input.Group,
		Kind:       input.Kind,
		Endpoints:  input.Endpoints,
		TimeoutSec: input.TimeoutSec,
		Auth:       model.AuthConfig{Mechanism: input.Auth},
		Options:    input.Options,
		Remark:     input.Remark,
	}
	for key, value := range input.Secrets {
		profile.SetSecret(key, value)
	}
	return profile
}

func redactConnection(profile *model.ConnectionProfile) *ConnectionView {
	if profile == nil {
		return nil
	}
	return &ConnectionView{
		ID:                profile.ID,
		Name:              profile.Name,
		Group:             profile.Group,
		Kind:              profile.Kind,
		Endpoints:         profile.Endpoints,
		TimeoutSec:        profile.TimeoutSec,
		AuthMechanism:     profile.Auth.Mechanism,
		Options:           profile.Options,
		SecretsConfigured: profile.ConfiguredSecrets(),
		Status:            profile.Status,
		LastCheck:         profile.LastCheck,
		IsDefault:         profile.IsDefault,
		Remark:            profile.Remark,
	}
}

func redactConnections(profiles []*model.ConnectionProfile) []*ConnectionView {
	result := make([]*ConnectionView, 0, len(profiles))
	for _, profile := range profiles {
		if view := redactConnection(profile); view != nil {
			result = append(result, view)
		}
	}
	return result
}

// List returns every configured connection with credentials redacted.
func (s *ConnectionService) List() []*ConnectionView {
	return redactConnections(s.service.GetConnections())
}

// Add stores a new connection and returns it with credentials redacted.
func (s *ConnectionService) Add(input ConnectionInput) (*ConnectionView, error) {
	created, err := s.service.AddConnection(input.profile())
	if err != nil {
		return nil, err
	}
	return redactConnection(created), nil
}

// Update applies a connection form submission, resolving the credentials mode
// against the currently stored secrets.
func (s *ConnectionService) Update(id int, input ConnectionInput) (*ConnectionView, error) {
	current, err := s.service.GetConnection(id)
	if err != nil {
		return nil, err
	}
	profile := input.profile()

	switch input.CredentialsMode {
	case "preserve", "":
		// A form that shows "already set" instead of the value submits nothing,
		// so an untouched field must keep what is stored rather than clear it.
		for key, stored := range current.Secrets {
			if profile.Secret(key) == "" {
				profile.SetSecret(key, stored)
			}
		}
	case "clear":
		profile.Secrets = nil
		profile.Auth.Mechanism = model.AuthNone
	case "replace":
	default:
		return nil, errors.New("invalid credentials mode")
	}

	updated, err := s.service.UpdateConnection(id, profile)
	if err != nil {
		return nil, err
	}
	return redactConnection(updated), nil
}

// Remove deletes a connection.
func (s *ConnectionService) Remove(id int) error {
	return s.service.DeleteConnection(id)
}

// Connect opens the client for a connection.
func (s *ConnectionService) Connect(id int) error {
	return s.service.Connect(id)
}

// Disconnect closes the client for a connection.
func (s *ConnectionService) Disconnect(id int) error {
	return s.service.Disconnect(id)
}

// ConnectDefault opens the client for the default connection.
func (s *ConnectionService) ConnectDefault() error {
	return s.service.ConnectDefault()
}

// SetDefault marks a connection as the default one.
func (s *ConnectionService) SetDefault(id int) error {
	return s.service.SetDefaultConnection(id)
}

// Test probes a connection and reports the resulting status.
func (s *ConnectionService) Test(id int) (string, error) {
	return s.service.TestConnection(id)
}
