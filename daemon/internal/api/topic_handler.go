package api

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
)

type topicService interface {
	GetTopics() ([]*model.TopicItem, error)
	GetAllTopics() ([]*model.TopicItem, error)
	GetTopicDetail(string) (*model.TopicItem, error)
	GetTopicStats(string) (map[string]interface{}, error)
	CreateTopic(string, string, int, int, string) error
	UpdateTopic(string, string, int, int, string) error
	DeleteTopic(string, string) error
}

type topicHandler struct {
	service topicService
}

type topicRequest struct {
	Topic      string `json:"topic"`
	BrokerAddr string `json:"brokerAddr"`
	ReadQueue  int    `json:"readQueue"`
	WriteQueue int    `json:"writeQueue"`
	Perm       string `json:"perm"`
}

func (h topicHandler) getTopics(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var result []*model.TopicItem
	var err error
	if r.URL.Query().Get("scope") == "all" {
		result, err = h.service.GetAllTopics()
	} else {
		result, err = h.service.GetTopics()
	}
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h topicHandler) getTopicDetail(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.GetTopicDetail(r.URL.Query().Get("topic"))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h topicHandler) getTopicStats(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.GetTopicStats(r.URL.Query().Get("topic"))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h topicHandler) createTopic(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	h.topicMutation(w, r, h.service.CreateTopic)
}

func (h topicHandler) updateTopic(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	h.topicMutation(w, r, h.service.UpdateTopic)
}

func (h topicHandler) topicMutation(w stdhttp.ResponseWriter, r *stdhttp.Request, action func(string, string, int, int, string) error) {
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

func (h topicHandler) deleteTopic(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if err := h.service.DeleteTopic(r.URL.Query().Get("topic"), r.URL.Query().Get("clusterName")); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}
