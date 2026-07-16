package connection

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/httpx"
)

func (h handler) getConnections(w stdhttp.ResponseWriter, _ *stdhttp.Request) {
	httpx.WriteJSON(w, stdhttp.StatusOK, redactConnections(h.service.GetConnections()))
}
