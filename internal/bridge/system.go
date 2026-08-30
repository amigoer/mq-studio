package bridge

import (
	"fmt"
	"net/url"
	"os"
	"time"

	"github.com/amigoer/mq-studio/internal/service/configuration"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// maxImportBytes caps the config file the import dialog will read.
const maxImportBytes = 5 << 20

// allowedExternalHosts is the complete set of hosts the app may open in the
// user's browser. Everything else is rejected rather than handed to the OS.
var allowedExternalHosts = map[string]struct{}{
	"github.com":     {},
	"api.github.com": {},
}

// SystemService exposes application-level operations that need the desktop
// shell: version reporting, external links and file dialogs. The update
// lifecycle is UpdateService's.
type SystemService struct {
	settings *configuration.Service
	version  string
}

// Version returns the running application version.
func (s *SystemService) Version() string {
	return s.version
}

// DataDirectory reports where the app keeps its files. The settings page draws
// the real path rather than one per platform for the reader to pick from.
func (s *SystemService) DataDirectory() string {
	return s.settings.DataDirectory()
}

// RevealDataDirectory opens the data directory in the platform's file manager.
// The directory is the app's own, never a path from the renderer.
func (s *SystemService) RevealDataDirectory() error {
	directory := s.settings.DataDirectory()
	if _, err := os.Stat(directory); err != nil {
		return fmt.Errorf("failed to open the data directory: %w", err)
	}
	return application.Get().Browser.OpenFile(directory)
}

// OpenExternal opens an allow-listed HTTPS URL in the user's browser.
func (s *SystemService) OpenExternal(rawURL string) error {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid external link: %w", err)
	}
	if parsed.Scheme != "https" {
		return fmt.Errorf("opening this external link is not allowed: %s", rawURL)
	}
	if _, allowed := allowedExternalHosts[parsed.Hostname()]; !allowed {
		return fmt.Errorf("opening this external link is not allowed: %s", rawURL)
	}
	return application.Get().Browser.OpenURL(parsed.String())
}

// ExportConfig prompts for a destination and writes the full configuration.
// It returns the written path, or an empty string when the user cancels.
func (s *SystemService) ExportConfig() (string, error) {
	target, err := application.Get().Dialog.SaveFile().
		SetMessage("Export MQ Studio config").
		SetFilename(fmt.Sprintf("mq-studio-config-%s.json", time.Now().Format("2006-01-02"))).
		AddFilter("JSON", "*.json").
		PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	if target == "" {
		return "", nil
	}
	return s.settings.ExportAllConfigToFile(target)
}

// ImportConfig prompts for a config file and applies it. It returns the source
// path, or an empty string when the user cancels.
func (s *SystemService) ImportConfig() (string, error) {
	source, err := application.Get().Dialog.OpenFile().
		SetTitle("Import MQ Studio config").
		CanChooseFiles(true).
		CanChooseDirectories(false).
		AddFilter("JSON", "*.json").
		PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	if source == "" {
		return "", nil
	}
	info, err := os.Stat(source)
	if err != nil {
		return "", fmt.Errorf("failed to read the config file: %w", err)
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("please select a valid config file")
	}
	if info.Size() > maxImportBytes {
		return "", fmt.Errorf("config file too large (limit %d MB)", maxImportBytes/1024/1024)
	}
	if err := s.settings.ImportAllConfigFromFile(source); err != nil {
		return "", err
	}
	return source, nil
}
