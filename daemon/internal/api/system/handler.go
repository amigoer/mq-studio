// Package system implements process health and shutdown HTTP endpoints.
package system

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/httpx"
)

type handler struct {
	shutdown func()
}

func (h handler) health(w stdhttp.ResponseWriter, _ *stdhttp.Request) {
	httpx.WriteJSON(w, stdhttp.StatusOK, map[string]any{"status": "ok", "protocolVersion": 1})
}

func (h handler) requestShutdown(w stdhttp.ResponseWriter, _ *stdhttp.Request) {
	httpx.WriteJSON(w, stdhttp.StatusAccepted, map[string]bool{"accepted": true})
	go h.shutdown()
}
