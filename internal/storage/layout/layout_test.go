package layout

import (
	"path/filepath"
	"testing"
)

func TestInBuildsAllPersistentPaths(t *testing.T) {
	directory := filepath.Join("tmp", "rocket-leaf")
	paths := In(directory)
	if paths.SettingsFile != filepath.Join(directory, "settings.json") {
		t.Fatalf("settings path = %q", paths.SettingsFile)
	}
	if paths.ConnectionsFile != filepath.Join(directory, "connections.json") {
		t.Fatalf("connections path = %q", paths.ConnectionsFile)
	}
	if paths.TPSHistoryFile != filepath.Join(directory, "tps-history.json") {
		t.Fatalf("TPS history path = %q", paths.TPSHistoryFile)
	}
	if paths.SecretKeyFile != filepath.Join(directory, "secret.key") {
		t.Fatalf("secret key path = %q", paths.SecretKeyFile)
	}
}
