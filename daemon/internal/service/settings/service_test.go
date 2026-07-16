package settings

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/amigoer/rocket-leaf/daemon/internal/crypto"
	"github.com/amigoer/rocket-leaf/daemon/internal/model"
)

func newTestService(t *testing.T) (*Service, string) {
	t.Helper()
	directory := t.TempDir()
	if err := crypto.InitKey(directory); err != nil {
		t.Fatalf("initialize encryption key: %v", err)
	}
	path := filepath.Join(directory, "settings.json")
	return New(path), path
}

func TestUpdatePersistsEncryptedSettingsAndReloads(t *testing.T) {
	service, path := newTestService(t)
	next := *model.DefaultSettings()
	next.Theme = "dark"
	next.Language = "en"
	next.LagAlertThreshold = 5000
	next.DiskAlertThreshold = 80
	next.DesktopNotifications = true
	next.GlobalAccessKey = "global-ak"
	next.GlobalSecretKey = "global-sk"

	updated, err := service.UpdateSettings(next)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Theme != "dark" || updated.DiskAlertThreshold != 80 || !updated.DesktopNotifications {
		t.Fatalf("unexpected update result: %#v", updated)
	}

	diskData, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(diskData, []byte("global-ak")) || bytes.Contains(diskData, []byte("global-sk")) {
		t.Fatal("persisted settings must not contain plaintext credentials")
	}
	var persisted model.AppSettings
	if err := json.Unmarshal(diskData, &persisted); err != nil {
		t.Fatal(err)
	}
	if !crypto.IsEncrypted(persisted.GlobalAccessKey) || !crypto.IsEncrypted(persisted.GlobalSecretKey) {
		t.Fatalf("credentials were not encrypted: %#v", persisted)
	}

	reloaded := New(path)
	current := reloaded.GetSettings()
	if current.Theme != "dark" || current.LagAlertThreshold != 5000 || current.DiskAlertThreshold != 80 {
		t.Fatalf("unexpected reloaded settings: %#v", current)
	}
	accessKey, secretKey := reloaded.GetGlobalACLCredentials()
	if accessKey != "global-ak" || secretKey != "global-sk" {
		t.Fatalf("unexpected decrypted credentials: %q %q", accessKey, secretKey)
	}
}

func TestResetSettingsClearsCredentials(t *testing.T) {
	service, _ := newTestService(t)
	next := *model.DefaultSettings()
	next.Theme = "dark"
	next.GlobalAccessKey = "global-ak"
	next.GlobalSecretKey = "global-sk"
	if _, err := service.UpdateSettings(next); err != nil {
		t.Fatal(err)
	}

	reset, err := service.ResetSettings()
	if err != nil {
		t.Fatal(err)
	}
	if reset.Theme != "system" {
		t.Fatalf("unexpected reset theme: %q", reset.Theme)
	}
	accessKey, secretKey := service.GetGlobalACLCredentials()
	if accessKey != "" || secretKey != "" {
		t.Fatalf("reset retained credentials: %q %q", accessKey, secretKey)
	}
}

func TestGetSettingsReturnsCopy(t *testing.T) {
	service, _ := newTestService(t)
	copy := service.GetSettings()
	copy.Theme = "dark"
	if service.GetSettings().Theme != "system" {
		t.Fatal("mutating returned settings changed service state")
	}
}

func TestNewUsesDefaultsWhenFileDoesNotExist(t *testing.T) {
	service, _ := newTestService(t)
	if got := service.GetSettings(); got.Theme != "system" || got.FetchLimit <= 0 {
		t.Fatalf("unexpected defaults: %#v", got)
	}
}
