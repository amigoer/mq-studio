package settings

import (
	stdhttp "net/http"
	"strings"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/httpx"
)

func (h handler) updateSettings(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input settingsUpdateRequest
	if !httpx.DecodeJSON(w, r, &input) {
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
			httpx.WriteError(w, r, stdhttp.StatusBadRequest, "INVALID_REQUEST", "AccessKey and SecretKey must both be provided", nil)
			return
		}
	default:
		httpx.WriteError(w, r, stdhttp.StatusBadRequest, "INVALID_REQUEST", "invalid global credentials mode", nil)
		return
	}
	updated, err := h.service.UpdateSettings(input.AppSettings)
	if err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusOK, redactSettings(updated))
}

func (h handler) resetSettings(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	reset, err := h.service.ResetSettings()
	if err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusOK, redactSettings(reset))
}
