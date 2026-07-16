// Package settings manages persisted application preferences.
package settings

import (
	"log"
	"sync"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
)

// Service manages application settings and their persistence.
type Service struct {
	mu           sync.RWMutex
	settings     *model.AppSettings
	dataFilePath string
}

// New creates a settings service backed by dataFilePath.
func New(dataFilePath string) *Service {
	service := &Service{
		settings:     model.DefaultSettings(),
		dataFilePath: dataFilePath,
	}

	if err := service.loadFromFile(); err != nil {
		log.Printf("[SettingsService] failed to load settings: %v", err)
	}

	return service
}
