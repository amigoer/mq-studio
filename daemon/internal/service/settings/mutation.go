package settings

import "github.com/amigoer/rocket-leaf/daemon/internal/model"

// UpdateSettings replaces and persists the application settings.
func (s *Service) UpdateSettings(settings model.AppSettings) (*model.AppSettings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	settings = normalize(settings)
	previous := *s.settings
	s.settings = &settings
	if err := s.saveLocked(); err != nil {
		s.settings = &previous
		return nil, err
	}

	result := *s.settings
	return &result, nil
}

// ResetSettings restores and persists the default settings.
func (s *Service) ResetSettings() (*model.AppSettings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	previous := *s.settings
	s.settings = model.DefaultSettings()
	if err := s.saveLocked(); err != nil {
		s.settings = &previous
		return nil, err
	}

	result := *s.settings
	return &result, nil
}
