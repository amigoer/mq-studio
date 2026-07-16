package acl

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/httpx"
)

func (h handler) getACLEnabled(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.GetAclEnabled()
	if err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusOK, map[string]bool{"enabled": result})
}

func (h handler) getACLVersion(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.GetAclVersion()
	if err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusOK, result)
}
