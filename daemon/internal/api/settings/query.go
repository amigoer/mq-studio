package settings

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/httpx"
)

func (h handler) getSettings(w stdhttp.ResponseWriter, _ *stdhttp.Request) {
	httpx.WriteJSON(w, stdhttp.StatusOK, redactSettings(h.service.GetSettings()))
}
