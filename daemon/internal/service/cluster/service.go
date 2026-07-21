// Package cluster provides RocketMQ cluster inspection services.
package cluster

import (
	"log"
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

	historyMu       sync.Mutex
	history         map[string]*brokerTPSHistory
	historyFilePath string
	now             func() time.Time
}

// New creates a cluster status service backed by historyFilePath.
func New(historyFilePath string, settings Settings) *Service {
	service := &Service{
		settings:        settings,
		history:         make(map[string]*brokerTPSHistory),
		historyFilePath: historyFilePath,
		now:             time.Now,
	}
	if err := service.loadTPSHistory(); err != nil {
		log.Printf("[ClusterService] failed to load TPS history: %v", err)
	}
	return service
}
