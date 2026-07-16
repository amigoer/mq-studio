// Package connection manages RocketMQ connection profiles and their runtime lifecycle.
package connection

import (
	"log"
	"strings"
	"sync"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
)

const defaultConnectionTimeout = 5

// Service manages persisted connection profiles and the active RocketMQ client.
type Service struct {
	mu sync.RWMutex
	// runtimeMu serializes profile operations that observe or mutate runtime
	// clients. When both locks are needed, runtimeMu must be acquired before mu.
	runtimeMu       sync.Mutex
	connections     map[int]*model.Connection
	nextID          int
	dataFilePath    string
	settings        Settings
	runtime         clientRuntime
	reconnectReload bool
}

// New creates a connection service backed by dataFilePath.
func New(dataFilePath string, settings Settings) *Service {
	if strings.TrimSpace(dataFilePath) == "" {
		dataFilePath = "connections.json"
	}
	service := &Service{
		connections:  make(map[int]*model.Connection),
		nextID:       1,
		dataFilePath: dataFilePath,
		settings:     settings,
		runtime:      newAdminClientRuntime(),
	}
	if err := service.loadConnectionsFromFile(); err != nil {
		log.Printf("[ConnectionService] failed to load connection config: %v", err)
	}
	return service
}
