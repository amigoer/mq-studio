package consumer

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/httpx"
)

func (h handler) getConsumers(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.GetConsumerGroups()
	if err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusOK, result)
}

func (h handler) getConsumerDetail(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.GetConsumerGroupDetail(r.URL.Query().Get("group"))
	if err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusOK, result)
}

func (h handler) getConsumeStats(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.GetConsumeStats(r.URL.Query().Get("group"))
	if err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusOK, result)
}
