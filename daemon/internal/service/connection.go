// Package service provides the business service layer.
package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/amigoer/rocket-leaf/daemon/internal/crypto"
	"github.com/amigoer/rocket-leaf/daemon/internal/model"
	"github.com/amigoer/rocket-leaf/daemon/internal/rocketmq"
)

const (
	appConfigDirName         = "rocket-leaf"
	connectionDataFileName   = "connections.json"
	defaultConnectionTimeout = 5
)

type connectionStore struct {
	Connections []*model.Connection `json:"connections"`
}

// ConnectionService manages connection configurations.
type ConnectionService struct {
	mu              sync.RWMutex
	connections     map[int]*model.Connection // connection config list
	nextID          int                       // next connection ID
	dataFilePath    string                    // connection config persistence path
	settingsService *SettingsService          // settings service
	reconnectReload bool                      // after a hot-reload failure, rollback reload still needs to restore online connections
}

// NewConnectionService creates a connection management service.
func NewConnectionService(settingsService *SettingsService) *ConnectionService {
	service := &ConnectionService{
		connections:     make(map[int]*model.Connection),
		nextID:          1,
		dataFilePath:    resolveConnectionDataFilePath(),
		settingsService: settingsService,
	}

	if err := service.loadConnectionsFromFile(); err != nil {
		log.Printf("[ConnectionService] failed to load connection config: %v", err)
	}
	if settingsService != nil {
		settingsService.setConnectionReloader(service.reloadConnections)
	}

	return service
}

// reloadConnections hot-reloads connection configs from disk and closes clients still using old configs.
func (s *ConnectionService) reloadConnections() error {
	s.mu.RLock()
	shouldReconnect := s.reconnectReload
	for _, conn := range s.connections {
		if conn != nil && conn.Status == model.StatusOnline {
			shouldReconnect = true
			break
		}
	}
	s.mu.RUnlock()

	s.mu.Lock()
	if err := s.loadConnectionsFromFile(); err != nil {
		s.mu.Unlock()
		return err
	}
	s.reconnectReload = shouldReconnect
	s.mu.Unlock()
	rocketmq.GetClientManager().CloseAll()
	if shouldReconnect {
		s.mu.RLock()
		defaultID := 0
		for _, conn := range s.connections {
			if conn != nil && conn.IsDefault {
				defaultID = conn.ID
				break
			}
		}
		s.mu.RUnlock()
		if defaultID != 0 {
			if err := s.Connect(defaultID); err != nil {
				// Keep the flag; if the caller rolls back the on-disk file, the next reload restores the original connection.
				return err
			}
		}
	}
	s.mu.Lock()
	s.reconnectReload = false
	s.mu.Unlock()
	return nil
}

func resolveConnectionDataFilePath() string {
	configDir, err := os.UserConfigDir()
	if err != nil || strings.TrimSpace(configDir) == "" {
		return connectionDataFileName
	}

	return filepath.Join(configDir, appConfigDirName, connectionDataFileName)
}

// normalizeConnectionEnv accepts both English env values and legacy Chinese
// values from saved configs for backward compatibility.
func normalizeConnectionEnv(env model.ConnectionEnv) model.ConnectionEnv {
	switch strings.TrimSpace(string(env)) {
	case "production", "生产":
		return model.EnvProduction
	case "test", "测试":
		return model.EnvTest
	case "development", "开发":
		return model.EnvDevelopment
	default:
		return model.EnvDevelopment
	}
}

func normalizeACLConfig(enableACL bool, accessKey string, secretKey string) (bool, string, string, error) {
	accessKey = strings.TrimSpace(accessKey)
	secretKey = strings.TrimSpace(secretKey)

	if !enableACL {
		return false, "", "", nil
	}

	if accessKey == "" {
		return false, "", "", fmt.Errorf("AccessKey is required when ACL is enabled")
	}

	if secretKey == "" {
		return false, "", "", fmt.Errorf("SecretKey is required when ACL is enabled")
	}

	return true, accessKey, secretKey, nil
}

func normalizeTimeoutSec(timeoutSec int) int {
	if timeoutSec <= 0 {
		return defaultConnectionTimeout
	}

	return timeoutSec
}

func validateConnectionFields(name, nameServer string, timeoutSec int) (string, string, error) {
	name = strings.TrimSpace(name)
	nameServer = strings.TrimSpace(nameServer)
	if name == "" {
		return "", "", fmt.Errorf("connection name cannot be empty")
	}
	if len(rocketmq.ParseNameServers(nameServer)) == 0 {
		return "", "", fmt.Errorf("NameServer address cannot be empty")
	}
	if timeoutSec < 0 || timeoutSec > 300 {
		return "", "", fmt.Errorf("connection timeout must be between 1 and 300 seconds")
	}
	return name, nameServer, nil
}

func (s *ConnectionService) loadConnectionsFromFile() error {
	data, err := os.ReadFile(s.dataFilePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}

	var store connectionStore
	if err := json.Unmarshal(data, &store); err != nil {
		return err
	}

	loaded := make(map[int]*model.Connection, len(store.Connections))
	nextID := 1
	hasDefault := false

	for _, conn := range store.Connections {
		if conn == nil {
			continue
		}

		current := *conn

		if current.ID <= 0 {
			current.ID = nextID
		}
		if current.ID >= nextID {
			nextID = current.ID + 1
		}
		if _, exists := loaded[current.ID]; exists {
			current.ID = nextID
			nextID++
		}

		current.Env = normalizeConnectionEnv(current.Env)
		current.Status = model.StatusOffline
		current.LastCheck = "-"
		if current.TimeoutSec <= 0 {
			current.TimeoutSec = defaultConnectionTimeout
		}

		// Decrypt sensitive fields (compatible with unencrypted legacy data).
		if current.AccessKey != "" {
			decrypted, decErr := crypto.Decrypt(current.AccessKey, "accessKey")
			if decErr != nil {
				return fmt.Errorf("failed to decrypt AccessKey for connection %q: %w", current.Name, decErr)
			}
			current.AccessKey = decrypted
		}
		if current.SecretKey != "" {
			decrypted, decErr := crypto.Decrypt(current.SecretKey, "secretKey")
			if decErr != nil {
				return fmt.Errorf("failed to decrypt SecretKey for connection %q: %w", current.Name, decErr)
			}
			current.SecretKey = decrypted
		}

		enableACL, accessKey, secretKey, err := normalizeACLConfig(current.EnableACL, current.AccessKey, current.SecretKey)
		if err != nil {
			enableACL = false
			accessKey = ""
			secretKey = ""
		}
		current.EnableACL = enableACL
		current.AccessKey = accessKey
		current.SecretKey = secretKey

		if current.IsDefault {
			if hasDefault {
				current.IsDefault = false
			} else {
				hasDefault = true
			}
		}

		connCopy := current
		loaded[current.ID] = &connCopy
	}

	if len(loaded) > 0 && !hasDefault {
		minID := 0
		for id := range loaded {
			if minID == 0 || id < minID {
				minID = id
			}
		}
		loaded[minID].IsDefault = true
	}

	s.connections = loaded
	s.nextID = nextID

	return nil
}

func (s *ConnectionService) saveConnectionsLocked() error {
	connections := make([]*model.Connection, 0, len(s.connections))
	for _, conn := range s.connections {
		if conn == nil {
			continue
		}
		connCopy := *conn
		// Encrypt sensitive fields before writing to disk.
		if connCopy.AccessKey != "" {
			encrypted, encErr := crypto.Encrypt(connCopy.AccessKey, "accessKey")
			if encErr != nil {
				return fmt.Errorf("failed to encrypt AccessKey: %w", encErr)
			}
			connCopy.AccessKey = encrypted
		}
		if connCopy.SecretKey != "" {
			encrypted, encErr := crypto.Encrypt(connCopy.SecretKey, "secretKey")
			if encErr != nil {
				return fmt.Errorf("failed to encrypt SecretKey: %w", encErr)
			}
			connCopy.SecretKey = encrypted
		}
		connections = append(connections, &connCopy)
	}

	sort.Slice(connections, func(i, j int) bool {
		return connections[i].ID < connections[j].ID
	})

	data, err := json.MarshalIndent(connectionStore{Connections: connections}, "", "  ")
	if err != nil {
		return err
	}

	return writeAtomicFile(s.dataFilePath, data)
}

// formatNow formats the current time.
func formatNow() string {
	return time.Now().Format("2006-01-02 15:04:05")
}

// GetConnections returns all connection configurations.
func (s *ConnectionService) GetConnections() []*model.Connection {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]*model.Connection, 0, len(s.connections))
	for _, conn := range s.connections {
		if conn == nil {
			continue
		}
		connCopy := *conn
		result = append(result, &connCopy)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result
}

// GetConnection returns a single connection configuration.
func (s *ConnectionService) GetConnection(id int) (*model.Connection, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	conn, exists := s.connections[id]
	if !exists {
		return nil, fmt.Errorf("connection not found: %d", id)
	}
	connCopy := *conn
	return &connCopy, nil
}

// AddConnection adds a new connection.
func (s *ConnectionService) AddConnection(name string, env string, nameServer string, timeoutSec int, enableACL bool, accessKey string, secretKey string, remark string) (*model.Connection, error) {
	var err error
	name, nameServer, err = validateConnectionFields(name, nameServer, timeoutSec)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	// Normalize environment type.
	connEnv := normalizeConnectionEnv(model.ConnectionEnv(env))

	enableACL, accessKey, secretKey, err = normalizeACLConfig(enableACL, accessKey, secretKey)
	if err != nil {
		return nil, err
	}

	conn := &model.Connection{
		ID:         s.nextID,
		Name:       name,
		Env:        connEnv,
		NameServer: nameServer,
		TimeoutSec: normalizeTimeoutSec(timeoutSec),
		EnableACL:  enableACL,
		AccessKey:  accessKey,
		SecretKey:  secretKey,
		Status:     model.StatusOffline,
		LastCheck:  "-",
		IsDefault:  len(s.connections) == 0, // first connection becomes default automatically
		Remark:     remark,
	}

	s.connections[s.nextID] = conn

	if err := s.saveConnectionsLocked(); err != nil {
		// On save failure, only roll back the map entry; do not decrement s.nextID.
		// If nextID was already advanced by load (e.g. nextID = max(ID)+1),
		// decrementing would collide with an existing connection ID and the next Add would overwrite it.
		delete(s.connections, conn.ID)
		return nil, fmt.Errorf("failed to save connection config: %w", err)
	}
	s.nextID++

	connCopy := *conn
	return &connCopy, nil
}

// UpdateConnection updates a connection configuration.
func (s *ConnectionService) UpdateConnection(id int, name string, env string, nameServer string, timeoutSec int, enableACL bool, accessKey string, secretKey string, remark string) (*model.Connection, error) {
	var err error
	name, nameServer, err = validateConnectionFields(name, nameServer, timeoutSec)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()

	conn, exists := s.connections[id]
	if !exists {
		s.mu.Unlock()
		return nil, fmt.Errorf("connection not found: %d", id)
	}

	oldConn := *conn

	// Normalize environment type.
	connEnv := normalizeConnectionEnv(model.ConnectionEnv(env))

	enableACL, accessKey, secretKey, err = normalizeACLConfig(enableACL, accessKey, secretKey)
	if err != nil {
		s.mu.Unlock()
		return nil, err
	}

	conn.Name = name
	conn.Env = connEnv
	conn.NameServer = nameServer
	conn.TimeoutSec = normalizeTimeoutSec(timeoutSec)
	conn.EnableACL = enableACL
	conn.AccessKey = accessKey
	conn.SecretKey = secretKey
	conn.Remark = remark
	clientConfigChanged := oldConn.NameServer != conn.NameServer ||
		oldConn.TimeoutSec != conn.TimeoutSec ||
		oldConn.EnableACL != conn.EnableACL ||
		oldConn.AccessKey != conn.AccessKey ||
		oldConn.SecretKey != conn.SecretKey
	wasOnline := oldConn.Status == model.StatusOnline
	if clientConfigChanged {
		conn.Status = model.StatusOffline
	}

	if err := s.saveConnectionsLocked(); err != nil {
		*conn = oldConn
		s.mu.Unlock()
		return nil, fmt.Errorf("failed to save connection config: %w", err)
	}
	result := *conn
	s.mu.Unlock()

	if clientConfigChanged && wasOnline {
		rocketmq.GetClientManager().RemoveClient(oldConn.NameServer)
		if err := s.Connect(id); err != nil {
			return &result, fmt.Errorf("connection config saved, but reconnect with new config failed: %w", err)
		}
		return s.GetConnection(id)
	}

	return &result, nil
}

// DeleteConnection deletes a connection.
func (s *ConnectionService) DeleteConnection(id int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	conn, exists := s.connections[id]
	if !exists {
		return fmt.Errorf("connection not found: %d", id)
	}

	// Do not allow deleting the default connection while other connections remain.
	if conn.IsDefault && len(s.connections) > 1 {
		return fmt.Errorf("cannot delete the default connection; set another connection as default first")
	}

	nameServer := conn.NameServer

	delete(s.connections, id)

	// If connections remain after delete, pick the lowest ID as the new default.
	// Do not take the first entry from a map range — map iteration order is random,
	// so the new default would be unpredictable after each delete.
	newDefaultID := 0
	if len(s.connections) > 0 && conn.IsDefault {
		ids := make([]int, 0, len(s.connections))
		for cid := range s.connections {
			ids = append(ids, cid)
		}
		sort.Ints(ids)
		if first, ok := s.connections[ids[0]]; ok {
			first.IsDefault = true
			newDefaultID = first.ID
		}
	}

	deletedConn := *conn
	if err := s.saveConnectionsLocked(); err != nil {
		s.connections[id] = &deletedConn
		if newDefaultID != 0 {
			if newDefaultConn, ok := s.connections[newDefaultID]; ok {
				newDefaultConn.IsDefault = false
			}
		}
		return fmt.Errorf("failed to save connection config: %w", err)
	}

	// Only online configs own a client; deleting an offline config with the same NameServer must not disrupt the active connection.
	if deletedConn.Status == model.StatusOnline {
		rocketmq.GetClientManager().RemoveClient(nameServer)
	}

	return nil
}

// TestConnection tests a connection.
func (s *ConnectionService) TestConnection(id int) (string, error) {
	s.mu.Lock()
	conn, exists := s.connections[id]
	if !exists {
		s.mu.Unlock()
		return "", fmt.Errorf("connection not found: %d", id)
	}
	nameServer := conn.NameServer
	timeout := s.getConnectTimeout(conn)
	enableACL, accessKey, secretKey := s.resolveACLCredentials(conn)
	s.mu.Unlock()

	// Test the connection.
	err := rocketmq.GetClientManager().TestConnection(nameServer, timeout, enableACL, accessKey, secretKey)

	s.mu.Lock()
	defer s.mu.Unlock()

	// Update connection status.
	if conn, exists := s.connections[id]; exists {
		conn.LastCheck = formatNow()
		if err == nil {
			return "online", nil
		}
		return "offline", err
	}

	return "offline", err
}

// getConnectTimeout returns the connect timeout, preferring the connection config and falling back to global settings.
func (s *ConnectionService) getConnectTimeout(conn *model.Connection) time.Duration {
	if conn.TimeoutSec > 0 {
		return time.Duration(conn.TimeoutSec) * time.Second
	}
	if s.settingsService != nil {
		return s.settingsService.GetConnectTimeout()
	}
	return time.Duration(defaultConnectionTimeout) * time.Second
}

// resolveACLCredentials resolves connection ACL credentials: prefer the connection's own
// credentials; if the connection does not enable ACL, fall back to global AccessKey/SecretKey from settings.
func (s *ConnectionService) resolveACLCredentials(conn *model.Connection) (enableACL bool, accessKey, secretKey string) {
	if conn.EnableACL {
		return true, conn.AccessKey, conn.SecretKey
	}
	if s.settingsService != nil {
		gak, gsk := s.settingsService.GetGlobalACLCredentials()
		if strings.TrimSpace(gak) != "" && strings.TrimSpace(gsk) != "" {
			return true, gak, gsk
		}
	}
	return false, "", ""
}

// SetDefaultConnection sets the default connection.
func (s *ConnectionService) SetDefaultConnection(id int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	conn, exists := s.connections[id]
	if !exists {
		return fmt.Errorf("connection not found: %d", id)
	}

	manager := rocketmq.GetClientManager()
	_, clientExistsErr := manager.GetClient(conn.NameServer)
	clientExists := clientExistsErr == nil
	if conn.IsDefault {
		if clientExists {
			return manager.SetDefaultConnection(conn.NameServer)
		}
		return nil
	}

	previousDefaultNameServer := ""
	for _, c := range s.connections {
		if c.IsDefault {
			previousDefaultNameServer = c.NameServer
			break
		}
	}

	runtimeDefaultChanged := false
	if clientExists {
		if err := manager.SetDefaultConnection(conn.NameServer); err != nil {
			return err
		}
		runtimeDefaultChanged = true
	}

	// Clear the default flag from all other connections.
	for _, c := range s.connections {
		c.IsDefault = false
	}

	conn.IsDefault = true

	if err := s.saveConnectionsLocked(); err != nil {
		for _, c := range s.connections {
			c.IsDefault = false
			if c.NameServer == previousDefaultNameServer {
				c.IsDefault = true
			}
		}
		if runtimeDefaultChanged && previousDefaultNameServer != "" && previousDefaultNameServer != conn.NameServer {
			if resetErr := manager.SetDefaultConnection(previousDefaultNameServer); resetErr != nil {
				log.Printf("[ConnectionService] 回滚默认连接失败: %v", resetErr)
			}
		}
		return fmt.Errorf("保存连接配置失败: %w", err)
	}

	return nil
}

// ConnectDefault connects to the default connection.
func (s *ConnectionService) ConnectDefault() error {
	// Check whether automatic connection is enabled.
	if s.settingsService != nil && !s.settingsService.GetAutoConnectLast() {
		return nil
	}

	s.mu.RLock()
	defaultID := 0
	for _, conn := range s.connections {
		if conn.IsDefault {
			defaultID = conn.ID
			break
		}
	}
	s.mu.RUnlock()

	if defaultID == 0 {
		return nil
	}
	return s.Connect(defaultID)
}

// Connect connects to the specified connection and makes it the active default client.
// Keep only one connection online at a time so the UI and admin operations cannot point to different clusters.
func (s *ConnectionService) Connect(id int) error {
	s.mu.RLock()
	conn, exists := s.connections[id]
	if !exists {
		s.mu.RUnlock()
		return fmt.Errorf("连接不存在: %d", id)
	}
	nameServer := conn.NameServer
	timeout := s.getConnectTimeout(conn)
	enableACL, accessKey, secretKey := s.resolveACLCredentials(conn)
	// Collect the other NameServer clients that need to be closed.
	otherNameServers := make([]string, 0)
	for _, c := range s.connections {
		if c.ID != id && c.NameServer != "" && c.NameServer != nameServer {
			otherNameServers = append(otherNameServers, c.NameServer)
		}
	}
	s.mu.RUnlock()

	_, err := rocketmq.GetClientManager().CreateClient(nameServer, timeout, enableACL, accessKey, secretKey)
	if err != nil {
		return err
	}

	// Close other admin clients so GetDefaultClient cannot keep pointing to the previous cluster.
	manager := rocketmq.GetClientManager()
	for _, ns := range otherNameServers {
		manager.RemoveClient(ns)
	}

	// Make this the default client used by all business services.
	if err := manager.SetDefaultConnection(nameServer); err != nil {
		return err
	}

	// Persist synchronized state: the current connection is online and default; all others are offline and non-default.
	s.mu.Lock()
	now := formatNow()
	for _, c := range s.connections {
		if c.ID == id {
			c.Status = model.StatusOnline
			c.LastCheck = now
			c.IsDefault = true
		} else {
			c.Status = model.StatusOffline
			c.IsDefault = false
		}
	}
	saveErr := s.saveConnectionsLocked()
	s.mu.Unlock()
	if saveErr != nil {
		return fmt.Errorf("连接成功，但保存默认连接状态失败: %w", saveErr)
	}

	return nil
}

// Disconnect disconnects the specified connection.
func (s *ConnectionService) Disconnect(id int) error {
	s.mu.Lock()
	conn, exists := s.connections[id]
	if !exists {
		s.mu.Unlock()
		return fmt.Errorf("连接不存在: %d", id)
	}
	nameServer := conn.NameServer
	wasDefault := conn.IsDefault
	wasOnline := conn.Status == model.StatusOnline
	s.mu.Unlock()

	if wasOnline {
		rocketmq.GetClientManager().RemoveClient(nameServer)
	}

	s.mu.Lock()
	if c, ok := s.connections[id]; ok {
		c.Status = model.StatusOffline
		c.LastCheck = formatNow()
	}
	var (
		newDefaultNameServer string
		newDefaultID         int
	)
	if wasDefault {
		// Clear the current default flag before promoting the connection with the lowest ID.
		// Otherwise two IsDefault=true values could be written and left for the next load to deduplicate,
		// with the surviving default determined unpredictably by map iteration order.
		if c, ok := s.connections[id]; ok {
			c.IsDefault = false
		}
		ids := make([]int, 0, len(s.connections))
		for cid := range s.connections {
			if cid != id {
				ids = append(ids, cid)
			}
		}
		sort.Ints(ids)
		if len(ids) > 0 {
			c := s.connections[ids[0]]
			c.IsDefault = true
			newDefaultID = c.ID
			newDefaultNameServer = c.NameServer
		}
	}
	err := s.saveConnectionsLocked()
	if err != nil && wasDefault {
		// Roll back by restoring the disconnected connection as default and demoting the promoted one.
		if c, ok := s.connections[id]; ok {
			c.IsDefault = true
		}
		if newDefaultID != 0 {
			if c, ok := s.connections[newDefaultID]; ok {
				c.IsDefault = false
			}
		}
	}
	s.mu.Unlock()
	if err != nil {
		return err
	}
	if newDefaultNameServer != "" {
		_ = rocketmq.GetClientManager().SetDefaultConnection(newDefaultNameServer)
	}
	return nil
}
