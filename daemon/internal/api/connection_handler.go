package api

import (
	stdhttp "net/http"
	"strconv"
	"strings"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
)

type connectionService interface {
	GetConnections() []*model.Connection
	GetConnection(int) (*model.Connection, error)
	AddConnection(string, string, string, int, bool, string, string, string) (*model.Connection, error)
	UpdateConnection(int, string, string, string, int, bool, string, string, string) (*model.Connection, error)
	DeleteConnection(int) error
	Connect(int) error
	Disconnect(int) error
	SetDefaultConnection(int) error
	ConnectDefault() error
	TestConnection(int) (string, error)
}

type connectionHandler struct {
	service connectionService
}

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

func (h connectionHandler) getConnections(w stdhttp.ResponseWriter, _ *stdhttp.Request) {
	writeJSON(w, stdhttp.StatusOK, redactConnections(h.service.GetConnections()))
}

func (h connectionHandler) addConnection(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input connectionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	connection, err := h.service.AddConnection(input.Name, input.Env, input.NameServer, input.TimeoutSec, input.EnableACL, input.AccessKey, input.SecretKey, input.Remark)
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusCreated, redactConnection(connection))
}

func (h connectionHandler) updateConnection(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	id, ok := parseConnectionID(w, r)
	if !ok {
		return
	}
	var input connectionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	current, err := h.service.GetConnection(id)
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
	connection, err := h.service.UpdateConnection(id, input.Name, input.Env, input.NameServer, input.TimeoutSec, input.EnableACL, accessKey, secretKey, input.Remark)
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, redactConnection(connection))
}

func (h connectionHandler) deleteConnection(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	id, ok := parseConnectionID(w, r)
	if !ok {
		return
	}
	if err := h.service.DeleteConnection(id); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}

func (h connectionHandler) connectionAction(w stdhttp.ResponseWriter, r *stdhttp.Request, action func(int) error) {
	id, ok := parseConnectionID(w, r)
	if !ok {
		return
	}
	if err := action(id); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}

func (h connectionHandler) connect(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	h.connectionAction(w, r, h.service.Connect)
}

func (h connectionHandler) disconnect(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	h.connectionAction(w, r, h.service.Disconnect)
}

func (h connectionHandler) setDefaultConnection(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	h.connectionAction(w, r, h.service.SetDefaultConnection)
}

func (h connectionHandler) connectDefault(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if err := h.service.ConnectDefault(); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}

func (h connectionHandler) testConnection(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	id, ok := parseConnectionID(w, r)
	if !ok {
		return
	}
	status, err := h.service.TestConnection(id)
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, map[string]string{"status": status})
}

func parseConnectionID(w stdhttp.ResponseWriter, r *stdhttp.Request) (int, bool) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		writeError(w, r, stdhttp.StatusBadRequest, "INVALID_REQUEST", "invalid connection id", nil)
		return 0, false
	}
	return id, true
}
