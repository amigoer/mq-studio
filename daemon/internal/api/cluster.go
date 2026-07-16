package api

import stdhttp "net/http"

func (h *handler) registerClusterRoutes(mux *stdhttp.ServeMux) {
	mux.HandleFunc("GET /v1/cluster", h.getClusterInfo)
	mux.HandleFunc("GET /v1/cluster/summary", h.getClusterSummary)
	mux.HandleFunc("GET /v1/cluster/brokers", h.getBrokers)
	mux.HandleFunc("GET /v1/cluster/brokers/detail", h.getBrokerDetail)
}

func (h *handler) getClusterInfo(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.Cluster.GetClusterInfo()
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h *handler) getClusterSummary(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.Cluster.GetClusterSummary()
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h *handler) getBrokers(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.Cluster.GetBrokers()
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h *handler) getBrokerDetail(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.Cluster.GetBrokerDetail(r.URL.Query().Get("brokerAddr"))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}
