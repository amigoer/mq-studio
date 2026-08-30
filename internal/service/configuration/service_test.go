package configuration

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/storage/layout"
)

type fakeSettings struct {
	current *model.AppSettings
}

func (f *fakeSettings) GetSettings() *model.AppSettings {
	copy := *f.current
	return &copy
}

func (f *fakeSettings) UpdateSettings(next model.AppSettings) (*model.AppSettings, error) {
	f.current = &next
	return f.GetSettings(), nil
}

func (f *fakeSettings) ResetSettings() (*model.AppSettings, error) {
	f.current = model.DefaultSettings()
	return f.GetSettings(), nil
}

type fakeConnections struct {
	current         []*model.ConnectionProfile
	validateErr     error
	validateCalls   int
	reloadErr       error
	reloadCalls     int
	replaceFailures int
	replaceCalls    int
}

func (f *fakeConnections) GetConnections() []*model.ConnectionProfile {
	result := make([]*model.ConnectionProfile, 0, len(f.current))
	for _, connection := range f.current {
		if connection == nil {
			continue
		}
		copy := *connection
		result = append(result, &copy)
	}
	return result
}

func (f *fakeConnections) ValidateConnections([]*model.ConnectionProfile) error {
	f.validateCalls++
	return f.validateErr
}

func (f *fakeConnections) ReplaceConnections(next []*model.ConnectionProfile) error {
	f.replaceCalls++
	if f.replaceFailures > 0 {
		f.replaceFailures--
		return errors.New("replace failed")
	}
	f.current = next
	return nil
}

func (f *fakeConnections) Reload() error {
	f.reloadCalls++
	return f.reloadErr
}

func TestUpdateSettingsReloadsConnectionsWhenCredentialsChange(t *testing.T) {
	settings := &fakeSettings{current: model.DefaultSettings()}
	connections := &fakeConnections{}
	service := New(layout.In(t.TempDir()), settings, connections)

	next := *model.DefaultSettings()
	next.GlobalAccessKey = "access"
	next.GlobalSecretKey = "secret"
	if _, err := service.UpdateSettings(next); err != nil {
		t.Fatal(err)
	}
	if connections.reloadCalls != 1 {
		t.Fatalf("reload calls = %d, want 1", connections.reloadCalls)
	}
}

func TestImportRejectsInvalidConnectionsBeforeChangingState(t *testing.T) {
	previousSettings := *model.DefaultSettings()
	previousSettings.Theme = "light"
	settings := &fakeSettings{current: &previousSettings}
	connections := &fakeConnections{
		current: []*model.ConnectionProfile{{
			ID:        1,
			Name:      "online",
			Endpoints: "online:9876",
			Status:    model.StatusOnline,
		}},
		validateErr: errors.New("invalid connection"),
	}
	service := New(layout.In(t.TempDir()), settings, connections)

	raw := `{"version":2,"settings":{"theme":"dark"},"connections":{"connections":[{"name":"invalid"}]}}`
	err := service.ImportAllConfig(raw)
	if err == nil || !strings.Contains(err.Error(), "准备连接配置失败") {
		t.Fatalf("error = %v, want connection preparation failure", err)
	}
	if connections.validateCalls != 1 {
		t.Fatalf("validation calls = %d, want 1", connections.validateCalls)
	}
	if connections.replaceCalls != 0 || connections.reloadCalls != 0 {
		t.Fatalf("replace calls = %d, reload calls = %d; invalid input must not change runtime state", connections.replaceCalls, connections.reloadCalls)
	}
	if got := settings.GetSettings(); got.Theme != "light" {
		t.Fatalf("settings changed before connection validation: %#v", got)
	}
	gotConnections := connections.GetConnections()
	if len(gotConnections) != 1 || gotConnections[0].Status != model.StatusOnline {
		t.Fatalf("online connection state changed: %#v", gotConnections)
	}
}

func TestUpdateSettingsRetainsSavedSettingsWhenReloadFails(t *testing.T) {
	settings := &fakeSettings{current: model.DefaultSettings()}
	connections := &fakeConnections{reloadErr: errors.New("reload failed")}
	service := New(layout.In(t.TempDir()), settings, connections)

	next := *model.DefaultSettings()
	next.Theme = "dark"
	next.GlobalAccessKey = "access"
	next.GlobalSecretKey = "secret"
	updated, err := service.UpdateSettings(next)
	if err == nil || updated == nil {
		t.Fatalf("updated = %#v, error = %v", updated, err)
	}
	if got := settings.GetSettings(); got.Theme != "dark" || got.GlobalAccessKey != "access" {
		t.Fatalf("saved settings should be retained after reload failure: %#v", got)
	}
}

func TestImportRollsBackSettingsAfterConnectionFailure(t *testing.T) {
	previousSettings := model.DefaultSettings()
	previousConnections := []*model.ConnectionProfile{{ID: 1, Name: "old", Endpoints: "old:9876"}}
	settings := &fakeSettings{current: previousSettings}
	connections := &fakeConnections{current: previousConnections, replaceFailures: 1}
	service := New(layout.In(t.TempDir()), settings, connections)

	raw := `{"version":2,"settings":{"theme":"dark"},"connections":{"connections":[{"id":2,"name":"new","nameServer":"new:9876"}]}}`
	err := service.ImportAllConfig(raw)
	if err == nil || !strings.Contains(err.Error(), "已回滚") {
		t.Fatalf("error = %v, want rollback error", err)
	}
	if settings.GetSettings().Theme != previousSettings.Theme {
		t.Fatal("settings were not rolled back")
	}
	if got := connections.GetConnections(); len(got) != 1 || got[0].Name != "old" {
		t.Fatalf("connections were not rolled back: %#v", got)
	}
}

func TestExportIncludesPortableConnectionCredentials(t *testing.T) {
	settings := &fakeSettings{current: model.DefaultSettings()}
	connections := &fakeConnections{current: []*model.ConnectionProfile{{
		ID: 1, Name: "prod", Endpoints: "ns:9876", Auth: model.AuthConfig{Mechanism: model.AuthACL}, Secrets: map[string]string{model.SecretAccessKey: "portable-ak", model.SecretSecretKey: "portable-sk"},
	}}}
	service := New(layout.In(t.TempDir()), settings, connections)

	raw, err := service.ExportAllConfig()
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{`"containsSecrets": true`, `"portable-ak"`, `"portable-sk"`} {
		if !strings.Contains(raw, expected) {
			t.Fatalf("export is missing %s: %s", expected, raw)
		}
	}
}

func TestExportMarksConfigurationWithoutCredentialsAsNonSensitive(t *testing.T) {
	settings := &fakeSettings{current: model.DefaultSettings()}
	service := New(layout.In(t.TempDir()), settings, &fakeConnections{})
	raw, err := service.ExportAllConfig()
	if err != nil {
		t.Fatal(err)
	}
	var payload exportPayload
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.ContainsSecrets {
		t.Fatal("credential-free configuration was marked sensitive")
	}
	if payload.Connections.Connections == nil {
		t.Fatal("empty connections must be encoded as an array, not null")
	}
}

func TestDecodeVersionTwoCredentialsKeepsENCPrefix(t *testing.T) {
	raw := []byte(`{"connections":[{"id":1,"accessKey":"ENC:literal-ak","secretKey":"ENC:literal-sk"}]}`)
	store, err := decodeConnectionStore(raw, false)
	if err != nil {
		t.Fatal(err)
	}
	if store.Connections[0].Secret(model.SecretAccessKey) != "ENC:literal-ak" || store.Connections[0].Secret(model.SecretSecretKey) != "ENC:literal-sk" {
		t.Fatalf("credentials changed: %#v", store.Connections[0])
	}
}

func TestImportRejectsUnsupportedVersionBeforeChangingState(t *testing.T) {
	settings := &fakeSettings{current: model.DefaultSettings()}
	connections := &fakeConnections{current: []*model.ConnectionProfile{{ID: 1, Name: "old", Endpoints: "old:9876"}}}
	service := New(layout.In(t.TempDir()), settings, connections)
	if err := service.ImportAllConfig(`{"version":3,"settings":{"theme":"dark"}}`); err == nil {
		t.Fatal("unsupported version should fail")
	}
	if settings.GetSettings().Theme != model.DefaultSettings().Theme {
		t.Fatal("unsupported import changed settings")
	}
	if got := connections.GetConnections(); len(got) != 1 || got[0].Name != "old" {
		t.Fatalf("unsupported import changed connections: %#v", got)
	}
}

func TestImportRejectsMalformedJSON(t *testing.T) {
	settings := &fakeSettings{current: model.DefaultSettings()}
	connections := &fakeConnections{}
	service := New(layout.In(t.TempDir()), settings, connections)
	if err := service.ImportAllConfig("{not-json"); err == nil || !strings.Contains(err.Error(), "解析导入数据失败") {
		t.Fatalf("malformed import error = %v", err)
	}
	if connections.validateCalls != 0 || connections.replaceCalls != 0 || connections.reloadCalls != 0 {
		t.Fatal("malformed import reached connection operations")
	}
}

func TestExportRejectsCaseVariantOfReservedPath(t *testing.T) {
	paths := layout.In(t.TempDir())
	if err := os.WriteFile(paths.SettingsFile, []byte(`{"theme":"dark"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	service := New(paths, &fakeSettings{current: model.DefaultSettings()}, &fakeConnections{})
	target := filepath.Join(paths.Directory, "SETTINGS.JSON")
	_, err := service.ExportAllConfigToFile(target)
	if runtime.GOOS == "darwin" || runtime.GOOS == "windows" {
		if err == nil {
			t.Fatal("case-variant reserved path should be rejected")
		}
	}
}

func TestExportRejectsReservedPathThroughSymlinkParent(t *testing.T) {
	paths := layout.In(filepath.Join(t.TempDir(), "config"))
	if err := os.MkdirAll(paths.Directory, 0o700); err != nil {
		t.Fatal(err)
	}

	linkPath := filepath.Join(t.TempDir(), "config-link")
	if err := os.Symlink(paths.Directory, linkPath); err != nil {
		if runtime.GOOS == "windows" {
			t.Skipf("creating directory symlinks requires additional privileges on Windows: %v", err)
		}
		t.Fatal(err)
	}

	service := New(paths, &fakeSettings{current: model.DefaultSettings()}, &fakeConnections{})
	for _, protectedPath := range []string{paths.SettingsFile, paths.ConnectionsFile, paths.SecretKeyFile} {
		protectedPath := protectedPath
		t.Run(filepath.Base(protectedPath), func(t *testing.T) {
			targetPath := filepath.Join(linkPath, filepath.Base(protectedPath))
			if _, err := os.Stat(targetPath); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("target must not exist before export: %v", err)
			}
			if _, err := service.ExportAllConfigToFile(targetPath); err == nil {
				t.Fatal("symlink-parent alias of a reserved path should be rejected")
			}
			if _, err := os.Stat(protectedPath); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("reserved path was created through symlink parent: %v", err)
			}
		})
	}
}

func TestClearCacheRemovesOnlyEligibleTemporaryFiles(t *testing.T) {
	paths := layout.In(t.TempDir())
	service := New(paths, &fakeSettings{current: model.DefaultSettings()}, nil)
	oldAtomicTemp := filepath.Join(paths.Directory, ".connections.json.tmp-old")
	recentAtomicTemp := filepath.Join(paths.Directory, ".connections.json.tmp-recent")
	legacyTemp := filepath.Join(paths.Directory, "cache.tmp")
	regularFile := filepath.Join(paths.Directory, "keep.json")
	for _, path := range []string{oldAtomicTemp, recentAtomicTemp, legacyTemp, regularFile} {
		if err := os.WriteFile(path, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	oldTime := time.Now().Add(-2 * time.Hour)
	if err := os.Chtimes(oldAtomicTemp, oldTime, oldTime); err != nil {
		t.Fatal(err)
	}
	if err := service.ClearCache(); err != nil {
		t.Fatal(err)
	}
	for _, removed := range []string{oldAtomicTemp, legacyTemp} {
		if _, err := os.Stat(removed); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("temporary file was not removed: %s", removed)
		}
	}
	for _, retained := range []string{recentAtomicTemp, regularFile} {
		if _, err := os.Stat(retained); err != nil {
			t.Fatalf("file should have been retained: %s: %v", retained, err)
		}
	}
}
