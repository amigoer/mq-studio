package settings

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/routing"
)

// Routes returns the settings HTTP route definitions.
func Routes(service Service) []routing.Route {
	h := newHandler(service)
	return []routing.Route{
		{Method: stdhttp.MethodGet, Path: "/v1/settings", OperationID: "getSettings", Handler: h.getSettings},
		{Method: stdhttp.MethodPut, Path: "/v1/settings", OperationID: "updateSettings", Handler: h.updateSettings},
		{Method: stdhttp.MethodPost, Path: "/v1/settings/reset", OperationID: "resetSettings", Handler: h.resetSettings},
		{Method: stdhttp.MethodPost, Path: "/v1/settings/clear-cache", OperationID: "clearCache", Handler: h.clearCache},
		{Method: stdhttp.MethodGet, Path: "/v1/settings/export", OperationID: "exportConfig", Handler: h.exportConfig},
		{Method: stdhttp.MethodPost, Path: "/v1/settings/import", OperationID: "importConfig", Handler: h.importConfig},
	}
}
