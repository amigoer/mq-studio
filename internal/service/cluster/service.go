// Package cluster provides RocketMQ cluster inspection services.
package cluster

import (
	"github.com/amigoer/mq-studio/internal/driver"
	"log"
	"sync"
	"time"
)

// Settings provides the runtime configuration required by cluster operations.
type Settings interface {
	GetRequestTimeout() time.Duration
}

// ConnSource yields the connection a request runs against.
type ConnSource func(connID int) (driver.Conn, error)

// Service provides cluster status operations.
type Service struct {
	conns    ConnSource
	settings Settings

	historyMu       sync.Mutex
	history         map[string]*brokerTPSHistory
	historyFilePath string
	now             func() time.Time
}

// New creates a cluster status service backed by historyFilePath.
func New(historyFilePath string, conns ConnSource, settings Settings) *Service {
	service := &Service{
		conns:           conns,
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
