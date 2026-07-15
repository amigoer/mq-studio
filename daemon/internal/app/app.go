// Package app 负责守护进程业务服务的装配与生命周期管理。
package app

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/amigoer/rocket-leaf/daemon/internal/crypto"
	"github.com/amigoer/rocket-leaf/daemon/internal/rocketmq"
	"github.com/amigoer/rocket-leaf/daemon/internal/service"
)

// Services 汇总 HTTP 传输层所需的业务服务。
type Services struct {
	Connections *service.ConnectionService
	Cluster     *service.ClusterService
	Topics      *service.TopicService
	Consumers   *service.ConsumerService
	Messages    *service.MessageService
	Settings    *service.SettingsService
	ACL         *service.AclService
}

// New 初始化本地加密密钥并装配全部业务服务。
func New() (*Services, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return nil, fmt.Errorf("获取用户配置目录失败: %w", err)
	}
	if err := crypto.InitKey(filepath.Join(configDir, "rocket-leaf")); err != nil {
		return nil, fmt.Errorf("初始化本地加密密钥失败: %w", err)
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

// Close 释放全部 RocketMQ 客户端。
func (s *Services) Close() {
	rocketmq.GetClientManager().CloseAll()
}
