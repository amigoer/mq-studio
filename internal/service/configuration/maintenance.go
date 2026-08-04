package configuration

import (
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ClearCache removes stale temporary files from the configuration directory.
func (s *Service) ClearCache() error {
	entries, err := os.ReadDir(s.layout.Directory)
	if err != nil {
		return nil
	}

	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".tmp") {
			_ = os.Remove(filepath.Join(s.layout.Directory, entry.Name()))
			continue
		}
		if strings.Contains(entry.Name(), ".tmp-") {
			info, infoErr := entry.Info()
			if infoErr == nil && time.Since(info.ModTime()) > time.Hour {
				_ = os.Remove(filepath.Join(s.layout.Directory, entry.Name()))
			}
		}
	}
	return nil
}
