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
	input.UIScale = "99"
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
	input.GlobalAccessKey = " access-key "

	got := normalize(input)
	defaults := model.DefaultSettings()
	if got.Theme != defaults.Theme || got.Language != defaults.Language {
		t.Fatalf("theme or language was not normalized: %q %q", got.Theme, got.Language)
	}
	if got.UIScale != defaults.UIScale || got.UIFont != defaults.UIFont || got.MonospaceFont != defaults.MonospaceFont {
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
	if got.GlobalAccessKey != "access-key" {
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
	for _, testCase := range []struct {
		name  string
		file  string
		scale string
	}{
		{"t-shirt size", `{"fontSize":"large","theme":"dark"}`, "16"},
		{"pixel step", `{"fontSize":16,"theme":"dark"}`, "16"},
		{"size off the ladder", `{"fontSize":17,"theme":"dark"}`, model.UIScaleAuto},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "settings.json")
			if err := os.WriteFile(path, []byte(testCase.file), 0o600); err != nil {
				t.Fatal(err)
			}
			settings := New(path).GetSettings()
			if settings.UIScale != testCase.scale || settings.Theme != "dark" {
				t.Fatalf("legacy settings were not converted: %#v", settings)
			}
		})
	}
}
