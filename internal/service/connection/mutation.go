package connection

import (
	"fmt"

	"github.com/amigoer/mq-studio/internal/model"
)

// AddConnection adds and persists a connection profile.
//
// Everything family-specific arrives inside the profile - endpoints, options,
// secrets - so adding a broker family never widens this signature.
func (s *Service) AddConnection(input model.ConnectionProfile) (*model.ConnectionProfile, error) {
	name, endpoints, err := validateConnectionFields(input.Name, input.Endpoints, input.TimeoutSec)
	if err != nil {
		return nil, err
	}
	enableACL, accessKey, secretKey, err := normalizeACLConfig(
		input.ACLEnabled(), input.Secret(model.SecretAccessKey), input.Secret(model.SecretSecretKey))
	if err != nil {
		return nil, err
	}
	group, timeoutSec, remark := input.Group, input.TimeoutSec, input.Remark
	kind := input.Kind
	if kind == "" {
		kind = model.KindRocketMQ
	}

	defer s.notifyChanged()
	s.mu.Lock()
	defer s.mu.Unlock()
	connection := &model.ConnectionProfile{
		ID:         s.nextID,
		Name:       name,
		Group:      normalizeConnectionGroup(group),
		Endpoints:  endpoints,
		TimeoutSec: timeoutSec,
		Kind:       kind,
		Options:    input.Options,
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
func (s *Service) UpdateConnection(id int, input model.ConnectionProfile) (*model.ConnectionProfile, error) {
	name, endpoints, err := validateConnectionFields(input.Name, input.Endpoints, input.TimeoutSec)
	if err != nil {
		return nil, err
	}
	enableACL, accessKey, secretKey := input.ACLEnabled(),
		input.Secret(model.SecretAccessKey), input.Secret(model.SecretSecretKey)
	group, timeoutSec, remark := input.Group, input.TimeoutSec, input.Remark

	defer s.notifyChanged()
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
	connection.Endpoints = endpoints
	if input.Kind != "" {
		connection.Kind = input.Kind
	}
	if input.Options != nil {
		connection.Options = input.Options
	}
	connection.TimeoutSec = timeoutSec
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
		s.runtime.Remove(id)
		if err := s.connectRuntimeLocked(id); err != nil {
			return &result, fmt.Errorf("connection config saved, but reconnect with new config failed: %w", err)
		}
		return s.GetConnection(id)
	}
	return &result, nil
}

// DeleteConnection removes a persisted connection profile.
func (s *Service) DeleteConnection(id int) error {
	defer s.notifyChanged()
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
		s.runtime.Remove(id)
	}
	return nil
}

// SetDefaultConnection selects the default connection profile.
//
// Default is a stored flag and nothing more: it names the profile
// ConnectDefault opens on launch. It used to also move the runtime's one
// shared client, which is why it had a rollback path; several connections can
// be open at once now, so nothing runtime-side has to move.
func (s *Service) SetDefaultConnection(id int) error {
	defer s.notifyChanged()
	s.mu.Lock()
	defer s.mu.Unlock()

	connection, exists := s.connections[id]
	if !exists {
		return fmt.Errorf("connection not found: %d", id)
	}
	if connection.IsDefault {
		return nil
	}

	previousDefaultID := 0
	for _, current := range s.connections {
		if current.IsDefault {
			previousDefaultID = current.ID
			break
		}
	}
	for _, current := range s.connections {
		current.IsDefault = false
	}
	connection.IsDefault = true
	if err := s.saveConnectionsLocked(); err != nil {
		connection.IsDefault = false
		if previousDefaultID != 0 {
			s.connections[previousDefaultID].IsDefault = true
		}
		return fmt.Errorf("保存连接配置失败: %w", err)
	}
	return nil
}
