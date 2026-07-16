package settings

import (
	"time"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
)

// GetConnectTimeout returns the configured connection timeout.
func (s *Service) GetConnectTimeout() time.Duration {
	s.mu.RLock()
	defer s.mu.RUnlock()
	milliseconds := s.settings.ConnectTimeoutMs
	if milliseconds <= 0 {
		milliseconds = 3000
	}
	return time.Duration(milliseconds) * time.Millisecond
}

// GetRequestTimeout returns the configured request timeout.
func (s *Service) GetRequestTimeout() time.Duration {
	s.mu.RLock()
	defer s.mu.RUnlock()
	milliseconds := s.settings.RequestTimeoutMs
	if milliseconds <= 0 {
		milliseconds = 5000
	}
	return time.Duration(milliseconds) * time.Millisecond
}

// GetFetchLimit returns the configured page fetch limit.
func (s *Service) GetFetchLimit() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	limit := s.settings.FetchLimit
	if limit <= 0 {
		limit = 64
	}
	return limit
}

// GetAutoConnectLast reports whether the last-used cluster should connect automatically.
func (s *Service) GetAutoConnectLast() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.settings.AutoConnectLast
}

// GetGlobalACLCredentials returns the configured global credentials in plaintext.
func (s *Service) GetGlobalACLCredentials() (accessKey, secretKey string) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.settings.GlobalAccessKey, s.settings.GlobalSecretKey
}

// GetSettings returns a copy of the current settings.
func (s *Service) GetSettings() *model.AppSettings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	settings := *s.settings
	return &settings
}
