package settings

import "github.com/amigoer/rocket-leaf/daemon/internal/model"

// Service defines the settings operations required by the HTTP transport.
type Service interface {
	GetSettings() *model.AppSettings
	UpdateSettings(model.AppSettings) (*model.AppSettings, error)
	ResetSettings() (*model.AppSettings, error)
	ClearCache() error
	ExportAllConfig() (string, error)
	ImportAllConfig(string) error
}
