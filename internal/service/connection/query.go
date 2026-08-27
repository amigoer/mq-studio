package connection

import (
	"fmt"

	"github.com/amigoer/mq-studio/internal/model"
)

// GetConnections returns sorted copies of all connection profiles.
func (s *Service) GetConnections() []*model.Connection {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return copyConnectionsSorted(s.connections)
}

// GetConnection returns a copy of one connection profile.
func (s *Service) GetConnection(id int) (*model.Connection, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	connection, exists := s.connections[id]
	if !exists {
		return nil, fmt.Errorf("connection not found: %d", id)
	}
	copy := *connection
	return &copy, nil
}
