package connection

import (
	"fmt"
	"log"

	"github.com/amigoer/mq-studio/internal/model"
)

// AddConnection adds and persists a connection profile.
func (s *Service) AddConnection(name, group, nameServer string, timeoutSec int, enableACL bool, accessKey, secretKey, remark string) (*model.ConnectionProfile, error) {
	var err error
	name, nameServer, err = validateConnectionFields(name, nameServer, timeoutSec)
	if err != nil {
		return nil, err
	}
	enableACL, accessKey, secretKey, err = normalizeACLConfig(enableACL, accessKey, secretKey)
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	connection := &model.ConnectionProfile{
		ID:         s.nextID,
		Name:       name,
		Group:      normalizeConnectionGroup(group),
		Endpoints:  nameServer,
		TimeoutSec: normalizeTimeoutSec(timeoutSec),
		Kind:       model.KindRocketMQ,
		Status:     model.StatusOffline,
		LastCheck:  "-",
		IsDefault:  len(s.connections) == 0,
		Remark:     remark,
	}
	connection.SetACL(enableACL, accessKey, secretKey)
	s.connections[connection.ID] = connection
	if err := s.saveConnectionsLocked(); err != nil {
		delete(s.connections, connection.ID)
		return nil, fmt.Errorf("failed to save connection config: %w", err)
	}
	s.nextID++
	copy := *connection
	return &copy, nil
}

// UpdateConnection updates and persists a connection profile.
func (s *Service) UpdateConnection(id int, name, group, nameServer string, timeoutSec int, enableACL bool, accessKey, secretKey, remark string) (*model.ConnectionProfile, error) {
	var err error
	name, nameServer, err = validateConnectionFields(name, nameServer, timeoutSec)
	if err != nil {
		return nil, err
	}

	s.runtimeMu.Lock()
	defer s.runtimeMu.Unlock()

	s.mu.Lock()
	connection, exists := s.connections[id]
	if !exists {
		s.mu.Unlock()
		return nil, fmt.Errorf("connection not found: %d", id)
	}
	enableACL, accessKey, secretKey, err = normalizeACLConfig(enableACL, accessKey, secretKey)
	if err != nil {
		s.mu.Unlock()
		return nil, err
	}
	previous := *connection
	connection.Name = name
	connection.Group = normalizeConnectionGroup(group)
	connection.Endpoints = nameServer
	connection.TimeoutSec = normalizeTimeoutSec(timeoutSec)
	connection.SetACL(enableACL, accessKey, secretKey)
	connection.Remark = remark
	clientConfigChanged := previous.Endpoints != connection.Endpoints ||
		previous.TimeoutSec != connection.TimeoutSec ||
		previous.ACLEnabled() != connection.ACLEnabled() ||
		previous.Secret(model.SecretAccessKey) != connection.Secret(model.SecretAccessKey) ||
		previous.Secret(model.SecretSecretKey) != connection.Secret(model.SecretSecretKey)
	wasOnline := previous.Status == model.StatusOnline
	if clientConfigChanged {
		connection.Status = model.StatusOffline
	}
	if err := s.saveConnectionsLocked(); err != nil {
		*connection = previous
		s.mu.Unlock()
		return nil, fmt.Errorf("failed to save connection config: %w", err)
	}
	result := *connection
	s.mu.Unlock()

	if clientConfigChanged && wasOnline {
		s.runtime.Remove(previous.Endpoints)
		if err := s.connectRuntimeLocked(id); err != nil {
			return &result, fmt.Errorf("connection config saved, but reconnect with new config failed: %w", err)
		}
		return s.GetConnection(id)
	}
	return &result, nil
}

// DeleteConnection removes a persisted connection profile.
func (s *Service) DeleteConnection(id int) error {
	s.runtimeMu.Lock()
	defer s.runtimeMu.Unlock()

	s.mu.Lock()
	defer s.mu.Unlock()
	connection, exists := s.connections[id]
	if !exists {
		return fmt.Errorf("connection not found: %d", id)
	}
	if connection.IsDefault && len(s.connections) > 1 {
		return fmt.Errorf("cannot delete the default connection; set another connection as default first")
	}

	deleted := *connection
	delete(s.connections, id)
	newDefaultID := 0
	if len(s.connections) > 0 && deleted.IsDefault {
		ids := sortedConnectionIDs(s.connections)
		s.connections[ids[0]].IsDefault = true
		newDefaultID = ids[0]
	}
	if err := s.saveConnectionsLocked(); err != nil {
		s.connections[id] = &deleted
		if newDefaultID != 0 {
			s.connections[newDefaultID].IsDefault = false
		}
		return fmt.Errorf("failed to save connection config: %w", err)
	}
	if deleted.Status == model.StatusOnline {
		s.runtime.Remove(deleted.Endpoints)
	}
	return nil
}

// SetDefaultConnection selects the default connection profile.
func (s *Service) SetDefaultConnection(id int) error {
	s.runtimeMu.Lock()
	defer s.runtimeMu.Unlock()

	s.mu.Lock()
	defer s.mu.Unlock()
	connection, exists := s.connections[id]
	if !exists {
		return fmt.Errorf("connection not found: %d", id)
	}

	clientExists := s.runtime.HasClient(connection.Endpoints)
	if connection.IsDefault {
		if clientExists {
			return s.runtime.SetDefault(connection.Endpoints)
		}
		return nil
	}

	previousDefaultNameServer := ""
	for _, current := range s.connections {
		if current.IsDefault {
			previousDefaultNameServer = current.Endpoints
			break
		}
	}
	runtimeDefaultChanged := false
	if clientExists {
		if err := s.runtime.SetDefault(connection.Endpoints); err != nil {
			return err
		}
		runtimeDefaultChanged = true
	}
	for _, current := range s.connections {
		current.IsDefault = false
	}
	connection.IsDefault = true
	if err := s.saveConnectionsLocked(); err != nil {
		for _, current := range s.connections {
			current.IsDefault = current.Endpoints == previousDefaultNameServer
		}
		if runtimeDefaultChanged && previousDefaultNameServer != "" && previousDefaultNameServer != connection.Endpoints {
			if resetErr := s.runtime.SetDefault(previousDefaultNameServer); resetErr != nil {
				log.Printf("[ConnectionService] 回滚默认连接失败: %v", resetErr)
			}
		}
		return fmt.Errorf("保存连接配置失败: %w", err)
	}
	return nil
}
