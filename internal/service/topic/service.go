// Package topic implements RocketMQ topic management operations.
package topic

import (
	"sync/atomic"
	"time"
)

// Settings provides the runtime configuration required by topic operations.
type Settings interface {
	GetRequestTimeout() time.Duration
}

// Service manages RocketMQ topics.
type Service struct {
	nextID   int64
	settings Settings
}

// New creates a topic service.
func New(settings Settings) *Service {
	return &Service{
		nextID:   1,
		settings: settings,
	}
}

func (s *Service) getNextID() int {
	return int(atomic.AddInt64(&s.nextID, 1))
}
