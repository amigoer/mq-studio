package connection

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"

	"github.com/amigoer/mq-studio/internal/crypto"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/storage/atomicfile"
)

type store struct {
	Connections []*model.Connection `json:"connections"`
}

func (s *Service) loadConnectionsFromFile() error {
	data, err := os.ReadFile(s.dataFilePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}

	var persisted store
	if err := json.Unmarshal(data, &persisted); err != nil {
		return err
	}

	connections := make([]*model.Connection, 0, len(persisted.Connections))
	for _, connection := range persisted.Connections {
		if connection == nil {
			continue
		}
		current := *connection
		if current.AccessKey != "" {
			current.AccessKey, err = crypto.Decrypt(current.AccessKey, "accessKey")
			if err != nil {
				return fmt.Errorf("failed to decrypt AccessKey for connection %q: %w", current.Name, err)
			}
		}
		if current.SecretKey != "" {
			current.SecretKey, err = crypto.Decrypt(current.SecretKey, "secretKey")
			if err != nil {
				return fmt.Errorf("failed to decrypt SecretKey for connection %q: %w", current.Name, err)
			}
		}
		connections = append(connections, &current)
	}

	s.connections, s.nextID = buildConnectionState(connections)
	return nil
}

// buildConnectionState applies the compatibility rules used when loading saved profiles.
func buildConnectionState(connections []*model.Connection) (map[int]*model.Connection, int) {
	loaded := make(map[int]*model.Connection, len(connections))
	nextID := 1
	hasDefault := false
	for _, connection := range connections {
		if connection == nil {
			continue
		}
		current := *connection
		if current.ID <= 0 {
			current.ID = nextID
		}
		if current.ID >= nextID {
			nextID = current.ID + 1
		}
		if _, exists := loaded[current.ID]; exists {
			current.ID = nextID
			nextID++
		}

		current.Group = normalizeConnectionGroup(current.Group)
		current.Status = model.StatusOffline
		current.LastCheck = "-"
		current.TimeoutSec = normalizeTimeoutSec(current.TimeoutSec)
		enabled, accessKey, secretKey, err := normalizeACLConfig(current.EnableACL, current.AccessKey, current.SecretKey)
		if err != nil {
			enabled, accessKey, secretKey = false, "", ""
		}
		current.EnableACL = enabled
		current.AccessKey = accessKey
		current.SecretKey = secretKey

		if current.IsDefault {
			if hasDefault {
				current.IsDefault = false
			} else {
				hasDefault = true
			}
		}
		copy := current
		loaded[current.ID] = &copy
	}

	if len(loaded) > 0 && !hasDefault {
		ids := sortedConnectionIDs(loaded)
		loaded[ids[0]].IsDefault = true
	}
	return loaded, nextID
}

func sortedConnectionIDs(connections map[int]*model.Connection) []int {
	ids := make([]int, 0, len(connections))
	for id := range connections {
		ids = append(ids, id)
	}
	sort.Ints(ids)
	return ids
}

func copyConnectionsSorted(connections map[int]*model.Connection) []*model.Connection {
	result := make([]*model.Connection, 0, len(connections))
	for _, id := range sortedConnectionIDs(connections) {
		connection := connections[id]
		if connection == nil {
			continue
		}
		copy := *connection
		result = append(result, &copy)
	}
	return result
}

func encodeConnectionsForDisk(connections []*model.Connection) ([]byte, error) {
	persisted := store{Connections: make([]*model.Connection, 0, len(connections))}
	for _, connection := range connections {
		if connection == nil {
			continue
		}
		current := *connection
		var err error
		if current.AccessKey != "" {
			current.AccessKey, err = crypto.Encrypt(current.AccessKey, "accessKey")
			if err != nil {
				return nil, fmt.Errorf("failed to encrypt AccessKey: %w", err)
			}
		}
		if current.SecretKey != "" {
			current.SecretKey, err = crypto.Encrypt(current.SecretKey, "secretKey")
			if err != nil {
				return nil, fmt.Errorf("failed to encrypt SecretKey: %w", err)
			}
		}
		copy := current
		persisted.Connections = append(persisted.Connections, &copy)
	}
	return json.MarshalIndent(persisted, "", "  ")
}

// saveConnectionsLocked persists the current state. The caller must hold s.mu for writing.
func (s *Service) saveConnectionsLocked() error {
	data, err := encodeConnectionsForDisk(copyConnectionsSorted(s.connections))
	if err != nil {
		return err
	}
	return atomicfile.Write(s.dataFilePath, data)
}

func prepareReplacement(connections []*model.Connection) ([]*model.Connection, error) {
	prepared := make([]*model.Connection, 0, len(connections))
	for _, connection := range connections {
		if connection == nil {
			continue
		}
		current := *connection
		name, nameServer, err := validateConnectionFields(current.Name, current.NameServer, current.TimeoutSec)
		if err != nil {
			return nil, fmt.Errorf("invalid connection %q: %w", current.Name, err)
		}
		enabled, accessKey, secretKey, err := normalizeACLConfig(current.EnableACL, current.AccessKey, current.SecretKey)
		if err != nil {
			return nil, fmt.Errorf("invalid ACL configuration for connection %q: %w", name, err)
		}
		current.Name = name
		current.NameServer = nameServer
		current.Group = normalizeConnectionGroup(current.Group)
		current.TimeoutSec = normalizeTimeoutSec(current.TimeoutSec)
		current.EnableACL = enabled
		current.AccessKey = accessKey
		current.SecretKey = secretKey
		current.Status = model.StatusOffline
		current.LastCheck = "-"
		prepared = append(prepared, &current)
	}
	normalized, _ := buildConnectionState(prepared)
	return copyConnectionsSorted(normalized), nil
}

// ValidateConnections verifies that profiles can be normalized and encoded
// without changing persisted or runtime connection state.
func (s *Service) ValidateConnections(connections []*model.Connection) error {
	prepared, err := prepareReplacement(connections)
	if err != nil {
		return err
	}
	_, err = encodeConnectionsForDisk(prepared)
	return err
}

// ReplaceConnections validates and atomically replaces all persisted connection profiles.
func (s *Service) ReplaceConnections(connections []*model.Connection) error {
	prepared, err := prepareReplacement(connections)
	if err != nil {
		return err
	}
	data, err := encodeConnectionsForDisk(prepared)
	if err != nil {
		return err
	}

	s.runtimeMu.Lock()
	defer s.runtimeMu.Unlock()

	s.mu.Lock()
	plan := s.reloadPlanLocked()
	if err := atomicfile.Write(s.dataFilePath, data); err != nil {
		s.mu.Unlock()
		return err
	}
	s.connections, s.nextID = buildConnectionState(prepared)
	plan = s.finalizeReloadPlanLocked(plan)
	s.mu.Unlock()

	return s.restoreRuntimeLocked(plan)
}
