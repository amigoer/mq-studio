package api

import (
	stdhttp "net/http"
	"strings"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
)

type settingsService interface {
	GetSettings() *model.AppSettings
	UpdateSettings(model.AppSettings) (*model.AppSettings, error)
	ResetSettings() (*model.AppSettings, error)
	ClearCache() error
	ExportAllConfig() (string, error)
	ImportAllConfig(string) error
}

type settingsHandler struct {
	service settingsService
}

type settingsView struct {
	model.AppSettings
	GlobalAccessKeyConfigured bool `json:"globalAccessKeyConfigured"`
	GlobalSecretKeyConfigured bool `json:"globalSecretKeyConfigured"`
}

type settingsUpdateRequest struct {
	model.AppSettings
	GlobalCredentialsMode string `json:"globalCredentialsMode"`
}

type importConfigRequest struct {
	Content string `json:"content"`
}

func redactSettings(settings *model.AppSettings) *settingsView {
	if settings == nil {
		return nil
	}
	view := *settings
	accessConfigured := strings.TrimSpace(view.GlobalAccessKey) != ""
	secretConfigured := strings.TrimSpace(view.GlobalSecretKey) != ""
	view.GlobalAccessKey = ""
	view.GlobalSecretKey = ""
	return &settingsView{AppSettings: view, GlobalAccessKeyConfigured: accessConfigured, GlobalSecretKeyConfigured: secretConfigured}
}

func (h settingsHandler) getSettings(w stdhttp.ResponseWriter, _ *stdhttp.Request) {
	writeJSON(w, stdhttp.StatusOK, redactSettings(h.service.GetSettings()))
}

func (h settingsHandler) updateSettings(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input settingsUpdateRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	current := h.service.GetSettings()
	switch input.GlobalCredentialsMode {
	case "preserve", "":
		if input.GlobalAccessKey == "" && input.GlobalSecretKey == "" {
			input.GlobalAccessKey = current.GlobalAccessKey
			input.GlobalSecretKey = current.GlobalSecretKey
		}
	case "clear":
		input.GlobalAccessKey, input.GlobalSecretKey = "", ""
	case "replace":
		if strings.TrimSpace(input.GlobalAccessKey) == "" || strings.TrimSpace(input.GlobalSecretKey) == "" {
			writeError(w, r, stdhttp.StatusBadRequest, "INVALID_REQUEST", "AccessKey and SecretKey must both be provided", nil)
			return
		}
	default:
		writeError(w, r, stdhttp.StatusBadRequest, "INVALID_REQUEST", "invalid global credentials mode", nil)
		return
	}
	settings, err := h.service.UpdateSettings(input.AppSettings)
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, redactSettings(settings))
}

func (h settingsHandler) resetSettings(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	settings, err := h.service.ResetSettings()
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, redactSettings(settings))
}

func (h settingsHandler) clearCache(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if err := h.service.ClearCache(); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}

func (h settingsHandler) exportConfig(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	content, err := h.service.ExportAllConfig()
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, map[string]string{"content": content})
}

func (h settingsHandler) importConfig(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input importConfigRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := h.service.ImportAllConfig(input.Content); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}
