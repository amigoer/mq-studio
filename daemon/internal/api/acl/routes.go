package acl

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/routing"
)

// Routes returns the ACL HTTP routes backed by service.
func Routes(service Service) []routing.Route {
	h := handler{service: service}
	return []routing.Route{
		{Method: stdhttp.MethodGet, Path: "/v1/acl/enabled", OperationID: "getAclEnabled", Handler: h.getACLEnabled},
		{Method: stdhttp.MethodGet, Path: "/v1/acl/version", OperationID: "getAclVersion", Handler: h.getACLVersion},
		{Method: stdhttp.MethodPut, Path: "/v1/acl/access-config", OperationID: "updateAccessConfig", Handler: h.updateAccessConfig},
		{Method: stdhttp.MethodDelete, Path: "/v1/acl/access-config", OperationID: "deleteAccessConfig", Handler: h.deleteAccessConfig},
		{Method: stdhttp.MethodPut, Path: "/v1/acl/global-white-addrs", OperationID: "updateGlobalWhiteAddrs", Handler: h.updateGlobalWhiteAddrs},
	}
}
