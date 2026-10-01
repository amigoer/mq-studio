package layout

import (
	"path/filepath"
	"testing"
)

func TestInBuildsAllPersistentPaths(t *testing.T) {
	directory := filepath.Join("tmp", "mq-studio")
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
	if paths.AgentAuditFile != filepath.Join(directory, "agent-audit.jsonl") {
		t.Fatalf("agent audit path = %q", paths.AgentAuditFile)
	}
	if paths.AgentFile != filepath.Join(directory, "agent.json") {
		t.Fatalf("agent settings path = %q", paths.AgentFile)
	}
	if paths.AgentSessionsDir != filepath.Join(directory, "agent", "sessions") {
		t.Fatalf("agent sessions path = %q", paths.AgentSessionsDir)
	}
}
