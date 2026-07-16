package settings

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/httpx"
)

func (h handler) clearCache(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if err := h.service.ClearCache(); err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusNoContent, nil)
}
