// Package consumer implements RocketMQ consumer group operations.
package consumer

import (
	"sync/atomic"
	"time"
)

// Settings provides the runtime configuration required by consumer operations.
type Settings interface {
	GetRequestTimeout() time.Duration
}

// Service manages RocketMQ consumer groups.
type Service struct {
	nextID   int64
	settings Settings
}

// New creates a consumer group service.
func New(settings Settings) *Service {
	return &Service{
		nextID:   1,
		settings: settings,
	}
}

func (s *Service) getNextID() int {
	return int(atomic.AddInt64(&s.nextID, 1))
}
