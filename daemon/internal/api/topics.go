package api

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
)

type topicRequest struct {
	Topic      string `json:"topic"`
	BrokerAddr string `json:"brokerAddr"`
	ReadQueue  int    `json:"readQueue"`
	WriteQueue int    `json:"writeQueue"`
	Perm       string `json:"perm"`
}

func (h *handler) registerTopicRoutes(mux *stdhttp.ServeMux) {
	mux.HandleFunc("GET /v1/topics", h.getTopics)
	mux.HandleFunc("POST /v1/topics", h.createTopic)
	mux.HandleFunc("GET /v1/topics/detail", h.getTopicDetail)
	mux.HandleFunc("GET /v1/topics/stats", h.getTopicStats)
	mux.HandleFunc("PUT /v1/topics", h.updateTopic)
	mux.HandleFunc("DELETE /v1/topics", h.deleteTopic)
}

func (h *handler) getTopics(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var result []*model.TopicItem
	var err error
	if r.URL.Query().Get("scope") == "all" {
		result, err = h.services.Topics.GetAllTopics()
	} else {
		result, err = h.services.Topics.GetTopics()
	}
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h *handler) getTopicDetail(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.Topics.GetTopicDetail(r.URL.Query().Get("topic"))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h *handler) getTopicStats(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.Topics.GetTopicStats(r.URL.Query().Get("topic"))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h *handler) createTopic(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	h.topicMutation(w, r, h.services.Topics.CreateTopic)
}

func (h *handler) updateTopic(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	h.topicMutation(w, r, h.services.Topics.UpdateTopic)
}

func (h *handler) topicMutation(w stdhttp.ResponseWriter, r *stdhttp.Request, action func(string, string, int, int, string) error) {
	var input topicRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := action(input.Topic, input.BrokerAddr, input.ReadQueue, input.WriteQueue, input.Perm); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}

func (h *handler) deleteTopic(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if err := h.services.Topics.DeleteTopic(r.URL.Query().Get("topic"), r.URL.Query().Get("clusterName")); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}
