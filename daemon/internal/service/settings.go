// Package service provides the business service layer.
package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/amigoer/rocket-leaf/daemon/internal/crypto"
	"github.com/amigoer/rocket-leaf/daemon/internal/model"
	"github.com/amigoer/rocket-leaf/daemon/internal/rocketmq"
)

const settingsDataFileName = "settings.json"

// SettingsService manages application settings.
type SettingsService struct {
	mu                 sync.RWMutex
	settings           *model.AppSettings
	dataFilePath       string
	connectionReloader func() error
}

// NewSettingsService creates a settings service.
func NewSettingsService() *SettingsService {
	svc := &SettingsService{
		settings:     model.DefaultSettings(),
		dataFilePath: resolveSettingsDataFilePath(),
	}

	if err := svc.loadFromFile(); err != nil {
		log.Printf("[SettingsService] 加载设置失败: %v", err)
	}

	return svc
}

// setConnectionReloader registers the callback used to hot-reload connections after a configuration import.
func (s *SettingsService) setConnectionReloader(reloader func() error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.connectionReloader = reloader
}

func normalizeSettings(settings model.AppSettings) model.AppSettings {
	defaults := model.DefaultSettings()
	if settings.Theme != "system" && settings.Theme != "light" && settings.Theme != "dark" {
		settings.Theme = defaults.Theme
	}
	if settings.Language != "zh" && settings.Language != "en" {
		settings.Language = defaults.Language
	}
	if settings.FontSize < 12 || settings.FontSize > 18 {
		settings.FontSize = defaults.FontSize
	}
	if strings.TrimSpace(settings.UIFont) == "" {
		settings.UIFont = defaults.UIFont
	}
	if strings.TrimSpace(settings.MonospaceFont) == "" {
		settings.MonospaceFont = defaults.MonospaceFont
	}
	if settings.ConnectTimeoutMs < 500 || settings.ConnectTimeoutMs > 300000 {
		settings.ConnectTimeoutMs = defaults.ConnectTimeoutMs
	}
	if settings.RequestTimeoutMs < 500 || settings.RequestTimeoutMs > 300000 {
		settings.RequestTimeoutMs = defaults.RequestTimeoutMs
	}
	if settings.LagAlertThreshold < 0 {
		settings.LagAlertThreshold = 0
	}
	if settings.DiskAlertThreshold < 0 {
		settings.DiskAlertThreshold = 0
	}
	if settings.DiskAlertThreshold > 100 {
		settings.DiskAlertThreshold = 100
	}
	if settings.Timezone != "local" && settings.Timezone != "utc" {
		settings.Timezone = defaults.Timezone
	}
	if settings.TimestampFormat != "datetime" && settings.TimestampFormat != "ms" {
		settings.TimestampFormat = defaults.TimestampFormat
	}
	if settings.MaxPayloadRenderBytes < 64*1024 || settings.MaxPayloadRenderBytes > 4*1024*1024 {
		settings.MaxPayloadRenderBytes = defaults.MaxPayloadRenderBytes
	}
	if settings.FetchLimit <= 0 || settings.FetchLimit > 1000 {
		settings.FetchLimit = defaults.FetchLimit
	}
	if settings.ProxyType != "http" && settings.ProxyType != "socks5" {
		settings.ProxyType = defaults.ProxyType
	}
	settings.GlobalAccessKey = strings.TrimSpace(settings.GlobalAccessKey)
	return settings
}

func resolveSettingsDataFilePath() string {
	configDir, err := os.UserConfigDir()
	if err != nil || strings.TrimSpace(configDir) == "" {
		return settingsDataFileName
	}

	return filepath.Join(configDir, appConfigDirName, settingsDataFileName)
}

// loadFromFile loads settings from disk.
func (s *SettingsService) loadFromFile() error {
	data, err := os.ReadFile(s.dataFilePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}

	// Decode into a map first to handle legacy string-to-integer fontSize conversion manually.
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		log.Printf("[SettingsService] 解析设置文件失败: %v", err)
		return nil
	}

	// Replace a legacy string fontSize, such as "medium", with its numeric value.
	if rawFS, ok := raw["fontSize"]; ok {
		var strVal string
		if json.Unmarshal(rawFS, &strVal) == nil {
			// Map the legacy string value to a number.
			mapping := map[string]int{"small": 12, "medium": 14, "large": 16}
			size := 14
			if v, found := mapping[strVal]; found {
				size = v
			}
			raw["fontSize"], _ = json.Marshal(size)
			log.Printf("[SettingsService] 已将旧格式 fontSize %q 转换为 %d", strVal, size)
		}
	}

	// Re-encode the normalized map and decode it into the settings structure.
	fixedData, _ := json.Marshal(raw)
	loaded := model.DefaultSettings()
	if err := json.Unmarshal(fixedData, loaded); err != nil {
		log.Printf("[SettingsService] 解析设置失败: %v", err)
	}

	// Decrypt sensitive fields while remaining compatible with legacy unencrypted data.
	if loaded.GlobalAccessKey != "" {
		decrypted, decErr := crypto.Decrypt(loaded.GlobalAccessKey, "globalAccessKey")
		if decErr != nil {
			return fmt.Errorf("解密全局 AccessKey 失败: %w", decErr)
		}
		loaded.GlobalAccessKey = decrypted
	}
	if loaded.GlobalSecretKey != "" {
		decrypted, decErr := crypto.Decrypt(loaded.GlobalSecretKey, "globalSecretKey")
		if decErr != nil {
			return fmt.Errorf("解密全局 SecretKey 失败: %w", decErr)
		}
		loaded.GlobalSecretKey = decrypted
	}

	normalized := normalizeSettings(*loaded)
	s.settings = &normalized
	return nil
}

func marshalSettingsForDisk(settings model.AppSettings) ([]byte, error) {
	toSave := settings
	if toSave.GlobalAccessKey != "" {
		encrypted, encErr := crypto.Encrypt(toSave.GlobalAccessKey, "globalAccessKey")
		if encErr != nil {
			return nil, fmt.Errorf("加密全局 AccessKey 失败: %w", encErr)
		}
		toSave.GlobalAccessKey = encrypted
	}
	if toSave.GlobalSecretKey != "" {
		encrypted, encErr := crypto.Encrypt(toSave.GlobalSecretKey, "globalSecretKey")
		if encErr != nil {
			return nil, fmt.Errorf("加密全局 SecretKey 失败: %w", encErr)
		}
		toSave.GlobalSecretKey = encrypted
	}
	return json.MarshalIndent(&toSave, "", "  ")
}

// saveToFileLocked persists settings to disk. The caller must hold the write lock.
func (s *SettingsService) saveToFileLocked() error {
	data, err := marshalSettingsForDisk(*s.settings)
	if err != nil {
		return err
	}
	return writeAtomicFile(s.dataFilePath, data)
}

// GetConnectTimeout returns the connection timeout.
func (s *SettingsService) GetConnectTimeout() time.Duration {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ms := s.settings.ConnectTimeoutMs
	if ms <= 0 {
		ms = 3000
	}
	return time.Duration(ms) * time.Millisecond
}

// GetRequestTimeout returns the request timeout.
func (s *SettingsService) GetRequestTimeout() time.Duration {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ms := s.settings.RequestTimeoutMs
	if ms <= 0 {
		ms = 5000
	}
	return time.Duration(ms) * time.Millisecond
}

// GetFetchLimit returns the per-page fetch limit.
func (s *SettingsService) GetFetchLimit() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	limit := s.settings.FetchLimit
	if limit <= 0 {
		limit = 64
	}
	return limit
}

// GetAutoConnectLast reports whether the last-used cluster should be connected automatically.
func (s *SettingsService) GetAutoConnectLast() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.settings.AutoConnectLast
}

// GetGlobalACLCredentials returns the global AccessKey and SecretKey in plaintext.
// Connect falls back to these credentials when a connection has no dedicated ACL configuration.
func (s *SettingsService) GetGlobalACLCredentials() (accessKey, secretKey string) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.settings.GlobalAccessKey, s.settings.GlobalSecretKey
}

// GetSettings returns all settings.
func (s *SettingsService) GetSettings() *model.AppSettings {
	s.mu.RLock()
	defer s.mu.RUnlock()

	// Return a copy.
	copy := *s.settings
	return &copy
}

// UpdateSettings replaces all settings and persists them.
func (s *SettingsService) UpdateSettings(settings model.AppSettings) (*model.AppSettings, error) {
	s.mu.Lock()

	settings = normalizeSettings(settings)
	old := *s.settings
	credentialsChanged := old.GlobalAccessKey != settings.GlobalAccessKey ||
		old.GlobalSecretKey != settings.GlobalSecretKey
	s.settings = &settings

	if err := s.saveToFileLocked(); err != nil {
		s.settings = &old
		s.mu.Unlock()
		return nil, err
	}

	copy := *s.settings
	reloader := s.connectionReloader
	s.mu.Unlock()
	if credentialsChanged && reloader != nil {
		if err := reloader(); err != nil {
			return &copy, fmt.Errorf("设置已保存，但刷新连接失败: %w", err)
		}
	}
	return &copy, nil
}

// ResetSettings restores the default settings.
func (s *SettingsService) ResetSettings() (*model.AppSettings, error) {
	s.mu.Lock()

	old := *s.settings
	s.settings = model.DefaultSettings()

	if err := s.saveToFileLocked(); err != nil {
		s.settings = &old
		s.mu.Unlock()
		return nil, err
	}

	copy := *s.settings
	reloader := s.connectionReloader
	credentialsChanged := old.GlobalAccessKey != "" || old.GlobalSecretKey != ""
	s.mu.Unlock()
	if credentialsChanged && reloader != nil {
		if err := reloader(); err != nil {
			return &copy, fmt.Errorf("设置已重置，但刷新连接失败: %w", err)
		}
	}
	return &copy, nil
}

// ExportAllConfig exports all settings and connections as a JSON string.
func (s *SettingsService) ExportAllConfig() (string, error) {
	s.mu.RLock()
	settingsCopy := *s.settings
	s.mu.RUnlock()

	// Export files support cross-device migration, so connection credentials must first be
	// decrypted with the local key. Files are written with mode 0600 and explicitly marked sensitive by containsSecrets.
	connFilePath := filepath.Join(filepath.Dir(s.dataFilePath), connectionDataFileName)
	connections := connectionStore{Connections: make([]*model.Connection, 0)}
	connData, err := os.ReadFile(connFilePath)
	if err == nil {
		connections, err = decodeConnectionStore(connData, true)
		if err != nil {
			return "", fmt.Errorf("导出连接配置失败: %w", err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("读取连接配置失败: %w", err)
	}

	containsSecrets := settingsCopy.GlobalAccessKey != "" || settingsCopy.GlobalSecretKey != ""
	for _, conn := range connections.Connections {
		if conn != nil && (conn.AccessKey != "" || conn.SecretKey != "") {
			containsSecrets = true
		}
	}

	exportData := map[string]interface{}{
		"version":         2,
		"containsSecrets": containsSecrets,
		"exportedAt":      time.Now().Format(time.RFC3339),
		"settings":        settingsCopy,
		"connections":     connections,
	}

	data, err := json.MarshalIndent(exportData, "", "  ")
	if err != nil {
		return "", fmt.Errorf("导出配置失败: %w", err)
	}

	return string(data), nil
}

func decodeConnectionStore(data []byte, decryptCredentials bool) (connectionStore, error) {
	var store connectionStore
	if err := json.Unmarshal(data, &store); err != nil {
		// Support the earliest export format, which stored the array directly.
		var list []*model.Connection
		if listErr := json.Unmarshal(data, &list); listErr != nil {
			return connectionStore{}, err
		}
		store.Connections = list
	}
	if store.Connections == nil {
		store.Connections = make([]*model.Connection, 0)
	}
	if !decryptCredentials {
		return store, nil
	}
	for _, conn := range store.Connections {
		if conn == nil {
			continue
		}
		if conn.AccessKey != "" {
			plain, err := crypto.Decrypt(conn.AccessKey, "accessKey")
			if err != nil {
				return connectionStore{}, fmt.Errorf("解密连接 %q 的 AccessKey 失败: %w", conn.Name, err)
			}
			conn.AccessKey = plain
		}
		if conn.SecretKey != "" {
			plain, err := crypto.Decrypt(conn.SecretKey, "secretKey")
			if err != nil {
				return connectionStore{}, fmt.Errorf("解密连接 %q 的 SecretKey 失败: %w", conn.Name, err)
			}
			conn.SecretKey = plain
		}
	}
	return store, nil
}

func marshalConnectionsForDisk(store connectionStore) ([]byte, error) {
	toSave := connectionStore{Connections: make([]*model.Connection, 0, len(store.Connections))}
	for _, conn := range store.Connections {
		if conn == nil {
			continue
		}
		current := *conn
		current.Name = strings.TrimSpace(current.Name)
		current.NameServer = strings.TrimSpace(current.NameServer)
		if current.Name == "" || len(rocketmq.ParseNameServers(current.NameServer)) == 0 {
			return nil, fmt.Errorf("连接名称和 NameServer 不能为空")
		}
		current.Env = normalizeConnectionEnv(current.Env)
		current.TimeoutSec = normalizeTimeoutSec(current.TimeoutSec)
		current.Status = model.StatusOffline
		current.LastCheck = "-"
		enableACL, accessKey, secretKey, err := normalizeACLConfig(current.EnableACL, current.AccessKey, current.SecretKey)
		if err != nil {
			return nil, fmt.Errorf("连接 %q 的 ACL 配置无效: %w", current.Name, err)
		}
		current.EnableACL = enableACL
		current.AccessKey = accessKey
		current.SecretKey = secretKey
		if current.AccessKey != "" {
			current.AccessKey, err = crypto.Encrypt(current.AccessKey, "accessKey")
			if err != nil {
				return nil, fmt.Errorf("加密连接 %q 的 AccessKey 失败: %w", current.Name, err)
			}
		}
		if current.SecretKey != "" {
			current.SecretKey, err = crypto.Encrypt(current.SecretKey, "secretKey")
			if err != nil {
				return nil, fmt.Errorf("加密连接 %q 的 SecretKey 失败: %w", current.Name, err)
			}
		}
		copy := current
		toSave.Connections = append(toSave.Connections, &copy)
	}
	return json.MarshalIndent(toSave, "", "  ")
}

func writeAtomicFile(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	_ = os.Chmod(dir, 0o700)
	file, err := os.CreateTemp(dir, "."+filepath.Base(path)+".tmp-")
	if err != nil {
		return err
	}
	tmp := file.Name()
	// A temporary file may come from an older version with broader permissions;
	// tighten them explicitly before writing sensitive data.
	if err := file.Chmod(0o600); err != nil {
		_ = file.Close()
		_ = os.Remove(tmp)
		return err
	}
	if _, err := file.Write(data); err != nil {
		_ = file.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

type fileSnapshot struct {
	data   []byte
	exists bool
}

func snapshotFile(path string) (fileSnapshot, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return fileSnapshot{}, nil
	}
	if err != nil {
		return fileSnapshot{}, err
	}
	return fileSnapshot{data: data, exists: true}, nil
}

func restoreFile(path string, snapshot fileSnapshot) error {
	if !snapshot.exists {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	return writeAtomicFile(path, snapshot.data)
}

// ExportAllConfigToFile writes all configuration to the target path and returns its final absolute path.
func (s *SettingsService) ExportAllConfigToFile(targetPath string) (string, error) {
	targetPath = strings.TrimSpace(targetPath)
	if targetPath == "" {
		return "", errors.New("目标文件路径为空")
	}
	targetAbs, _ := filepath.Abs(targetPath)
	configDir := filepath.Dir(s.dataFilePath)
	reserved := []string{
		s.dataFilePath,
		filepath.Join(configDir, connectionDataFileName),
		filepath.Join(configDir, "secret.key"),
	}
	for _, path := range reserved {
		reservedAbs, _ := filepath.Abs(path)
		if targetAbs == reservedAbs {
			return "", fmt.Errorf("不能用导出文件覆盖应用配置: %s", targetPath)
		}
	}

	jsonStr, err := s.ExportAllConfig()
	if err != nil {
		return "", err
	}

	if err := writeAtomicFile(targetPath, []byte(jsonStr)); err != nil {
		return "", fmt.Errorf("写入文件失败: %w", err)
	}

	abs, absErr := filepath.Abs(targetPath)
	if absErr != nil {
		abs = targetPath
	}
	return abs, nil
}

// ImportAllConfigFromFile reads and imports all configuration from the given path.
func (s *SettingsService) ImportAllConfigFromFile(sourcePath string) error {
	sourcePath = strings.TrimSpace(sourcePath)
	if sourcePath == "" {
		return errors.New("源文件路径为空")
	}

	data, err := os.ReadFile(sourcePath)
	if err != nil {
		return fmt.Errorf("读取文件失败: %w", err)
	}
	return s.ImportAllConfig(string(data))
}

// ImportAllConfig imports all configuration.
func (s *SettingsService) ImportAllConfig(jsonStr string) error {
	var importData struct {
		Version     int                `json:"version"`
		Settings    *model.AppSettings `json:"settings"`
		Connections json.RawMessage    `json:"connections"`
	}

	if err := json.Unmarshal([]byte(jsonStr), &importData); err != nil {
		return fmt.Errorf("解析导入数据失败: %w", err)
	}
	if importData.Version > 2 {
		return fmt.Errorf("不支持的配置版本: %d", importData.Version)
	}
	if importData.Settings == nil && len(importData.Connections) == 0 {
		return fmt.Errorf("导入文件不包含设置或连接配置")
	}

	var (
		settingsData []byte
		newSettings  *model.AppSettings
		connData     []byte
	)
	if importData.Settings != nil {
		normalized := normalizeSettings(*importData.Settings)
		newSettings = &normalized
		var err error
		settingsData, err = marshalSettingsForDisk(normalized)
		if err != nil {
			return fmt.Errorf("准备设置数据失败: %w", err)
		}
	}
	if len(importData.Connections) > 0 && string(importData.Connections) != "null" {
		// Version 1 embedded the local connections.json directly, so credentials are usually
		// still ENC: ciphertext. Version 2 exports portable plaintext. Distinguish by version
		// to avoid treating a real credential beginning with ENC: as ciphertext.
		store, err := decodeConnectionStore(importData.Connections, importData.Version < 2)
		if err != nil {
			return fmt.Errorf("解析连接配置失败: %w", err)
		}
		connData, err = marshalConnectionsForDisk(store)
		if err != nil {
			return fmt.Errorf("准备连接配置失败: %w", err)
		}
	}

	connFilePath := filepath.Join(filepath.Dir(s.dataFilePath), connectionDataFileName)
	s.mu.Lock()
	oldSettings := *s.settings
	credentialsChanged := newSettings != nil &&
		(oldSettings.GlobalAccessKey != newSettings.GlobalAccessKey ||
			oldSettings.GlobalSecretKey != newSettings.GlobalSecretKey)
	settingsSnapshot, err := snapshotFile(s.dataFilePath)
	if err != nil {
		s.mu.Unlock()
		return fmt.Errorf("备份当前设置失败: %w", err)
	}
	connectionsSnapshot, err := snapshotFile(connFilePath)
	if err != nil {
		s.mu.Unlock()
		return fmt.Errorf("备份当前连接失败: %w", err)
	}
	rollback := func() error {
		settingsErr := restoreFile(s.dataFilePath, settingsSnapshot)
		connectionsErr := restoreFile(connFilePath, connectionsSnapshot)
		s.settings = &oldSettings
		return errors.Join(settingsErr, connectionsErr)
	}
	if settingsData != nil {
		if err := writeAtomicFile(s.dataFilePath, settingsData); err != nil {
			rollbackErr := rollback()
			s.mu.Unlock()
			if rollbackErr != nil {
				return fmt.Errorf("保存设置失败: %w；回滚也失败: %v", err, rollbackErr)
			}
			return fmt.Errorf("保存设置失败: %w", err)
		}
	}
	if connData != nil {
		if err := writeAtomicFile(connFilePath, connData); err != nil {
			rollbackErr := rollback()
			s.mu.Unlock()
			if rollbackErr != nil {
				return fmt.Errorf("保存连接配置失败: %w；回滚也失败: %v", err, rollbackErr)
			}
			return fmt.Errorf("保存连接配置失败: %w", err)
		}
	}
	if newSettings != nil {
		s.settings = newSettings
	}
	reloader := s.connectionReloader
	s.mu.Unlock()

	if reloader != nil && (connData != nil || credentialsChanged) {
		if err := reloader(); err != nil {
			s.mu.Lock()
			rollbackErr := rollback()
			s.mu.Unlock()
			_ = reloader()
			if rollbackErr != nil {
				return fmt.Errorf("热重载连接配置失败: %w；回滚也失败: %v", err, rollbackErr)
			}
			return fmt.Errorf("热重载连接配置失败，已回滚: %w", err)
		}
	}

	return nil
}

// ClearCache removes temporary data.
func (s *SettingsService) ClearCache() error {
	// Remove temporary files from the configuration directory.
	configDir := filepath.Dir(s.dataFilePath)
	entries, err := os.ReadDir(configDir)
	if err != nil {
		return nil // Ignore a missing directory.
	}

	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".tmp") {
			_ = os.Remove(filepath.Join(configDir, entry.Name()))
			continue
		}
		if strings.Contains(entry.Name(), ".tmp-") {
			info, infoErr := entry.Info()
			if infoErr == nil && time.Since(info.ModTime()) > time.Hour {
				_ = os.Remove(filepath.Join(configDir, entry.Name()))
			}
		}
	}

	return nil
}
