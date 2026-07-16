package cluster

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/httpx"
)

func (h handler) getClusterInfo(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.GetClusterInfo()
	if err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusOK, result)
}

func (h handler) getClusterSummary(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.GetClusterSummary()
	if err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusOK, result)
}

func (h handler) getBrokers(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.GetBrokers()
	if err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusOK, result)
}

func (h handler) getBrokerDetail(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.GetBrokerDetail(r.URL.Query().Get("brokerAddr"))
	if err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusOK, result)
}
