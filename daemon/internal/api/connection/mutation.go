package connection

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/httpx"
)

func (h handler) addConnection(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input connectionRequest
	if !httpx.DecodeJSON(w, r, &input) {
		return
	}
	connection, err := h.service.AddConnection(input.Name, input.Env, input.NameServer, input.TimeoutSec, input.EnableACL, input.AccessKey, input.SecretKey, input.Remark)
	if err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusCreated, redactConnection(connection))
}

func (h handler) updateConnection(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	var input connectionRequest
	if !httpx.DecodeJSON(w, r, &input) {
		return
	}
	current, err := h.service.GetConnection(id)
	if err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	accessKey, secretKey := input.AccessKey, input.SecretKey
	switch input.Credentials {
	case "preserve", "":
		if input.EnableACL && accessKey == "" && secretKey == "" {
			accessKey, secretKey = current.AccessKey, current.SecretKey
		}
	case "clear":
		input.EnableACL, accessKey, secretKey = false, "", ""
	case "replace":
	default:
		httpx.WriteError(w, r, stdhttp.StatusBadRequest, "INVALID_REQUEST", "invalid credentials mode", nil)
		return
	}
	connection, err := h.service.UpdateConnection(id, input.Name, input.Env, input.NameServer, input.TimeoutSec, input.EnableACL, accessKey, secretKey, input.Remark)
	if err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusOK, redactConnection(connection))
}

func (h handler) deleteConnection(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	if err := h.service.DeleteConnection(id); err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusNoContent, nil)
}
