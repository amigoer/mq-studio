package settings

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/httpx"
)

func (h handler) exportConfig(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	content, err := h.service.ExportAllConfig()
	if err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusOK, map[string]string{"content": content})
}

func (h handler) importConfig(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input importConfigRequest
	if !httpx.DecodeJSON(w, r, &input) {
		return
	}
	if err := h.service.ImportAllConfig(input.Content); err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusNoContent, nil)
}
