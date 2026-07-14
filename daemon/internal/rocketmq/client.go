// Package rocketmq 封装 RocketMQ Admin 客户端
package rocketmq

import (
	"context"
	"fmt"
	"log"
	"slices"
	"strings"
	"sync"
	"time"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// AdminClientManager 管理 Admin 客户端
type AdminClientManager struct {
	mu                       sync.RWMutex
	createMu                 sync.Mutex
	clients                  map[string]*admin.Client // key: nameServer 地址
	configs                  map[string]ClientConfig  // key: nameServer 原始配置
	defaultConn              string                   // 默认连接的 NameServer 地址
	defaultClientInitializer func() error             // 默认连接初始化器（懒连接）
}

// ClientConfig 是创建 Admin 客户端时使用的完整连接参数。
// Producer 等额外客户端必须复用这些参数，避免 ACL 或多 NameServer 配置丢失。
type ClientConfig struct {
	NameServers []string
	Timeout     time.Duration
	EnableACL   bool
	AccessKey   string
	SecretKey   string
}

// 全局客户端管理器
var clientManager = &AdminClientManager{
	clients: make(map[string]*admin.Client),
	configs: make(map[string]ClientConfig),
}

// ParseNameServers 把用户配置中的分号、逗号或空白分隔地址转换为客户端地址列表。
func ParseNameServers(raw string) []string {
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ';' || r == ',' || r == ' ' || r == '\t' || r == '\r' || r == '\n'
	})
	result := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, part := range parts {
		addr := strings.TrimSpace(part)
		if addr == "" {
			continue
		}
		if _, exists := seen[addr]; exists {
			continue
		}
		seen[addr] = struct{}{}
		result = append(result, addr)
	}
	return result
}

func sameClientConfig(a, b ClientConfig) bool {
	return a.Timeout == b.Timeout &&
		a.EnableACL == b.EnableACL &&
		a.AccessKey == b.AccessKey &&
		a.SecretKey == b.SecretKey &&
		slices.Equal(a.NameServers, b.NameServers)
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
	nameServers := ParseNameServers(nameServer)
	if len(nameServers) == 0 {
		return nil, fmt.Errorf("NameServer 地址不能为空")
	}
	config := ClientConfig{
		NameServers: nameServers,
		Timeout:     timeout,
		EnableACL:   enableACL,
		AccessKey:   strings.TrimSpace(accessKey),
		SecretKey:   strings.TrimSpace(secretKey),
	}

	// 串行化创建过程，避免多个懒初始化请求互相关闭刚创建的客户端。
	// 网络握手期间不持有 m.mu，已有客户端仍可继续处理读请求。
	m.createMu.Lock()
	defer m.createMu.Unlock()

	m.mu.RLock()
	existingClient, exists := m.clients[nameServer]
	existingConfig, hasConfig := m.configs[nameServer]
	m.mu.RUnlock()
	if exists && hasConfig && sameClientConfig(existingConfig, config) {
		return existingClient, nil
	}

	options := []admin.Option{
		admin.WithNameServers(nameServers),
		admin.WithTimeout(timeout),
	}

	if enableACL {
		if config.AccessKey == "" || config.SecretKey == "" {
			return nil, fmt.Errorf("启用 ACL 时 AccessKey/SecretKey 不能为空")
		}
		options = append(options, admin.WithACL(config.AccessKey, config.SecretKey))
	}

	// 创建新客户端
	client, err := admin.NewClient(options...)
	if err != nil {
		return nil, fmt.Errorf("创建客户端失败: %w", err)
	}

	// 启动客户端
	if err := client.Start(); err != nil {
		client.Close()
		return nil, fmt.Errorf("启动客户端失败: %w", err)
	}

	// 验证连接可用性：尝试获取集群信息
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	if _, err := client.ExamineBrokerClusterInfo(ctx); err != nil {
		client.Close()
		return nil, fmt.Errorf("无法连接到 NameServer: %w", err)
	}

	log.Printf("[ClientManager] 连接 NameServer 成功: %s", nameServer)
	m.mu.Lock()
	if m.clients == nil {
		m.clients = make(map[string]*admin.Client)
	}
	if m.configs == nil {
		m.configs = make(map[string]ClientConfig)
	}
	oldClient := m.clients[nameServer]
	m.clients[nameServer] = client
	m.configs[nameServer] = config
	m.mu.Unlock()
	if oldClient != nil && oldClient != client {
		oldClient.Close()
	}
	return client, nil
}

// RemoveClient 移除并关闭客户端
func (m *AdminClientManager) RemoveClient(nameServer string) {
	m.createMu.Lock()
	defer m.createMu.Unlock()
	m.mu.Lock()
	defer m.mu.Unlock()

	if client, exists := m.clients[nameServer]; exists {
		client.Close()
		delete(m.clients, nameServer)
	}
	delete(m.configs, nameServer)

	// 如果移除的是默认连接，清空默认连接
	if m.defaultConn == nameServer {
		m.defaultConn = ""
	}
}

// GetDefaultClientConfig 返回默认客户端的完整连接参数副本。
func (m *AdminClientManager) GetDefaultClientConfig() (ClientConfig, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.defaultConn == "" {
		return ClientConfig{}, fmt.Errorf("未设置默认连接")
	}
	config, exists := m.configs[m.defaultConn]
	if !exists {
		return ClientConfig{}, fmt.Errorf("默认连接配置不存在: %s", m.defaultConn)
	}
	config.NameServers = append([]string(nil), config.NameServers...)
	return config, nil
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
	nameServers := ParseNameServers(nameServer)
	if len(nameServers) == 0 {
		return fmt.Errorf("NameServer 地址不能为空")
	}
	options := []admin.Option{
		admin.WithNameServers(nameServers),
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
	m.createMu.Lock()
	defer m.createMu.Unlock()
	m.mu.Lock()
	defer m.mu.Unlock()

	for nameServer, client := range m.clients {
		client.Close()
		delete(m.clients, nameServer)
		delete(m.configs, nameServer)
	}
	m.defaultConn = ""
}
