package connection

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/httpx"
)

func (h handler) connectionAction(w stdhttp.ResponseWriter, r *stdhttp.Request, action func(int) error) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	if err := action(id); err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusNoContent, nil)
}

func (h handler) connect(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	h.connectionAction(w, r, h.service.Connect)
}

func (h handler) disconnect(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	h.connectionAction(w, r, h.service.Disconnect)
}

func (h handler) setDefaultConnection(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	h.connectionAction(w, r, h.service.SetDefaultConnection)
}

func (h handler) connectDefault(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if err := h.service.ConnectDefault(); err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusNoContent, nil)
}

func (h handler) testConnection(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	id, ok := parseID(w, r)
	if !ok {
		return
	}
	status, err := h.service.TestConnection(id)
	if err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusOK, map[string]string{"status": status})
}
