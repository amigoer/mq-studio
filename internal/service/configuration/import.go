package configuration

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/amigoer/rocket-leaf/internal/model"
)

// ImportAllConfigFromFile imports configuration from sourcePath.
func (s *Service) ImportAllConfigFromFile(sourcePath string) error {
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

// ImportAllConfig atomically coordinates settings and connection replacement.
func (s *Service) ImportAllConfig(raw string) error {
	var payload importPayload
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return fmt.Errorf("解析导入数据失败: %w", err)
	}
	if payload.Version > currentExportVersion {
		return fmt.Errorf("不支持的配置版本: %d", payload.Version)
	}
	if payload.Settings == nil && len(payload.Connections) == 0 {
		return errors.New("导入文件不包含设置或连接配置")
	}

	connectionsIncluded := len(payload.Connections) > 0 && string(payload.Connections) != "null"
	var importedConnections []*model.Connection
	if connectionsIncluded {
		store, err := decodeConnectionStore(payload.Connections, payload.Version < currentExportVersion)
		if err != nil {
			return fmt.Errorf("解析连接配置失败: %w", err)
		}
		importedConnections = store.Connections
		if s.connections == nil {
			return errors.New("连接配置服务不可用")
		}
		if err := s.connections.ValidateConnections(importedConnections); err != nil {
			return fmt.Errorf("准备连接配置失败: %w", err)
		}
	}

	err := s.importConfig(payload, importedConnections, connectionsIncluded)
	if payload.Settings != nil {
		// Report whatever ended up on disk, applied or rolled back.
		s.notify(s.settings.GetSettings())
	}
	return err
}

func (s *Service) importConfig(
	payload importPayload,
	importedConnections []*model.Connection,
	connectionsIncluded bool,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	previousSettings := s.settings.GetSettings()
	var previousConnections []*model.Connection
	if s.connections != nil {
		previousConnections = s.connections.GetConnections()
	}

	settingsChanged := payload.Settings != nil
	credentialsWereChanged := false
	if settingsChanged {
		updated, err := s.settings.UpdateSettings(*payload.Settings)
		if err != nil {
			return fmt.Errorf("保存设置失败: %w", err)
		}
		credentialsWereChanged = credentialsChanged(previousSettings, updated)
	}

	applyErr := s.applyConnections(importedConnections, connectionsIncluded, credentialsWereChanged)
	if applyErr == nil {
		return nil
	}
	rollbackErr := s.rollback(
		previousSettings,
		previousConnections,
		settingsChanged,
		connectionsIncluded || credentialsWereChanged,
	)
	if rollbackErr != nil {
		return fmt.Errorf("热重载连接配置失败: %w；回滚也失败: %v", applyErr, rollbackErr)
	}
	return fmt.Errorf("热重载连接配置失败，已回滚: %w", applyErr)
}

func (s *Service) applyConnections(connections []*model.Connection, included, credentialsChanged bool) error {
	switch {
	case included && s.connections == nil:
		return errors.New("连接配置服务不可用")
	case included:
		return s.connections.ReplaceConnections(connections)
	case credentialsChanged && s.connections != nil:
		return s.connections.Reload()
	default:
		return nil
	}
}

func (s *Service) rollback(
	settings *model.AppSettings,
	connections []*model.Connection,
	settingsChanged bool,
	connectionsChanged bool,
) error {
	var settingsErr error
	if settingsChanged && settings != nil {
		_, settingsErr = s.settings.UpdateSettings(*settings)
	}
	var connectionsErr error
	if connectionsChanged && s.connections != nil {
		connectionsErr = s.connections.ReplaceConnections(connections)
	}
	return errors.Join(settingsErr, connectionsErr)
}
