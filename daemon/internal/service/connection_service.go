// Package service 提供业务服务层
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

	"rocket-leaf/internal/crypto"
	"rocket-leaf/internal/model"
	"rocket-leaf/internal/rocketmq"
)

const (
	appConfigDirName         = "rocket-leaf"
	connectionDataFileName   = "connections.json"
	defaultConnectionTimeout = 5
)

type connectionStore struct {
	Connections []*model.Connection `json:"connections"`
}

// ConnectionService 连接管理服务
type ConnectionService struct {
	mu              sync.RWMutex
	connections     map[int]*model.Connection // 连接配置列表
	nextID          int                       // 下一个连接ID
	dataFilePath    string                    // 连接配置持久化文件路径
	settingsService *SettingsService          // 设置服务
	reconnectReload bool                      // 热重载失败后，回滚重载仍需恢复在线连接
}

// NewConnectionService 创建连接管理服务
func NewConnectionService(settingsService *SettingsService) *ConnectionService {
	service := &ConnectionService{
		connections:     make(map[int]*model.Connection),
		nextID:          1,
		dataFilePath:    resolveConnectionDataFilePath(),
		settingsService: settingsService,
	}

	if err := service.loadConnectionsFromFile(); err != nil {
		log.Printf("[ConnectionService] 加载连接配置失败: %v", err)
	}
	if settingsService != nil {
		settingsService.setConnectionReloader(service.reloadConnections)
	}

	return service
}

// reloadConnections 从磁盘热重载连接配置，并关闭仍引用旧配置的客户端。
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
				// 保留标志；若调用方回滚磁盘文件，下一次重载会恢复原连接。
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

func normalizeConnectionEnv(env model.ConnectionEnv) model.ConnectionEnv {
	if env != model.EnvProduction && env != model.EnvTest && env != model.EnvDevelopment {
		return model.EnvDevelopment
	}

	return env
}

func normalizeACLConfig(enableACL bool, accessKey string, secretKey string) (bool, string, string, error) {
	accessKey = strings.TrimSpace(accessKey)
	secretKey = strings.TrimSpace(secretKey)

	if !enableACL {
		return false, "", "", nil
	}

	if accessKey == "" {
		return false, "", "", fmt.Errorf("启用 ACL 时 AccessKey 不能为空")
	}

	if secretKey == "" {
		return false, "", "", fmt.Errorf("启用 ACL 时 SecretKey 不能为空")
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
		return "", "", fmt.Errorf("连接名称不能为空")
	}
	if len(rocketmq.ParseNameServers(nameServer)) == 0 {
		return "", "", fmt.Errorf("NameServer 地址不能为空")
	}
	if timeoutSec < 0 || timeoutSec > 300 {
		return "", "", fmt.Errorf("连接超时必须在 1-300 秒之间")
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

		// 解密敏感字段（兼容未加密的旧数据）
		if current.AccessKey != "" {
			decrypted, decErr := crypto.Decrypt(current.AccessKey, "accessKey")
			if decErr != nil {
				return fmt.Errorf("解密连接 %q 的 AccessKey 失败: %w", current.Name, decErr)
			}
			current.AccessKey = decrypted
		}
		if current.SecretKey != "" {
			decrypted, decErr := crypto.Decrypt(current.SecretKey, "secretKey")
			if decErr != nil {
				return fmt.Errorf("解密连接 %q 的 SecretKey 失败: %w", current.Name, decErr)
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
		// 加密敏感字段后再写入文件
		if connCopy.AccessKey != "" {
			encrypted, encErr := crypto.Encrypt(connCopy.AccessKey, "accessKey")
			if encErr != nil {
				return fmt.Errorf("加密 AccessKey 失败: %w", encErr)
			}
			connCopy.AccessKey = encrypted
		}
		if connCopy.SecretKey != "" {
			encrypted, encErr := crypto.Encrypt(connCopy.SecretKey, "secretKey")
			if encErr != nil {
				return fmt.Errorf("加密 SecretKey 失败: %w", encErr)
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

// formatNow 格式化当前时间
func formatNow() string {
	return time.Now().Format("2006-01-02 15:04:05")
}

// GetConnections 获取所有连接配置
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

// GetConnection 获取单个连接配置
func (s *ConnectionService) GetConnection(id int) (*model.Connection, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	conn, exists := s.connections[id]
	if !exists {
		return nil, fmt.Errorf("连接不存在: %d", id)
	}
	connCopy := *conn
	return &connCopy, nil
}

// AddConnection 添加新连接
func (s *ConnectionService) AddConnection(name string, env string, nameServer string, timeoutSec int, enableACL bool, accessKey string, secretKey string, remark string) (*model.Connection, error) {
	var err error
	name, nameServer, err = validateConnectionFields(name, nameServer, timeoutSec)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	// 验证环境类型
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
		IsDefault:  len(s.connections) == 0, // 第一个连接自动设为默认
		Remark:     remark,
	}

	s.connections[s.nextID] = conn

	if err := s.saveConnectionsLocked(); err != nil {
		// 保存失败时只回滚 map，不要回退 s.nextID——
		// 如果之前的 nextID 已被加载或已有连接占用（比如 load 时 nextID = max(ID)+1），
		// 递减后会与已存在的连接 ID 冲突，下一次 Add 会直接覆盖现有数据。
		delete(s.connections, conn.ID)
		return nil, fmt.Errorf("保存连接配置失败: %w", err)
	}
	s.nextID++

	connCopy := *conn
	return &connCopy, nil
}

// UpdateConnection 更新连接配置
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
		return nil, fmt.Errorf("连接不存在: %d", id)
	}

	oldConn := *conn

	// 验证环境类型
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
		return nil, fmt.Errorf("保存连接配置失败: %w", err)
	}
	result := *conn
	s.mu.Unlock()

	if clientConfigChanged && wasOnline {
		rocketmq.GetClientManager().RemoveClient(oldConn.NameServer)
		if err := s.Connect(id); err != nil {
			return &result, fmt.Errorf("连接配置已保存，但使用新配置重连失败: %w", err)
		}
		return s.GetConnection(id)
	}

	return &result, nil
}

// DeleteConnection 删除连接
func (s *ConnectionService) DeleteConnection(id int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	conn, exists := s.connections[id]
	if !exists {
		return fmt.Errorf("连接不存在: %d", id)
	}

	// 不允许删除默认连接（如果还有其他连接）
	if conn.IsDefault && len(s.connections) > 1 {
		return fmt.Errorf("不能删除默认连接，请先设置其他连接为默认")
	}

	nameServer := conn.NameServer

	delete(s.connections, id)

	// 如果删除后还有连接，按 ID 升序选最小的为新默认。
	// 不能直接 range map 取第一个——map 遍历顺序随机，会导致每次删除后
	// 接管默认的连接都不一样，行为不可预测。
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
		return fmt.Errorf("保存连接配置失败: %w", err)
	}

	// 只有实际在线的配置才拥有客户端；删除同 NameServer 的离线配置不能误伤活动连接。
	if deletedConn.Status == model.StatusOnline {
		rocketmq.GetClientManager().RemoveClient(nameServer)
	}

	return nil
}

// TestConnection 测试连接
func (s *ConnectionService) TestConnection(id int) (string, error) {
	s.mu.Lock()
	conn, exists := s.connections[id]
	if !exists {
		s.mu.Unlock()
		return "", fmt.Errorf("连接不存在: %d", id)
	}
	nameServer := conn.NameServer
	timeout := s.getConnectTimeout(conn)
	enableACL, accessKey, secretKey := s.resolveACLCredentials(conn)
	s.mu.Unlock()

	// 测试连接
	err := rocketmq.GetClientManager().TestConnection(nameServer, timeout, enableACL, accessKey, secretKey)

	s.mu.Lock()
	defer s.mu.Unlock()

	// 更新连接状态
	if conn, exists := s.connections[id]; exists {
		conn.LastCheck = formatNow()
		if err == nil {
			return "online", nil
		}
		return "offline", err
	}

	return "offline", err
}

// getConnectTimeout 获取连接超时时间，优先使用连接配置的超时，否则使用全局设置
func (s *ConnectionService) getConnectTimeout(conn *model.Connection) time.Duration {
	if conn.TimeoutSec > 0 {
		return time.Duration(conn.TimeoutSec) * time.Second
	}
	if s.settingsService != nil {
		return s.settingsService.GetConnectTimeout()
	}
	return time.Duration(defaultConnectionTimeout) * time.Second
}

// resolveACLCredentials 解析连接 ACL：优先连接自身凭证；
// 连接未启用 ACL 时，回退到设置中的全局 AccessKey/SecretKey。
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

// SetDefaultConnection 设置默认连接
func (s *ConnectionService) SetDefaultConnection(id int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	conn, exists := s.connections[id]
	if !exists {
		return fmt.Errorf("连接不存在: %d", id)
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

	// 取消其他连接的默认状态
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

// ConnectDefault 连接默认连接
func (s *ConnectionService) ConnectDefault() error {
	// 检查是否启用自动连接
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

// Connect 连接指定连接，并将其设为当前活动（默认）客户端。
// 同一时间只保留一个 online 连接，避免 UI 显示 A 而 Admin 实际走 B。
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
	// 收集需要关掉的其它 NameServer 客户端
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

	// 关闭其它连接的 Admin 客户端，防止 GetDefaultClient 仍指向旧集群
	manager := rocketmq.GetClientManager()
	for _, ns := range otherNameServers {
		manager.RemoveClient(ns)
	}

	// 设为默认客户端（业务服务一律走这里）
	if err := manager.SetDefaultConnection(nameServer); err != nil {
		return err
	}

	// 同步持久化状态：当前 online + default，其余 offline 且非 default
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

// Disconnect 断开指定连接
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
		// 先把当前连接的 default 标记拿掉，再按 ID 升序选最小的接管。
		// 否则会同时存在两个 IsDefault=true 写进文件，仅依赖下次加载去重，
		// 而去重时哪个连接保留 default 也是 map 遍历顺序决定的——不可预测。
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
		// 回滚：把 default 标记还给被断开的连接，把刚提升的连接降级。
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
