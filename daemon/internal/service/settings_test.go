package service

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
)

func newTestSettingsService(t *testing.T) *SettingsService {
	t.Helper()
	ensureTestCrypto(t)
	dir := t.TempDir()
	return &SettingsService{
		settings:     model.DefaultSettings(),
		dataFilePath: filepath.Join(dir, "settings.json"),
	}
}

func TestSettingsUpdateAndGetRoundTrip(t *testing.T) {
	s := newTestSettingsService(t)
	next := *model.DefaultSettings()
	next.Theme = "dark"
	next.LagAlertThreshold = 5000
	next.DiskAlertThreshold = 80
	next.DesktopNotifications = true
	next.Language = "en"

	got, err := s.UpdateSettings(next)
	if err != nil {
		t.Fatal(err)
	}
	if got.Theme != "dark" || got.DiskAlertThreshold != 80 || !got.DesktopNotifications {
		t.Fatalf("update result: %#v", got)
	}

	// Reload from disk into a fresh service pointing at same file.
	reloaded := &SettingsService{
		settings:     model.DefaultSettings(),
		dataFilePath: s.dataFilePath,
	}
	if err := reloaded.loadFromFile(); err != nil {
		t.Fatal(err)
	}
	cur := reloaded.GetSettings()
	if cur.Theme != "dark" || cur.LagAlertThreshold != 5000 || cur.DiskAlertThreshold != 80 {
		t.Fatalf("reloaded: %#v", cur)
	}
	if reloaded.GetFetchLimit() != next.FetchLimit {
		t.Fatalf("fetch limit %d", reloaded.GetFetchLimit())
	}
}

func TestSettingsResetAndGlobalACL(t *testing.T) {
	s := newTestSettingsService(t)
	next := *model.DefaultSettings()
	next.GlobalAccessKey = "g-ak"
	next.GlobalSecretKey = "g-sk"
	next.Theme = "dark"
	if _, err := s.UpdateSettings(next); err != nil {
		t.Fatal(err)
	}
	ak, sk := s.GetGlobalACLCredentials()
	if ak != "g-ak" || sk != "g-sk" {
		t.Fatalf("global acl %q %q", ak, sk)
	}
	reset, err := s.ResetSettings()
	if err != nil {
		t.Fatal(err)
	}
	if reset.Theme != "system" {
		t.Fatalf("reset theme %q", reset.Theme)
	}
	ak, sk = s.GetGlobalACLCredentials()
	if ak != "" || sk != "" {
		t.Fatalf("reset should clear global acl, got %q %q", ak, sk)
	}
}

func TestSettingsExportMarksSecrets(t *testing.T) {
	s := newTestSettingsService(t)
	// Point connections path next to settings via same dir layout expectation:
	// ExportAllConfig reads connections from filepath.Dir(settings)/connections.json
	connPath := filepath.Join(filepath.Dir(s.dataFilePath), connectionDataFileName)
	store := connectionStore{Connections: []*model.Connection{{
		ID: 1, Name: "c1", NameServer: "127.0.0.1:9876", TimeoutSec: 5,
		EnableACL: true, AccessKey: "export-ak", SecretKey: "export-sk",
	}}}
	data, err := marshalConnectionsForDisk(store)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(connPath, data, 0o600); err != nil {
		t.Fatal(err)
	}

	next := *model.DefaultSettings()
	next.GlobalAccessKey = "gak"
	next.GlobalSecretKey = "gsk"
	if _, err := s.UpdateSettings(next); err != nil {
		t.Fatal(err)
	}

	raw, err := s.ExportAllConfig()
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["containsSecrets"] != true {
		t.Fatalf("export should mark secrets: %#v", payload["containsSecrets"])
	}
	// Exported connections should be plaintext for migration.
	if !jsonContainsString(raw, "export-ak") {
		t.Fatal("export should include plaintext connection AK for migration")
	}
}

func jsonContainsString(raw, needle string) bool {
	return len(raw) > 0 && (func() bool {
		return json.Valid([]byte(raw)) && (len(needle) > 0 && (func() bool {
			var m map[string]any
			_ = json.Unmarshal([]byte(raw), &m)
			b, _ := json.Marshal(m)
			return string(b) != "" && (func() bool {
				return containsSubstring(raw, needle)
			})()
		})())
	})()
}

func containsSubstring(s, sub string) bool {
	return len(sub) == 0 || (len(s) >= len(sub) && (func() bool {
		for i := 0; i+len(sub) <= len(s); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
		return false
	})())
}

func TestSettingsImportInvalidJSON(t *testing.T) {
	s := newTestSettingsService(t)
	if err := s.ImportAllConfig("{not-json"); err == nil {
		t.Fatal("非法 JSON 应失败")
	}
}

func TestGetTimeouts(t *testing.T) {
	s := newTestSettingsService(t)
	if s.GetConnectTimeout().Milliseconds() <= 0 {
		t.Fatal("connect timeout")
	}
	if s.GetRequestTimeout().Milliseconds() <= 0 {
		t.Fatal("request timeout")
	}
	if !s.GetAutoConnectLast() {
		t.Fatal("auto connect default true")
	}
}
