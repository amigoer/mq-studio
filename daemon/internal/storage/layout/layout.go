// Package layout defines the daemon's on-disk configuration layout.
package layout

import (
	"fmt"
	"os"
	"path/filepath"
)

const applicationDirectory = "rocket-leaf"

// Layout contains every persistent path shared across service domains.
type Layout struct {
	Directory       string
	SettingsFile    string
	ConnectionsFile string
	TPSHistoryFile  string
	SecretKeyFile   string
}

// Default resolves the current user's Rocket Leaf configuration layout.
func Default() (Layout, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return Layout{}, fmt.Errorf("failed to get user config directory: %w", err)
	}
	return In(filepath.Join(configDir, applicationDirectory)), nil
}

// In builds a configuration layout rooted at directory.
func In(directory string) Layout {
	return Layout{
		Directory:       directory,
		SettingsFile:    filepath.Join(directory, "settings.json"),
		ConnectionsFile: filepath.Join(directory, "connections.json"),
		TPSHistoryFile:  filepath.Join(directory, "tps-history.json"),
		SecretKeyFile:   filepath.Join(directory, "secret.key"),
	}
}
