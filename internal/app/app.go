// Package app assembles daemon business services and manages their lifecycle.
package app

import (
	"fmt"

	"github.com/amigoer/rocket-leaf/internal/crypto"
	"github.com/amigoer/rocket-leaf/internal/rocketmq"
	"github.com/amigoer/rocket-leaf/internal/service/acl"
	"github.com/amigoer/rocket-leaf/internal/service/cluster"
	"github.com/amigoer/rocket-leaf/internal/service/configuration"
	"github.com/amigoer/rocket-leaf/internal/service/connection"
	"github.com/amigoer/rocket-leaf/internal/service/consumer"
	"github.com/amigoer/rocket-leaf/internal/service/message"
	"github.com/amigoer/rocket-leaf/internal/service/settings"
	"github.com/amigoer/rocket-leaf/internal/service/topic"
	"github.com/amigoer/rocket-leaf/internal/storage/layout"
)

// Services aggregates business services required by the HTTP transport layer.
type Services struct {
	Connections *connection.Service
	Cluster     *cluster.Service
	Topics      *topic.Service
	Consumers   *consumer.Service
	Messages    *message.Service
	Settings    *configuration.Service
	ACL         *acl.Service
}

// New initializes the local encryption key and assembles all business services.
func New() (*Services, error) {
	paths, err := layout.Default()
	if err != nil {
		return nil, err
	}
	if err := crypto.InitKey(paths.Directory); err != nil {
		return nil, fmt.Errorf("failed to initialize local encryption key: %w", err)
	}

	settingsService := settings.New(paths.SettingsFile)
	connections := connection.New(paths.ConnectionsFile, settingsService)
	configurationService := configuration.New(paths, settingsService, connections)
	services := &Services{
		Connections: connections,
		Cluster:     cluster.New(paths.TPSHistoryFile, settingsService),
		Topics:      topic.New(settingsService),
		Consumers:   consumer.New(settingsService),
		Messages:    message.New(settingsService),
		Settings:    configurationService,
		ACL:         acl.New(settingsService),
	}
	rocketmq.GetClientManager().SetDefaultClientInitializer(connections.ConnectDefault)
	return services, nil
}

// Close releases all RocketMQ clients.
func (s *Services) Close() {
	rocketmq.GetClientManager().CloseAll()
}
