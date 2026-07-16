// Package cluster provides RocketMQ cluster inspection services.
package cluster

import (
	"sync"
	"time"
)

// Settings provides the runtime configuration required by cluster operations.
type Settings interface {
	GetRequestTimeout() time.Duration
}

// Service provides cluster status operations.
type Service struct {
	settings Settings

	historyMu sync.Mutex
	history   map[string]*brokerTPSHistory
}

// New creates a cluster status service.
func New(settings Settings) *Service {
	return &Service{
		settings: settings,
		history:  make(map[string]*brokerTPSHistory),
	}
}
