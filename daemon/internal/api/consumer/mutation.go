package consumer

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/httpx"
	"github.com/amigoer/rocket-leaf/daemon/internal/model"
)

func (h handler) createConsumer(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	h.mutate(w, r, h.service.CreateConsumerGroup)
}

func (h handler) updateConsumer(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	h.mutate(w, r, h.service.UpdateConsumerGroup)
}

func (h handler) mutate(w stdhttp.ResponseWriter, r *stdhttp.Request, action func(string, string, string, int) error) {
	var input mutationRequest
	if !httpx.DecodeJSON(w, r, &input) {
		return
	}
	if err := action(input.Group, input.BrokerAddr, input.ConsumeMode, input.MaxRetry); err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusNoContent, nil)
}

func (h handler) deleteConsumer(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if err := h.service.DeleteConsumerGroup(r.URL.Query().Get("group"), r.URL.Query().Get("brokerAddr")); err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusNoContent, nil)
}

func (h handler) resetOffset(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input model.ResetOffsetRequest
	if !httpx.DecodeJSON(w, r, &input) {
		return
	}
	if err := h.service.ResetOffset(input.Group, input.Topic, input.Timestamp, input.Force); err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusNoContent, nil)
}
