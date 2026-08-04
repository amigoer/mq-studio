// Package message provides RocketMQ message query and command services.
package message

import (
	"sync/atomic"
	"time"
)

// Settings provides the runtime configuration required by message operations.
type Settings interface {
	GetRequestTimeout() time.Duration
	GetFetchLimit() int
}

// Service provides message query and command operations.
type Service struct {
	nextID   int64
	settings Settings
}

// New creates a message service.
func New(settings Settings) *Service {
	return &Service{
		nextID:   1,
		settings: settings,
	}
}

func (s *Service) getNextID() int {
	return int(atomic.AddInt64(&s.nextID, 1))
}
