package connection

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/routing"
)

// Routes returns the connection HTTP route definitions.
func Routes(service Service) []routing.Route {
	h := newHandler(service)
	return []routing.Route{
		{Method: stdhttp.MethodGet, Path: "/v1/connections", OperationID: "listConnections", Handler: h.getConnections},
		{Method: stdhttp.MethodPost, Path: "/v1/connections", OperationID: "addConnection", Handler: h.addConnection},
		{Method: stdhttp.MethodPut, Path: "/v1/connections/{id}", OperationID: "updateConnection", Handler: h.updateConnection},
		{Method: stdhttp.MethodDelete, Path: "/v1/connections/{id}", OperationID: "deleteConnection", Handler: h.deleteConnection},
		{Method: stdhttp.MethodPost, Path: "/v1/connections/{id}/connect", OperationID: "connect", Handler: h.connect},
		{Method: stdhttp.MethodPost, Path: "/v1/connections/{id}/disconnect", OperationID: "disconnect", Handler: h.disconnect},
		{Method: stdhttp.MethodPost, Path: "/v1/connections/{id}/default", OperationID: "setDefaultConnection", Handler: h.setDefaultConnection},
		{Method: stdhttp.MethodPost, Path: "/v1/connections/{id}/test", OperationID: "testConnection", Handler: h.testConnection},
		{Method: stdhttp.MethodPost, Path: "/v1/connections/connect-default", OperationID: "connectDefault", Handler: h.connectDefault},
	}
}
