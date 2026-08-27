package configuration

import "github.com/amigoer/mq-studio/internal/model"

// Settings defines the settings operations coordinated by configuration flows.
type Settings interface {
	GetSettings() *model.AppSettings
	UpdateSettings(model.AppSettings) (*model.AppSettings, error)
	ResetSettings() (*model.AppSettings, error)
}

// Connections defines the connection operations coordinated by configuration flows.
type Connections interface {
	GetConnections() []*model.ConnectionProfile
	ValidateConnections([]*model.ConnectionProfile) error
	ReplaceConnections([]*model.ConnectionProfile) error
	Reload() error
}
