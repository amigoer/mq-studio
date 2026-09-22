// Package connection manages RocketMQ connection profiles and their runtime lifecycle.
package connection

import (
	"log"
	"strings"
	"sync"

	"github.com/amigoer/mq-studio/internal/model"
)

const defaultConnectionTimeout = 5

// Service manages persisted connection profiles and the active RocketMQ client.
type Service struct {
	mu sync.RWMutex
	// runtimeMu serializes profile operations that observe or mutate runtime
	// clients. When both locks are needed, runtimeMu must be acquired before mu.
	runtimeMu       sync.Mutex
	connections     map[int]*model.ConnectionProfile
	nextID          int
	dataFilePath    string
	settings        Settings
	runtime         ClientRuntime
	endpoints       EndpointPolicy
	reconnectReload bool

	// lastRead is the store as last read from disk and dialed is each profile
	// as OpenReadOnly dialled it; only RefreshReadOnly reads them.
	lastRead []byte
	dialed   map[int]model.ConnectionProfile

	listenersMu sync.RWMutex
	listeners   []func([]*model.ConnectionProfile)
}

// New creates a connection service backed by dataFilePath.
//
// The runtime and the endpoint policy are injected rather than constructed
// here so this package stays free of any driver import.
func New(dataFilePath string, settings Settings, runtime ClientRuntime, endpoints EndpointPolicy) *Service {
	if strings.TrimSpace(dataFilePath) == "" {
		dataFilePath = "connections.json"
	}
	service := &Service{
		connections:  make(map[int]*model.ConnectionProfile),
		nextID:       1,
		dataFilePath: dataFilePath,
		settings:     settings,
		runtime:      runtime,
		endpoints:    endpoints,
		dialed:       make(map[int]model.ConnectionProfile),
	}
	if err := service.loadConnectionsFromFile(); err != nil {
		log.Printf("[ConnectionService] failed to load connection config: %v", err)
	}
	return service
}
