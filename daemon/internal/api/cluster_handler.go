package api

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
)

type clusterService interface {
	GetClusterInfo() (*model.ClusterInfo, error)
	GetClusterSummary() (*model.ClusterSummary, error)
	GetBrokers() ([]*model.BrokerNode, error)
	GetBrokerDetail(string) (*model.BrokerNode, error)
}

type clusterHandler struct {
	service clusterService
}

func (h clusterHandler) getClusterInfo(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.GetClusterInfo()
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h clusterHandler) getClusterSummary(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.GetClusterSummary()
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h clusterHandler) getBrokers(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.GetBrokers()
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h clusterHandler) getBrokerDetail(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.GetBrokerDetail(r.URL.Query().Get("brokerAddr"))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}
