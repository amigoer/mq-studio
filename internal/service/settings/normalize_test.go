package settings

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/amigoer/mq-studio/internal/model"
)

func TestNormalizeEnforcesSettingsBounds(t *testing.T) {
	input := *model.DefaultSettings()
	input.Theme = "neon"
	input.Language = "fr"
	input.FontSize = 99
	input.CloseBehavior = "explode"
	input.UIFont = " "
	input.MonospaceFont = ""
	input.ConnectTimeoutMs = 10
	input.RequestTimeoutMs = 400000
	input.LagAlertThreshold = -1
	input.DiskAlertThreshold = 150
	input.Timezone = "mars"
	input.TimestampFormat = "iso"
	input.MaxPayloadRenderBytes = 1
	input.FetchLimit = 1001
	input.ProxyType = "ftp"
	input.GlobalAccessKey = " access-key "

	got := normalize(input)
	defaults := model.DefaultSettings()
	if got.Theme != defaults.Theme || got.Language != defaults.Language {
		t.Fatalf("theme or language was not normalized: %q %q", got.Theme, got.Language)
	}
	if got.FontSize != defaults.FontSize || got.UIFont != defaults.UIFont || got.MonospaceFont != defaults.MonospaceFont {
		t.Fatalf("font settings were not normalized: %#v", got)
	}
	if got.CloseBehavior != defaults.CloseBehavior {
		t.Fatalf("closeBehavior was not normalized: %q", got.CloseBehavior)
	}
	if got.ConnectTimeoutMs != defaults.ConnectTimeoutMs || got.RequestTimeoutMs != defaults.RequestTimeoutMs {
		t.Fatalf("timeouts were not normalized: %#v", got)
	}
	if got.LagAlertThreshold != 0 || got.DiskAlertThreshold != 100 {
		t.Fatalf("alert thresholds were not normalized: %#v", got)
	}
	if got.Timezone != defaults.Timezone || got.TimestampFormat != defaults.TimestampFormat {
		t.Fatalf("display settings were not normalized: %#v", got)
	}
	if got.MaxPayloadRenderBytes != defaults.MaxPayloadRenderBytes || got.FetchLimit != defaults.FetchLimit {
		t.Fatalf("payload settings were not normalized: %#v", got)
	}
	if got.ProxyType != defaults.ProxyType || got.GlobalAccessKey != "access-key" {
		t.Fatalf("network settings were not normalized: %#v", got)
	}
}

func TestNormalizeKeepsDisabledLagThreshold(t *testing.T) {
	input := *model.DefaultSettings()
	input.LagAlertThreshold = 0
	if got := normalize(input); got.LagAlertThreshold != 0 {
		t.Fatalf("zero lag threshold should remain disabled, got %d", got.LagAlertThreshold)
	}
}

func TestLoadConvertsLegacyFontSize(t *testing.T) {
	directory := t.TempDir()
	path := filepath.Join(directory, "settings.json")
	if err := os.WriteFile(path, []byte(`{"fontSize":"large","theme":"dark"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	service := New(path)
	settings := service.GetSettings()
	if settings.FontSize != 16 || settings.Theme != "dark" {
		t.Fatalf("legacy settings were not converted: %#v", settings)
	}
}
