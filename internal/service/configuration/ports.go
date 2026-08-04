package configuration

import "github.com/amigoer/rocket-leaf/internal/model"

// Settings defines the settings operations coordinated by configuration flows.
type Settings interface {
	GetSettings() *model.AppSettings
	UpdateSettings(model.AppSettings) (*model.AppSettings, error)
	ResetSettings() (*model.AppSettings, error)
}

// Connections defines the connection operations coordinated by configuration flows.
type Connections interface {
	GetConnections() []*model.Connection
	ValidateConnections([]*model.Connection) error
	ReplaceConnections([]*model.Connection) error
	Reload() error
}
