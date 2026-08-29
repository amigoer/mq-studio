// Package configuration coordinates settings and connection configuration workflows.
package configuration

import (
	"fmt"
	"sync"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/storage/layout"
)

// Service provides the settings facade consumed by the HTTP API.
type Service struct {
	mu          sync.Mutex
	layout      layout.Layout
	settings    Settings
	connections Connections

	listenersMu sync.RWMutex
	listeners   []func(*model.AppSettings)
}

// New creates the application configuration coordinator.
func New(paths layout.Layout, settings Settings, connections Connections) *Service {
	return &Service{layout: paths, settings: settings, connections: connections}
}

// OnChange registers a listener invoked after settings are persisted. It lets
// the native shell - the system tray, for instance - follow preferences that
// the renderer alone cannot apply.
func (s *Service) OnChange(listener func(*model.AppSettings)) {
	if listener == nil {
		return
	}
	s.listenersMu.Lock()
	defer s.listenersMu.Unlock()
	s.listeners = append(s.listeners, listener)
}

// notify runs the listeners outside s.mu so a listener may read settings back.
func (s *Service) notify(settings *model.AppSettings) {
	if settings == nil {
		return
	}
	s.listenersMu.RLock()
	listeners := s.listeners
	s.listenersMu.RUnlock()
	for _, listener := range listeners {
		listener(settings)
	}
}

// DataDirectory reports the directory holding the settings, the connections
// and the local encryption key.
func (s *Service) DataDirectory() string {
	return s.layout.Directory
}

// GetSettings returns the current application settings.
func (s *Service) GetSettings() *model.AppSettings {
	return s.settings.GetSettings()
}

// UpdateSettings persists settings and refreshes connections when global credentials change.
func (s *Service) UpdateSettings(next model.AppSettings) (*model.AppSettings, error) {
	updated, err := s.updateSettings(next)
	s.notify(updated)
	return updated, err
}

func (s *Service) updateSettings(next model.AppSettings) (*model.AppSettings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	previous := s.settings.GetSettings()
	updated, err := s.settings.UpdateSettings(next)
	if err != nil {
		return nil, err
	}
	if credentialsChanged(previous, updated) && s.connections != nil {
		if err := s.connections.Reload(); err != nil {
			return updated, fmt.Errorf("设置已保存，但刷新连接失败: %w", err)
		}
	}
	return updated, nil
}

// ResetSettings restores defaults and refreshes connections when credentials were cleared.
func (s *Service) ResetSettings() (*model.AppSettings, error) {
	reset, err := s.resetSettings()
	s.notify(reset)
	return reset, err
}

func (s *Service) resetSettings() (*model.AppSettings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	previous := s.settings.GetSettings()
	reset, err := s.settings.ResetSettings()
	if err != nil {
		return nil, err
	}
	if credentialsChanged(previous, reset) && s.connections != nil {
		if err := s.connections.Reload(); err != nil {
			return reset, fmt.Errorf("设置已重置，但刷新连接失败: %w", err)
		}
	}
	return reset, nil
}

func credentialsChanged(previous, next *model.AppSettings) bool {
	if previous == nil || next == nil {
		return previous != next
	}
	return previous.GlobalAccessKey != next.GlobalAccessKey ||
		previous.GlobalSecretKey != next.GlobalSecretKey
}
