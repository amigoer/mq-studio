package topic

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/httpx"
)

func (h handler) createTopic(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	h.mutate(w, r, h.service.CreateTopic)
}

func (h handler) updateTopic(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	h.mutate(w, r, h.service.UpdateTopic)
}

func (h handler) mutate(w stdhttp.ResponseWriter, r *stdhttp.Request, action func(string, string, int, int, string) error) {
	var input mutationRequest
	if !httpx.DecodeJSON(w, r, &input) {
		return
	}
	if err := action(input.Topic, input.BrokerAddr, input.ReadQueue, input.WriteQueue, input.Perm); err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusNoContent, nil)
}

func (h handler) deleteTopic(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if err := h.service.DeleteTopic(r.URL.Query().Get("topic"), r.URL.Query().Get("clusterName")); err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusNoContent, nil)
}
