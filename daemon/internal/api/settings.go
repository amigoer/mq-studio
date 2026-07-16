package api

import (
	stdhttp "net/http"
	"strings"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
)

type settingsView struct {
	model.AppSettings
	GlobalAccessKeyConfigured bool `json:"globalAccessKeyConfigured"`
	GlobalSecretKeyConfigured bool `json:"globalSecretKeyConfigured"`
}

type settingsUpdateRequest struct {
	model.AppSettings
	GlobalCredentialsMode string `json:"globalCredentialsMode"`
}

func (h *handler) registerSettingsRoutes(mux *stdhttp.ServeMux) {
	mux.HandleFunc("GET /v1/settings", h.getSettings)
	mux.HandleFunc("PUT /v1/settings", h.updateSettings)
	mux.HandleFunc("POST /v1/settings/reset", h.resetSettings)
	mux.HandleFunc("POST /v1/settings/clear-cache", h.clearCache)
	mux.HandleFunc("GET /v1/settings/export", h.exportConfig)
	mux.HandleFunc("POST /v1/settings/import", h.importConfig)
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

func (h *handler) getSettings(w stdhttp.ResponseWriter, _ *stdhttp.Request) {
	writeJSON(w, stdhttp.StatusOK, redactSettings(h.services.Settings.GetSettings()))
}

func (h *handler) updateSettings(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input settingsUpdateRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	current := h.services.Settings.GetSettings()
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
			writeError(w, r, stdhttp.StatusBadRequest, "INVALID_REQUEST", "AccessKey 和 SecretKey 必须同时填写", nil)
			return
		}
	default:
		writeError(w, r, stdhttp.StatusBadRequest, "INVALID_REQUEST", "全局凭证更新模式无效", nil)
		return
	}
	settings, err := h.services.Settings.UpdateSettings(input.AppSettings)
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, redactSettings(settings))
}

func (h *handler) resetSettings(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	settings, err := h.services.Settings.ResetSettings()
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, redactSettings(settings))
}

func (h *handler) clearCache(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if err := h.services.Settings.ClearCache(); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}

func (h *handler) exportConfig(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	content, err := h.services.Settings.ExportAllConfig()
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, map[string]string{"content": content})
}

func (h *handler) importConfig(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input struct {
		Content string `json:"content"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := h.services.Settings.ImportAllConfig(input.Content); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}
