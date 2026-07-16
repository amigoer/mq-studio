package api

import stdhttp "net/http"

func (h *handler) registerACLRoutes(mux *stdhttp.ServeMux) {
	mux.HandleFunc("GET /v1/acl/enabled", h.getACLEnabled)
	mux.HandleFunc("GET /v1/acl/version", h.getACLVersion)
	mux.HandleFunc("PUT /v1/acl/access-config", h.updateAccessConfig)
	mux.HandleFunc("DELETE /v1/acl/access-config", h.deleteAccessConfig)
	mux.HandleFunc("PUT /v1/acl/global-white-addrs", h.updateGlobalWhiteAddrs)
}

func (h *handler) getACLEnabled(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.ACL.GetAclEnabled()
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, map[string]bool{"enabled": result})
}

func (h *handler) getACLVersion(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.ACL.GetAclVersion()
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h *handler) updateAccessConfig(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input struct {
		AccessKey          string   `json:"accessKey"`
		SecretKey          string   `json:"secretKey"`
		WhiteRemoteAddress string   `json:"whiteRemoteAddress"`
		IsAdmin            bool     `json:"isAdmin"`
		DefaultTopicPerm   string   `json:"defaultTopicPerm"`
		DefaultGroupPerm   string   `json:"defaultGroupPerm"`
		TopicPerms         []string `json:"topicPerms"`
		GroupPerms         []string `json:"groupPerms"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := h.services.ACL.CreateOrUpdateAccessConfig(input.AccessKey, input.SecretKey, input.WhiteRemoteAddress, input.IsAdmin, input.DefaultTopicPerm, input.DefaultGroupPerm, input.TopicPerms, input.GroupPerms); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}

func (h *handler) deleteAccessConfig(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if err := h.services.ACL.DeleteAccessConfig(r.URL.Query().Get("accessKey")); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}

func (h *handler) updateGlobalWhiteAddrs(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input struct {
		Addrs []string `json:"addrs"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := h.services.ACL.UpdateGlobalWhiteAddrs(input.Addrs); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}
