// Package service 提供业务服务层
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

	"rocket-leaf/internal/crypto"
	"rocket-leaf/internal/model"
)

const settingsDataFileName = "settings.json"

// SettingsService 设置管理服务
type SettingsService struct {
	mu           sync.RWMutex
	settings     *model.AppSettings
	dataFilePath string
}

// NewSettingsService 创建设置管理服务
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

func resolveSettingsDataFilePath() string {
	configDir, err := os.UserConfigDir()
	if err != nil || strings.TrimSpace(configDir) == "" {
		return settingsDataFileName
	}

	return filepath.Join(configDir, appConfigDirName, settingsDataFileName)
}

// loadFromFile 从文件加载设置
func (s *SettingsService) loadFromFile() error {
	data, err := os.ReadFile(s.dataFilePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}

	// 先用默认值填充，再覆盖已保存的字段
	loaded := model.DefaultSettings()
	if err := json.Unmarshal(data, loaded); err != nil {
		// 兼容旧格式（fontSize 从 string 改为 int），忽略类型不匹配的错误
		log.Printf("[SettingsService] 解析设置文件(部分字段可能使用旧格式): %v", err)
	}

	// 规范化 fontSize：确保在有效范围内
	if loaded.FontSize < 12 || loaded.FontSize > 18 {
		loaded.FontSize = 14
	}

	// 解密敏感字段（兼容未加密的旧数据）
	if loaded.GlobalAccessKey != "" {
		if decrypted, decErr := crypto.Decrypt(loaded.GlobalAccessKey, "globalAccessKey"); decErr == nil {
			loaded.GlobalAccessKey = decrypted
		}
	}
	if loaded.GlobalSecretKey != "" {
		if decrypted, decErr := crypto.Decrypt(loaded.GlobalSecretKey, "globalSecretKey"); decErr == nil {
			loaded.GlobalSecretKey = decrypted
		}
	}

	s.settings = loaded
	return nil
}

// saveToFileLocked 将设置持久化到文件（调用方需持有写锁）
func (s *SettingsService) saveToFileLocked() error {
	// 复制设置并加密敏感字段后再写入文件
	toSave := *s.settings
	if toSave.GlobalAccessKey != "" {
		if encrypted, encErr := crypto.Encrypt(toSave.GlobalAccessKey, "globalAccessKey"); encErr == nil {
			toSave.GlobalAccessKey = encrypted
		}
	}
	if toSave.GlobalSecretKey != "" {
		if encrypted, encErr := crypto.Encrypt(toSave.GlobalSecretKey, "globalSecretKey"); encErr == nil {
			toSave.GlobalSecretKey = encrypted
		}
	}

	data, err := json.MarshalIndent(&toSave, "", "  ")
	if err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(s.dataFilePath), 0o755); err != nil {
		return err
	}

	// 原子写入：先写临时文件，再重命名
	tempFilePath := s.dataFilePath + ".tmp"
	if err := os.WriteFile(tempFilePath, data, 0o600); err != nil {
		return err
	}

	if err := os.Rename(tempFilePath, s.dataFilePath); err != nil {
		_ = os.Remove(tempFilePath)
		return err
	}

	return nil
}

// GetConnectTimeout 获取连接超时时间
func (s *SettingsService) GetConnectTimeout() time.Duration {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ms := s.settings.ConnectTimeoutMs
	if ms <= 0 {
		ms = 3000
	}
	return time.Duration(ms) * time.Millisecond
}

// GetRequestTimeout 获取请求超时时间
func (s *SettingsService) GetRequestTimeout() time.Duration {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ms := s.settings.RequestTimeoutMs
	if ms <= 0 {
		ms = 5000
	}
	return time.Duration(ms) * time.Millisecond
}

// GetFetchLimit 获取单页拉取数量
func (s *SettingsService) GetFetchLimit() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	limit := s.settings.FetchLimit
	if limit <= 0 {
		limit = 64
	}
	return limit
}

// GetAutoConnectLast 获取是否自动连接上次集群
func (s *SettingsService) GetAutoConnectLast() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.settings.AutoConnectLast
}

// GetSettings 获取全部设置
func (s *SettingsService) GetSettings() *model.AppSettings {
	s.mu.RLock()
	defer s.mu.RUnlock()

	// 返回副本
	copy := *s.settings
	return &copy
}

// UpdateSettings 更新全部设置并持久化
func (s *SettingsService) UpdateSettings(settings model.AppSettings) (*model.AppSettings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	old := *s.settings
	s.settings = &settings

	if err := s.saveToFileLocked(); err != nil {
		s.settings = &old
		return nil, err
	}

	copy := *s.settings
	return &copy, nil
}

// ResetSettings 重置为默认设置
func (s *SettingsService) ResetSettings() (*model.AppSettings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	old := *s.settings
	s.settings = model.DefaultSettings()

	if err := s.saveToFileLocked(); err != nil {
		s.settings = &old
		return nil, err
	}

	copy := *s.settings
	return &copy, nil
}

// ExportAllConfig 导出全部配置（设置 + 连接）为 JSON 字符串
func (s *SettingsService) ExportAllConfig() (string, error) {
	s.mu.RLock()
	settingsCopy := *s.settings
	s.mu.RUnlock()

	// 读取连接配置文件
	connFilePath := filepath.Join(filepath.Dir(s.dataFilePath), connectionDataFileName)
	var connections json.RawMessage
	connData, err := os.ReadFile(connFilePath)
	if err != nil {
		connections = json.RawMessage("[]")
	} else {
		connections = json.RawMessage(connData)
	}

	exportData := map[string]interface{}{
		"version":     1,
		"settings":    settingsCopy,
		"connections": connections,
	}

	data, err := json.MarshalIndent(exportData, "", "  ")
	if err != nil {
		return "", fmt.Errorf("导出配置失败: %w", err)
	}

	return string(data), nil
}

// ImportAllConfig 导入全部配置
func (s *SettingsService) ImportAllConfig(jsonStr string) error {
	var importData struct {
		Settings    *model.AppSettings `json:"settings"`
		Connections json.RawMessage    `json:"connections"`
	}

	if err := json.Unmarshal([]byte(jsonStr), &importData); err != nil {
		return fmt.Errorf("解析导入数据失败: %w", err)
	}

	// 导入设置
	if importData.Settings != nil {
		s.mu.Lock()
		old := *s.settings
		s.settings = importData.Settings
		if err := s.saveToFileLocked(); err != nil {
			s.settings = &old
			s.mu.Unlock()
			return fmt.Errorf("保存设置失败: %w", err)
		}
		s.mu.Unlock()
	}

	// 导入连接配置
	if len(importData.Connections) > 0 {
		connFilePath := filepath.Join(filepath.Dir(s.dataFilePath), connectionDataFileName)
		if err := os.MkdirAll(filepath.Dir(connFilePath), 0o755); err != nil {
			return fmt.Errorf("创建目录失败: %w", err)
		}
		tempFilePath := connFilePath + ".tmp"
		if err := os.WriteFile(tempFilePath, importData.Connections, 0o600); err != nil {
			return fmt.Errorf("保存连接配置失败: %w", err)
		}
		if err := os.Rename(tempFilePath, connFilePath); err != nil {
			_ = os.Remove(tempFilePath)
			return fmt.Errorf("保存连接配置失败: %w", err)
		}
	}

	return nil
}

// ClearCache 清理缓存（重置临时数据）
func (s *SettingsService) ClearCache() error {
	// 清理配置目录下的临时文件
	configDir := filepath.Dir(s.dataFilePath)
	entries, err := os.ReadDir(configDir)
	if err != nil {
		return nil // 目录不存在时忽略
	}

	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".tmp") {
			_ = os.Remove(filepath.Join(configDir, entry.Name()))
		}
	}

	return nil
}
