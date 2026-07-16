package api

import (
	stdhttp "net/http"
	"strings"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
)

type connectionView struct {
	ID                  int                    `json:"id"`
	Name                string                 `json:"name"`
	Env                 model.ConnectionEnv    `json:"env"`
	NameServer          string                 `json:"nameServer"`
	TimeoutSec          int                    `json:"timeoutSec"`
	EnableACL           bool                   `json:"enableACL"`
	AccessKey           string                 `json:"accessKey"`
	SecretKey           string                 `json:"secretKey"`
	AccessKeyConfigured bool                   `json:"accessKeyConfigured"`
	SecretKeyConfigured bool                   `json:"secretKeyConfigured"`
	Status              model.ConnectionStatus `json:"status"`
	LastCheck           string                 `json:"lastCheck"`
	IsDefault           bool                   `json:"isDefault"`
	Remark              string                 `json:"remark"`
}

type connectionRequest struct {
	Name        string `json:"name"`
	Env         string `json:"env"`
	NameServer  string `json:"nameServer"`
	TimeoutSec  int    `json:"timeoutSec"`
	EnableACL   bool   `json:"enableACL"`
	AccessKey   string `json:"accessKey"`
	SecretKey   string `json:"secretKey"`
	Remark      string `json:"remark"`
	Credentials string `json:"credentialsMode"`
}

func (h *handler) registerConnectionRoutes(mux *stdhttp.ServeMux) {
	mux.HandleFunc("GET /v1/connections", h.getConnections)
	mux.HandleFunc("POST /v1/connections", h.addConnection)
	mux.HandleFunc("PUT /v1/connections/{id}", h.updateConnection)
	mux.HandleFunc("DELETE /v1/connections/{id}", h.deleteConnection)
	mux.HandleFunc("POST /v1/connections/{id}/connect", h.connect)
	mux.HandleFunc("POST /v1/connections/{id}/disconnect", h.disconnect)
	mux.HandleFunc("POST /v1/connections/{id}/default", h.setDefaultConnection)
	mux.HandleFunc("POST /v1/connections/{id}/test", h.testConnection)
	mux.HandleFunc("POST /v1/connections/connect-default", h.connectDefault)
}

func redactConnection(conn *model.Connection) *connectionView {
	if conn == nil {
		return nil
	}
	return &connectionView{
		ID: conn.ID, Name: conn.Name, Env: conn.Env, NameServer: conn.NameServer,
		TimeoutSec: conn.TimeoutSec, EnableACL: conn.EnableACL,
		AccessKeyConfigured: strings.TrimSpace(conn.AccessKey) != "",
		SecretKeyConfigured: strings.TrimSpace(conn.SecretKey) != "",
		Status:              conn.Status, LastCheck: conn.LastCheck, IsDefault: conn.IsDefault, Remark: conn.Remark,
	}
}

func redactConnections(connections []*model.Connection) []*connectionView {
	result := make([]*connectionView, 0, len(connections))
	for _, connection := range connections {
		if view := redactConnection(connection); view != nil {
			result = append(result, view)
		}
	}
	return result
}

func (h *handler) getConnections(w stdhttp.ResponseWriter, _ *stdhttp.Request) {
	writeJSON(w, stdhttp.StatusOK, redactConnections(h.services.Connections.GetConnections()))
}

func (h *handler) addConnection(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input connectionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	connection, err := h.services.Connections.AddConnection(input.Name, input.Env, input.NameServer, input.TimeoutSec, input.EnableACL, input.AccessKey, input.SecretKey, input.Remark)
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusCreated, redactConnection(connection))
}

func (h *handler) updateConnection(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	id, ok := intPath(w, r)
	if !ok {
		return
	}
	var input connectionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	current, err := h.services.Connections.GetConnection(id)
	if err != nil {
		serviceError(w, r, err)
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
		writeError(w, r, stdhttp.StatusBadRequest, "INVALID_REQUEST", "invalid credentials mode", nil)
		return
	}
	connection, err := h.services.Connections.UpdateConnection(id, input.Name, input.Env, input.NameServer, input.TimeoutSec, input.EnableACL, accessKey, secretKey, input.Remark)
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, redactConnection(connection))
}

func (h *handler) deleteConnection(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	id, ok := intPath(w, r)
	if !ok {
		return
	}
	if err := h.services.Connections.DeleteConnection(id); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}

func (h *handler) connectionAction(w stdhttp.ResponseWriter, r *stdhttp.Request, action func(int) error) {
	id, ok := intPath(w, r)
	if !ok {
		return
	}
	if err := action(id); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}

func (h *handler) connect(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	h.connectionAction(w, r, h.services.Connections.Connect)
}

func (h *handler) disconnect(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	h.connectionAction(w, r, h.services.Connections.Disconnect)
}

func (h *handler) setDefaultConnection(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	h.connectionAction(w, r, h.services.Connections.SetDefaultConnection)
}

func (h *handler) connectDefault(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if err := h.services.Connections.ConnectDefault(); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}

func (h *handler) testConnection(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	id, ok := intPath(w, r)
	if !ok {
		return
	}
	status, err := h.services.Connections.TestConnection(id)
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, map[string]string{"status": status})
}
