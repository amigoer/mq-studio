// Package app assembles the business services and manages their lifecycle.
package app

import (
	"fmt"

	"github.com/amigoer/mq-studio/internal/crypto"
	"github.com/amigoer/mq-studio/internal/driver/rocketmq"
	"github.com/amigoer/mq-studio/internal/service/access"
	"github.com/amigoer/mq-studio/internal/service/cluster"
	"github.com/amigoer/mq-studio/internal/service/collector"
	"github.com/amigoer/mq-studio/internal/service/configuration"
	"github.com/amigoer/mq-studio/internal/service/connection"
	"github.com/amigoer/mq-studio/internal/service/destination"
	"github.com/amigoer/mq-studio/internal/service/message"
	"github.com/amigoer/mq-studio/internal/service/settings"
	"github.com/amigoer/mq-studio/internal/service/subscription"
	"github.com/amigoer/mq-studio/internal/storage/layout"
)

// Services aggregates business services required by the HTTP transport layer.
type Services struct {
	Connections *connection.Service
	Cluster     *cluster.Service
	Topics      *destination.Service
	Consumers   *subscription.Service
	Messages    *message.Service
	Settings    *configuration.Service
	ACL         *access.Service

	// Collector keeps the TPS history filling in while the window is hidden.
	Collector *collector.Collector
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
	clusterService := cluster.New(paths.TPSHistoryFile, rocketmq.CurrentConn, settingsService)
	services := &Services{
		Connections: connections,
		Cluster:     clusterService,
		Topics:      destination.New(rocketmq.CurrentConn, settingsService),
		Consumers:   subscription.New(rocketmq.CurrentConn, settingsService),
		Messages:    message.New(rocketmq.CurrentConn, settingsService),
		Settings:    configurationService,
		ACL:         access.New(rocketmq.CurrentConn, settingsService),
		Collector:   collector.New(clusterService, rocketmq.HasActiveConnection),
	}
	rocketmq.GetClientManager().SetDefaultClientInitializer(connections.ConnectDefault)
	services.Collector.Start()
	return services, nil
}

// Close stops background sampling and releases all RocketMQ clients.
func (s *Services) Close() {
	if s.Collector != nil {
		s.Collector.Stop()
	}
	rocketmq.GetClientManager().CloseAll()
}
