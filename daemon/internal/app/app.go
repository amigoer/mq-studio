// Package app assembles daemon business services and manages their lifecycle.
package app

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/amigoer/rocket-leaf/daemon/internal/crypto"
	"github.com/amigoer/rocket-leaf/daemon/internal/rocketmq"
	"github.com/amigoer/rocket-leaf/daemon/internal/service"
)

// Services aggregates business services required by the HTTP transport layer.
type Services struct {
	Connections *service.ConnectionService
	Cluster     *service.ClusterService
	Topics      *service.TopicService
	Consumers   *service.ConsumerService
	Messages    *service.MessageService
	Settings    *service.SettingsService
	ACL         *service.AclService
}

// New initializes the local encryption key and assembles all business services.
func New() (*Services, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return nil, fmt.Errorf("failed to get user config directory: %w", err)
	}
	if err := crypto.InitKey(filepath.Join(configDir, "rocket-leaf")); err != nil {
		return nil, fmt.Errorf("failed to initialize local encryption key: %w", err)
	}

	settings := service.NewSettingsService()
	connections := service.NewConnectionService(settings)
	services := &Services{
		Connections: connections,
		Cluster:     service.NewClusterService(connections, settings),
		Topics:      service.NewTopicService(settings),
		Consumers:   service.NewConsumerService(settings),
		Messages:    service.NewMessageService(settings),
		Settings:    settings,
		ACL:         service.NewAclService(settings),
	}
	rocketmq.GetClientManager().SetDefaultClientInitializer(connections.ConnectDefault)
	return services, nil
}

// Close releases all RocketMQ clients.
func (s *Services) Close() {
	rocketmq.GetClientManager().CloseAll()
}
