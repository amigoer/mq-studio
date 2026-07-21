package configuration

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
	"github.com/amigoer/rocket-leaf/daemon/internal/storage/atomicfile"
)

// ExportAllConfig exports settings and connection profiles in the portable version 2 format.
func (s *Service) ExportAllConfig() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	settings := s.settings.GetSettings()
	connections := connectionStore{Connections: make([]*model.Connection, 0)}
	if s.connections != nil {
		connections.Connections = s.connections.GetConnections()
	}

	containsSecrets := settings != nil &&
		(settings.GlobalAccessKey != "" || settings.GlobalSecretKey != "")
	for _, connection := range connections.Connections {
		if connection != nil && (connection.AccessKey != "" || connection.SecretKey != "") {
			containsSecrets = true
			break
		}
	}

	payload := exportPayload{
		Version:         2,
		ContainsSecrets: containsSecrets,
		ExportedAt:      time.Now().Format(time.RFC3339),
		Settings:        settings,
		Connections:     connections,
	}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return "", fmt.Errorf("导出配置失败: %w", err)
	}
	return string(data), nil
}

// ExportAllConfigToFile writes all configuration to targetPath.
func (s *Service) ExportAllConfigToFile(targetPath string) (string, error) {
	targetPath = strings.TrimSpace(targetPath)
	if targetPath == "" {
		return "", errors.New("目标文件路径为空")
	}
	targetAbsolute, err := filepath.Abs(targetPath)
	if err != nil {
		return "", fmt.Errorf("解析目标文件路径失败: %w", err)
	}
	for _, reservedPath := range []string{
		s.layout.SettingsFile,
		s.layout.ConnectionsFile,
		s.layout.TPSHistoryFile,
		s.layout.SecretKeyFile,
	} {
		reservedAbsolute, reservedErr := filepath.Abs(reservedPath)
		if reservedErr != nil {
			return "", fmt.Errorf("解析应用配置路径失败: %w", reservedErr)
		}
		reserved, compareErr := sameProtectedPath(targetAbsolute, reservedAbsolute)
		if compareErr != nil {
			return "", fmt.Errorf("检查应用配置路径失败: %w", compareErr)
		}
		if reserved {
			return "", fmt.Errorf("不能用导出文件覆盖应用配置: %s", targetPath)
		}
	}

	content, err := s.ExportAllConfig()
	if err != nil {
		return "", err
	}
	if err := atomicfile.Write(targetPath, []byte(content)); err != nil {
		return "", fmt.Errorf("写入文件失败: %w", err)
	}
	return targetAbsolute, nil
}

func sameProtectedPath(targetPath, protectedPath string) (bool, error) {
	targetInfo, targetErr := os.Stat(targetPath)
	protectedInfo, protectedErr := os.Stat(protectedPath)
	if targetErr == nil && protectedErr == nil && os.SameFile(targetInfo, protectedInfo) {
		return true, nil
	}
	if targetErr != nil && !errors.Is(targetErr, os.ErrNotExist) {
		return false, targetErr
	}
	if protectedErr != nil && !errors.Is(protectedErr, os.ErrNotExist) {
		return false, protectedErr
	}

	targetPath, targetErr = resolveSymlinkParents(targetPath)
	if targetErr != nil {
		return false, targetErr
	}
	protectedPath, protectedErr = resolveSymlinkParents(protectedPath)
	if protectedErr != nil {
		return false, protectedErr
	}
	if runtime.GOOS == "darwin" || runtime.GOOS == "windows" {
		return strings.EqualFold(targetPath, protectedPath), nil
	}
	return targetPath == protectedPath, nil
}

// resolveSymlinkParents resolves symlinks in the longest existing ancestor and
// reattaches path components that do not exist yet. The final component is not
// evaluated because an atomic rename replaces a symlink at that location.
func resolveSymlinkParents(path string) (string, error) {
	path = filepath.Clean(path)
	parent, err := resolveExistingAncestor(filepath.Dir(path))
	if err != nil {
		return "", err
	}
	return filepath.Clean(filepath.Join(parent, filepath.Base(path))), nil
}

func resolveExistingAncestor(path string) (string, error) {
	current := filepath.Clean(path)
	missing := make([]string, 0)
	for {
		_, err := os.Lstat(current)
		if err == nil {
			resolved, resolveErr := filepath.EvalSymlinks(current)
			if resolveErr != nil {
				return "", resolveErr
			}
			for index := len(missing) - 1; index >= 0; index-- {
				resolved = filepath.Join(resolved, missing[index])
			}
			return filepath.Clean(resolved), nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			return "", err
		}

		parent := filepath.Dir(current)
		if parent == current {
			return current, nil
		}
		missing = append(missing, filepath.Base(current))
		current = parent
	}
}
