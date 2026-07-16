package acl

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/httpx"
)

func (h handler) updateAccessConfig(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input updateAccessConfigRequest
	if !httpx.DecodeJSON(w, r, &input) {
		return
	}
	if err := h.service.CreateOrUpdateAccessConfig(input.AccessKey, input.SecretKey, input.WhiteRemoteAddress, input.IsAdmin, input.DefaultTopicPerm, input.DefaultGroupPerm, input.TopicPerms, input.GroupPerms); err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusNoContent, nil)
}

func (h handler) deleteAccessConfig(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if err := h.service.DeleteAccessConfig(r.URL.Query().Get("accessKey")); err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusNoContent, nil)
}

func (h handler) updateGlobalWhiteAddrs(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input updateGlobalWhiteAddrsRequest
	if !httpx.DecodeJSON(w, r, &input) {
		return
	}
	if err := h.service.UpdateGlobalWhiteAddrs(input.Addrs); err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusNoContent, nil)
}
