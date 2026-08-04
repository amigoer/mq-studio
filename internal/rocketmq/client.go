// Package rocketmq wraps the RocketMQ Admin client.
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

// AdminClientManager manages Admin clients.
type AdminClientManager struct {
	mu                       sync.RWMutex
	createMu                 sync.Mutex
	clients                  map[string]*admin.Client // key: NameServer address
	configs                  map[string]ClientConfig  // key: original NameServer configuration
	defaultConn              string                   // NameServer address of the default connection
	defaultClientInitializer func() error             // lazy initializer for the default connection
}

// ClientConfig contains the complete connection parameters used to create an Admin client.
// Additional clients, such as producers, must reuse these parameters to preserve ACL and multi-NameServer settings.
type ClientConfig struct {
	NameServers []string
	Timeout     time.Duration
	EnableACL   bool
	AccessKey   string
	SecretKey   string
}

// Global client manager.
var clientManager = &AdminClientManager{
	clients: make(map[string]*admin.Client),
	configs: make(map[string]ClientConfig),
}

// ParseNameServers converts semicolon-, comma-, or whitespace-delimited addresses into a client address list.
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

// GetClientManager returns the client manager instance.
func GetClientManager() *AdminClientManager {
	return clientManager
}

// SetDefaultClientInitializer sets the initializer for the default connection.
func (m *AdminClientManager) SetDefaultClientInitializer(initializer func() error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.defaultClientInitializer = initializer
}

// GetClient returns the client for the specified NameServer.
func (m *AdminClientManager) GetClient(nameServer string) (*admin.Client, error) {
	m.mu.RLock()
	client, exists := m.clients[nameServer]
	m.mu.RUnlock()

	if exists {
		return client, nil
	}

	return nil, fmt.Errorf("客户端未初始化: %s", nameServer)
}

// GetDefaultClient returns the client for the default connection.
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

// CreateClient creates a new Admin client.
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

	// Serialize client creation so concurrent lazy-initialization requests do not close one another's newly created clients.
	// Do not hold m.mu during the network handshake, allowing existing clients to continue serving read requests.
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

	// Create a new client.
	client, err := admin.NewClient(options...)
	if err != nil {
		return nil, fmt.Errorf("创建客户端失败: %w", err)
	}

	// Start the client.
	if err := client.Start(); err != nil {
		client.Close()
		return nil, fmt.Errorf("启动客户端失败: %w", err)
	}

	// Verify the connection by attempting to retrieve cluster information.
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

// RemoveClient removes and closes a client.
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

	// Clear the default connection when it is removed.
	if m.defaultConn == nameServer {
		m.defaultConn = ""
	}
}

// GetDefaultClientConfig returns a copy of the default client's complete connection parameters.
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

// SetDefaultConnection sets the default connection.
func (m *AdminClientManager) SetDefaultConnection(nameServer string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.clients[nameServer]; !exists {
		return fmt.Errorf("客户端不存在: %s", nameServer)
	}

	m.defaultConn = nameServer
	return nil
}

// GetDefaultConnection returns the default connection address.
func (m *AdminClientManager) GetDefaultConnection() string {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.defaultConn
}

// TestConnection checks whether a connection is available.
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

	// Create a temporary client to test the connection.
	client, err := admin.NewClient(options...)
	if err != nil {
		return fmt.Errorf("创建测试客户端失败: %w", err)
	}
	defer client.Close()

	if err := client.Start(); err != nil {
		return fmt.Errorf("启动测试客户端失败: %w", err)
	}

	// Attempt to retrieve cluster information to verify the connection.
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	_, err = client.ExamineBrokerClusterInfo(ctx)
	if err != nil {
		return fmt.Errorf("连接测试失败: %w", err)
	}

	return nil
}

// CloseAll closes all clients.
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
