package api

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
)

type aclService interface {
	GetAclEnabled() (bool, error)
	GetAclVersion() (*model.AclVersionInfo, error)
	CreateOrUpdateAccessConfig(string, string, string, bool, string, string, []string, []string) error
	DeleteAccessConfig(string) error
	UpdateGlobalWhiteAddrs([]string) error
}

type aclHandler struct {
	service aclService
}

type updateAccessConfigRequest struct {
	AccessKey          string   `json:"accessKey"`
	SecretKey          string   `json:"secretKey"`
	WhiteRemoteAddress string   `json:"whiteRemoteAddress"`
	IsAdmin            bool     `json:"isAdmin"`
	DefaultTopicPerm   string   `json:"defaultTopicPerm"`
	DefaultGroupPerm   string   `json:"defaultGroupPerm"`
	TopicPerms         []string `json:"topicPerms"`
	GroupPerms         []string `json:"groupPerms"`
}

type updateGlobalWhiteAddrsRequest struct {
	Addrs []string `json:"addrs"`
}

func (h aclHandler) getACLEnabled(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.GetAclEnabled()
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, map[string]bool{"enabled": result})
}

func (h aclHandler) getACLVersion(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.GetAclVersion()
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h aclHandler) updateAccessConfig(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input updateAccessConfigRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := h.service.CreateOrUpdateAccessConfig(input.AccessKey, input.SecretKey, input.WhiteRemoteAddress, input.IsAdmin, input.DefaultTopicPerm, input.DefaultGroupPerm, input.TopicPerms, input.GroupPerms); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}

func (h aclHandler) deleteAccessConfig(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if err := h.service.DeleteAccessConfig(r.URL.Query().Get("accessKey")); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}

func (h aclHandler) updateGlobalWhiteAddrs(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input updateGlobalWhiteAddrsRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := h.service.UpdateGlobalWhiteAddrs(input.Addrs); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}
