package topic

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/httpx"
	"github.com/amigoer/rocket-leaf/daemon/internal/model"
)

func (h handler) getTopics(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var result []*model.TopicItem
	var err error
	if r.URL.Query().Get("scope") == "all" {
		result, err = h.service.GetAllTopics()
	} else {
		result, err = h.service.GetTopics()
	}
	if err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusOK, result)
}

func (h handler) getTopicDetail(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.GetTopicDetail(r.URL.Query().Get("topic"))
	if err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusOK, result)
}

func (h handler) getTopicStats(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.GetTopicStats(r.URL.Query().Get("topic"))
	if err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusOK, result)
}
