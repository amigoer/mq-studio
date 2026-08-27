package connection

import (
	"fmt"
	"strings"
	"time"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/internal/timestamp"
)

func (s *Service) getConnectTimeout(connection *model.Connection) time.Duration {
	if connection.TimeoutSec > 0 {
		return time.Duration(connection.TimeoutSec) * time.Second
	}
	if s.settings != nil {
		return s.settings.GetConnectTimeout()
	}
	return defaultConnectionTimeout * time.Second
}

func (s *Service) resolveACLCredentials(connection *model.Connection) (bool, string, string) {
	if connection.EnableACL {
		return true, connection.AccessKey, connection.SecretKey
	}
	if s.settings != nil {
		accessKey, secretKey := s.settings.GetGlobalACLCredentials()
		if strings.TrimSpace(accessKey) != "" && strings.TrimSpace(secretKey) != "" {
			return true, accessKey, secretKey
		}
	}
	return false, "", ""
}

// TestConnection checks whether a saved connection profile can reach RocketMQ.
func (s *Service) TestConnection(id int) (string, error) {
	s.runtimeMu.Lock()
	defer s.runtimeMu.Unlock()

	s.mu.Lock()
	connection, exists := s.connections[id]
	if !exists {
		s.mu.Unlock()
		return "", fmt.Errorf("connection not found: %d", id)
	}
	nameServer := connection.NameServer
	timeout := s.getConnectTimeout(connection)
	enableACL, accessKey, secretKey := s.resolveACLCredentials(connection)
	s.mu.Unlock()

	err := s.runtime.Test(nameServer, timeout, enableACL, accessKey, secretKey)
	s.mu.Lock()
	defer s.mu.Unlock()
	if current, exists := s.connections[id]; exists {
		current.LastCheck = timestamp.Now()
		if err == nil {
			return "online", nil
		}
		return "offline", err
	}
	return "offline", err
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

// Connect activates one profile and makes it the only online default connection.
func (s *Service) Connect(id int) error {
	s.runtimeMu.Lock()
	defer s.runtimeMu.Unlock()
	return s.connectRuntimeLocked(id)
}

// connectRuntimeLocked activates one profile while the caller holds runtimeMu.
func (s *Service) connectRuntimeLocked(id int) error {
	s.mu.RLock()
	connection, exists := s.connections[id]
	if !exists {
		s.mu.RUnlock()
		return fmt.Errorf("连接不存在: %d", id)
	}
	nameServer := connection.NameServer
	timeout := s.getConnectTimeout(connection)
	enableACL, accessKey, secretKey := s.resolveACLCredentials(connection)
	otherNameServers := make([]string, 0)
	for _, current := range s.connections {
		if current.ID != id && current.NameServer != "" && current.NameServer != nameServer {
			otherNameServers = append(otherNameServers, current.NameServer)
		}
	}
	s.mu.RUnlock()

	if err := s.runtime.Connect(nameServer, timeout, enableACL, accessKey, secretKey); err != nil {
		return err
	}
	for _, otherNameServer := range otherNameServers {
		s.runtime.Remove(otherNameServer)
	}
	if err := s.runtime.SetDefault(nameServer); err != nil {
		return err
	}

	s.mu.Lock()
	now := timestamp.Now()
	for _, current := range s.connections {
		if current.ID == id {
			current.Status = model.StatusOnline
			current.LastCheck = now
			current.IsDefault = true
		} else {
			current.Status = model.StatusOffline
			current.IsDefault = false
		}
	}
	err := s.saveConnectionsLocked()
	s.mu.Unlock()
	if err != nil {
		return fmt.Errorf("连接成功，但保存默认连接状态失败: %w", err)
	}
	return nil
}

// Disconnect closes an active profile and promotes the next profile by ID.
func (s *Service) Disconnect(id int) error {
	s.runtimeMu.Lock()
	defer s.runtimeMu.Unlock()
	return s.disconnectRuntimeLocked(id)
}

// disconnectRuntimeLocked deactivates one profile while the caller holds runtimeMu.
func (s *Service) disconnectRuntimeLocked(id int) error {
	s.mu.Lock()
	connection, exists := s.connections[id]
	if !exists {
		s.mu.Unlock()
		return fmt.Errorf("连接不存在: %d", id)
	}
	nameServer := connection.NameServer
	wasDefault := connection.IsDefault
	wasOnline := connection.Status == model.StatusOnline
	s.mu.Unlock()
	if wasOnline {
		s.runtime.Remove(nameServer)
	}

	s.mu.Lock()
	if current, ok := s.connections[id]; ok {
		current.Status = model.StatusOffline
		current.LastCheck = timestamp.Now()
	}
	var newDefaultNameServer string
	newDefaultID := 0
	if wasDefault {
		if current, ok := s.connections[id]; ok {
			current.IsDefault = false
		}
		ids := sortedConnectionIDs(s.connections)
		for _, candidateID := range ids {
			if candidateID == id {
				continue
			}
			current := s.connections[candidateID]
			current.IsDefault = true
			newDefaultID = candidateID
			newDefaultNameServer = current.NameServer
			break
		}
	}
	err := s.saveConnectionsLocked()
	if err != nil && wasDefault {
		if current, ok := s.connections[id]; ok {
			current.IsDefault = true
		}
		if newDefaultID != 0 {
			s.connections[newDefaultID].IsDefault = false
		}
	}
	s.mu.Unlock()
	if err != nil {
		return err
	}
	if newDefaultNameServer != "" {
		_ = s.runtime.SetDefault(newDefaultNameServer)
	}
	return nil
}
