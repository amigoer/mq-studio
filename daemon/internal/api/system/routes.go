package system

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/routing"
)

// Routes returns the system HTTP routes.
func Routes(shutdown func()) []routing.Route {
	h := handler{shutdown: shutdown}
	return []routing.Route{
		{Method: stdhttp.MethodGet, Path: "/v1/health", OperationID: "getHealth", Handler: h.health},
		{Method: stdhttp.MethodPost, Path: "/v1/shutdown", OperationID: "shutdown", Handler: h.requestShutdown},
	}
}
