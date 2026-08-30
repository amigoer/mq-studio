package connection

import (
	"fmt"
	"strings"
	"time"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/timestamp"
)

func (s *Service) getConnectTimeout(connection *model.ConnectionProfile) time.Duration {
	if connection.TimeoutSec > 0 {
		return time.Duration(connection.TimeoutSec) * time.Second
	}
	if s.settings != nil {
		return s.settings.GetConnectTimeout()
	}
	return defaultConnectionTimeout * time.Second
}

func (s *Service) resolveACLCredentials(connection *model.ConnectionProfile) (bool, string, string) {
	if connection.ACLEnabled() {
		return true, connection.Secret(model.SecretAccessKey), connection.Secret(model.SecretSecretKey)
	}
	if s.settings != nil {
		accessKey, secretKey := s.settings.GetGlobalACLCredentials()
		if strings.TrimSpace(accessKey) != "" && strings.TrimSpace(secretKey) != "" {
			return true, accessKey, secretKey
		}
	}
	return false, "", ""
}

// resolvedProfileLocked is the profile as the runtime should dial it: the
// stored one with the timeout and any globally configured ACL credentials
// filled in. The caller must hold mu.
//
// Resolving here rather than in the runtime is what keeps application settings
// out of the driver layer - a driver reads only what the profile carries.
func (s *Service) resolvedProfileLocked(id int) (model.ConnectionProfile, error) {
	connection, exists := s.connections[id]
	if !exists {
		return model.ConnectionProfile{}, fmt.Errorf("连接不存在: %d", id)
	}
	return s.resolveForDial(connection), nil
}

// resolveForDial fills a profile's blanks from application settings.
func (s *Service) resolveForDial(connection *model.ConnectionProfile) model.ConnectionProfile {
	resolved := connection.Clone()
	resolved.TimeoutSec = int(s.getConnectTimeout(connection) / time.Second)
	enableACL, accessKey, secretKey := s.resolveACLCredentials(connection)
	resolved.SetACL(enableACL, accessKey, secretKey)
	return *resolved
}

// ProbeProfile tests parameters that are not stored yet.
//
// The new-connection dialog draws a test button beside a form that has no id
// to name, so the probe takes the draft itself. Nothing is persisted and no
// client is kept: it is TestConnection for a connection that does not exist.
func (s *Service) ProbeProfile(profile model.ConnectionProfile) error {
	if strings.TrimSpace(profile.Endpoints) == "" {
		return fmt.Errorf("connection endpoints cannot be empty")
	}
	if profile.Kind == "" {
		profile.Kind = model.KindRocketMQ
	}
	return s.runtime.Test(s.resolveForDial(&profile))
}

// TestConnection checks whether a saved connection profile can be reached.
func (s *Service) TestConnection(id int) (string, error) {
	defer s.notifyChanged()
	s.runtimeMu.Lock()
	defer s.runtimeMu.Unlock()

	s.mu.Lock()
	resolved, err := s.resolvedProfileLocked(id)
	s.mu.Unlock()
	if err != nil {
		return "", err
	}

	testErr := s.runtime.Test(resolved)
	s.mu.Lock()
	defer s.mu.Unlock()
	if current, exists := s.connections[id]; exists {
		current.LastCheck = timestamp.Now()
	}
	if testErr == nil {
		return "online", nil
	}
	return "offline", testErr
}

// ConnectDefault connects the default profile when automatic reconnection is enabled.
func (s *Service) ConnectDefault() error {
	if s.settings != nil && !s.settings.GetAutoConnectLast() {
		return nil
	}
	s.mu.RLock()
	defaultID := 0
	for _, connection := range s.connections {
		if connection.IsDefault {
			defaultID = connection.ID
			break
		}
	}
	s.mu.RUnlock()
	if defaultID == 0 {
		return nil
	}
	return s.Connect(defaultID)
}

// Connect opens one profile. Connections opened earlier stay open: the shell
// shows one tab per connection and expects each tab's pages to keep answering.
func (s *Service) Connect(id int) error {
	defer s.notifyChanged()
	s.runtimeMu.Lock()
	defer s.runtimeMu.Unlock()
	return s.connectRuntimeLocked(id)
}

// connectRuntimeLocked activates one profile while the caller holds runtimeMu.
func (s *Service) connectRuntimeLocked(id int) error {
	s.mu.Lock()
	resolved, err := s.resolvedProfileLocked(id)
	s.mu.Unlock()
	if err != nil {
		return err
	}

	if err := s.runtime.Connect(resolved); err != nil {
		return err
	}

	s.mu.Lock()
	if current, ok := s.connections[id]; ok {
		current.Status = model.StatusOnline
		current.LastCheck = timestamp.Now()
	}
	err = s.saveConnectionsLocked()
	s.mu.Unlock()
	if err != nil {
		return fmt.Errorf("连接成功，但保存连接状态失败: %w", err)
	}
	return nil
}

// Disconnect closes one open profile.
//
// It no longer promotes a replacement default: with several connections open
// at once, "default" means only which profile reconnects on launch, and
// closing a tab is not a statement about that.
func (s *Service) Disconnect(id int) error {
	defer s.notifyChanged()
	s.runtimeMu.Lock()
	defer s.runtimeMu.Unlock()
	return s.disconnectRuntimeLocked(id)
}

// disconnectRuntimeLocked deactivates one profile while the caller holds runtimeMu.
func (s *Service) disconnectRuntimeLocked(id int) error {
	s.mu.Lock()
	_, exists := s.connections[id]
	s.mu.Unlock()
	if !exists {
		return fmt.Errorf("连接不存在: %d", id)
	}

	s.runtime.Remove(id)

	s.mu.Lock()
	defer s.mu.Unlock()
	if current, ok := s.connections[id]; ok {
		current.Status = model.StatusOffline
		current.LastCheck = timestamp.Now()
	}
	return s.saveConnectionsLocked()
}
