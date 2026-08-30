package bridge

import (
	"errors"
	"strings"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/configuration"
)

// SettingsEvent tells the renderer the settings changed. It has to be told:
// the tray writes them too, and the window holds its own copy of the values
// it paints from.
const SettingsEvent = "settings:changed"

// SettingsService exposes application settings to the frontend.
type SettingsService struct {
	service *configuration.Service
}

// SettingsView is the settings shape sent to the frontend, with the global ACL
// credentials replaced by whether they are configured.
type SettingsView struct {
	model.AppSettings
	GlobalAccessKeyConfigured bool `json:"globalAccessKeyConfigured"`
	GlobalSecretKeyConfigured bool `json:"globalSecretKeyConfigured"`
}

// SettingsInput carries a settings form submission.
type SettingsInput struct {
	model.AppSettings
	GlobalCredentialsMode string `json:"globalCredentialsMode"`
}

func redactSettings(settings *model.AppSettings) *SettingsView {
	if settings == nil {
		return nil
	}
	view := *settings
	accessConfigured := strings.TrimSpace(view.GlobalAccessKey) != ""
	secretConfigured := strings.TrimSpace(view.GlobalSecretKey) != ""
	view.GlobalAccessKey = ""
	view.GlobalSecretKey = ""
	return &SettingsView{
		AppSettings:               view,
		GlobalAccessKeyConfigured: accessConfigured,
		GlobalSecretKeyConfigured: secretConfigured,
	}
}

// Get returns the current settings with credentials redacted.
func (s *SettingsService) Get() *SettingsView {
	return redactSettings(s.service.GetSettings())
}

// Update applies a settings form submission, resolving the global credentials
// mode against the currently stored secrets.
func (s *SettingsService) Update(input SettingsInput) (*SettingsView, error) {
	current := s.service.GetSettings()
	switch input.GlobalCredentialsMode {
	case "preserve", "":
		if input.GlobalAccessKey == "" && input.GlobalSecretKey == "" {
			input.GlobalAccessKey = current.GlobalAccessKey
			input.GlobalSecretKey = current.GlobalSecretKey
		}
	case "clear":
		input.GlobalAccessKey, input.GlobalSecretKey = "", ""
	case "replace":
		if strings.TrimSpace(input.GlobalAccessKey) == "" || strings.TrimSpace(input.GlobalSecretKey) == "" {
			return nil, errors.New("AccessKey and SecretKey must both be provided")
		}
	default:
		return nil, errors.New("invalid global credentials mode")
	}
	updated, err := s.service.UpdateSettings(input.AppSettings)
	if err != nil {
		return nil, err
	}
	return redactSettings(updated), nil
}

// Reset restores the default settings.
func (s *SettingsService) Reset() (*SettingsView, error) {
	reset, err := s.service.ResetSettings()
	if err != nil {
		return nil, err
	}
	return redactSettings(reset), nil
}

// ClearCache drops cached broker and topic metadata.
func (s *SettingsService) ClearCache() error {
	return s.service.ClearCache()
}
