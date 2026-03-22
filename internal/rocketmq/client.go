// Package rocketmq 封装 RocketMQ Admin 客户端
package rocketmq

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// AdminClientManager 管理 Admin 客户端
type AdminClientManager struct {
	mu                       sync.RWMutex
	clients                  map[string]*admin.Client // key: nameServer 地址
	defaultConn              string                   // 默认连接的 NameServer 地址
	defaultClientInitializer func() error             // 默认连接初始化器（懒连接）
}

// 全局客户端管理器
var clientManager = &AdminClientManager{
	clients: make(map[string]*admin.Client),
}

// GetClientManager 获取客户端管理器实例
func GetClientManager() *AdminClientManager {
	return clientManager
}

// SetDefaultClientInitializer 设置默认连接初始化器
func (m *AdminClientManager) SetDefaultClientInitializer(initializer func() error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.defaultClientInitializer = initializer
}

// GetClient 获取指定 NameServer 的客户端
func (m *AdminClientManager) GetClient(nameServer string) (*admin.Client, error) {
	m.mu.RLock()
	client, exists := m.clients[nameServer]
	m.mu.RUnlock()

	if exists {
		return client, nil
	}

	return nil, fmt.Errorf("客户端未初始化: %s", nameServer)
}

// GetDefaultClient 获取默认连接的客户端
func (m *AdminClientManager) GetDefaultClient() (*admin.Client, error) {
	m.mu.RLock()
	defaultConn := m.defaultConn
	client, exists := m.clients[defaultConn]
	initializer := m.defaultClientInitializer
	m.mu.RUnlock()

	if defaultConn != "" && exists {
		return client, nil
	}

	if initializer != nil {
		if err := initializer(); err != nil {
			return nil, fmt.Errorf("初始化默认连接失败: %w", err)
		}

		m.mu.RLock()
		defaultConn = m.defaultConn
		client, exists = m.clients[defaultConn]
		m.mu.RUnlock()
		if defaultConn != "" && exists {
			return client, nil
		}
	}

	if defaultConn == "" {
		return nil, fmt.Errorf("未设置默认连接")
	}

	return nil, fmt.Errorf("默认连接客户端不存在: %s", defaultConn)
}

// CreateClient 创建新的 Admin 客户端
func (m *AdminClientManager) CreateClient(nameServer string, timeout time.Duration, enableACL bool, accessKey string, secretKey string) (*admin.Client, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// 如果已存在，先关闭旧客户端
	if oldClient, exists := m.clients[nameServer]; exists {
		oldClient.Close()
	}

	options := []admin.Option{
		admin.WithNameServers([]string{nameServer}),
		admin.WithTimeout(timeout),
	}

	if enableACL {
		if strings.TrimSpace(accessKey) == "" || strings.TrimSpace(secretKey) == "" {
			return nil, fmt.Errorf("启用 ACL 时 AccessKey/SecretKey 不能为空")
		}
		options = append(options, admin.WithACL(accessKey, secretKey))
	}

	// 创建新客户端
	client, err := admin.NewClient(options...)
	if err != nil {
		return nil, fmt.Errorf("创建客户端失败: %w", err)
	}

	// 启动客户端
	if err := client.Start(); err != nil {
		return nil, fmt.Errorf("启动客户端失败: %w", err)
	}

	m.clients[nameServer] = client
	return client, nil
}

// RemoveClient 移除并关闭客户端
func (m *AdminClientManager) RemoveClient(nameServer string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if client, exists := m.clients[nameServer]; exists {
		client.Close()
		delete(m.clients, nameServer)
	}

	// 如果移除的是默认连接，清空默认连接
	if m.defaultConn == nameServer {
		m.defaultConn = ""
	}
}

// SetDefaultConnection 设置默认连接
func (m *AdminClientManager) SetDefaultConnection(nameServer string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.clients[nameServer]; !exists {
		return fmt.Errorf("客户端不存在: %s", nameServer)
	}

	m.defaultConn = nameServer
	return nil
}

// GetDefaultConnection 获取默认连接地址
func (m *AdminClientManager) GetDefaultConnection() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.defaultConn
}

// TestConnection 测试连接是否可用
func (m *AdminClientManager) TestConnection(nameServer string, timeout time.Duration, enableACL bool, accessKey string, secretKey string) error {
	options := []admin.Option{
		admin.WithNameServers([]string{nameServer}),
		admin.WithTimeout(timeout),
	}

	if enableACL {
		if strings.TrimSpace(accessKey) == "" || strings.TrimSpace(secretKey) == "" {
			return fmt.Errorf("启用 ACL 时 AccessKey/SecretKey 不能为空")
		}
		options = append(options, admin.WithACL(accessKey, secretKey))
	}

	// 创建临时客户端测试连接
	client, err := admin.NewClient(options...)
	if err != nil {
		return fmt.Errorf("创建测试客户端失败: %w", err)
	}
	defer client.Close()

	if err := client.Start(); err != nil {
		return fmt.Errorf("启动测试客户端失败: %w", err)
	}

	// 尝试获取集群信息来验证连接
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	_, err = client.ExamineBrokerClusterInfo(ctx)
	if err != nil {
		return fmt.Errorf("连接测试失败: %w", err)
	}

	return nil
}

// CloseAll 关闭所有客户端
func (m *AdminClientManager) CloseAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for nameServer, client := range m.clients {
		client.Close()
		delete(m.clients, nameServer)
	}
	m.defaultConn = ""
}
