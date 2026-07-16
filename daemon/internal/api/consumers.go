package api

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
)

type consumerRequest struct {
	Group       string `json:"group"`
	BrokerAddr  string `json:"brokerAddr"`
	ConsumeMode string `json:"consumeMode"`
	MaxRetry    int    `json:"maxRetry"`
}

func (h *handler) registerConsumerRoutes(mux *stdhttp.ServeMux) {
	mux.HandleFunc("GET /v1/consumers", h.getConsumers)
	mux.HandleFunc("POST /v1/consumers", h.createConsumer)
	mux.HandleFunc("GET /v1/consumers/detail", h.getConsumerDetail)
	mux.HandleFunc("GET /v1/consumers/stats", h.getConsumeStats)
	mux.HandleFunc("PUT /v1/consumers", h.updateConsumer)
	mux.HandleFunc("DELETE /v1/consumers", h.deleteConsumer)
	mux.HandleFunc("POST /v1/consumers/reset-offset", h.resetOffset)
}

func (h *handler) getConsumers(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.Consumers.GetConsumerGroups()
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h *handler) getConsumerDetail(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.Consumers.GetConsumerGroupDetail(r.URL.Query().Get("group"))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h *handler) getConsumeStats(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.Consumers.GetConsumeStats(r.URL.Query().Get("group"))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h *handler) createConsumer(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	h.consumerMutation(w, r, h.services.Consumers.CreateConsumerGroup)
}

func (h *handler) updateConsumer(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	h.consumerMutation(w, r, h.services.Consumers.UpdateConsumerGroup)
}

func (h *handler) consumerMutation(w stdhttp.ResponseWriter, r *stdhttp.Request, action func(string, string, string, int) error) {
	var input consumerRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := action(input.Group, input.BrokerAddr, input.ConsumeMode, input.MaxRetry); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}

func (h *handler) deleteConsumer(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if err := h.services.Consumers.DeleteConsumerGroup(r.URL.Query().Get("group"), r.URL.Query().Get("brokerAddr")); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}

func (h *handler) resetOffset(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input model.ResetOffsetRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := h.services.Consumers.ResetOffset(input.Group, input.Topic, input.Timestamp, input.Force); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}
