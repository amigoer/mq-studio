package api

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
)

type consumerService interface {
	GetConsumerGroups() ([]*model.ConsumerGroupItem, error)
	GetConsumerGroupDetail(string) (*model.ConsumerGroupItem, error)
	GetConsumeStats(string) (map[string]interface{}, error)
	CreateConsumerGroup(string, string, string, int) error
	UpdateConsumerGroup(string, string, string, int) error
	DeleteConsumerGroup(string, string) error
	ResetOffset(string, string, int64, bool) error
}

type consumerHandler struct {
	service consumerService
}

type consumerRequest struct {
	Group       string `json:"group"`
	BrokerAddr  string `json:"brokerAddr"`
	ConsumeMode string `json:"consumeMode"`
	MaxRetry    int    `json:"maxRetry"`
}

func (h consumerHandler) getConsumers(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.GetConsumerGroups()
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h consumerHandler) getConsumerDetail(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.GetConsumerGroupDetail(r.URL.Query().Get("group"))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h consumerHandler) getConsumeStats(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.GetConsumeStats(r.URL.Query().Get("group"))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h consumerHandler) createConsumer(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	h.consumerMutation(w, r, h.service.CreateConsumerGroup)
}

func (h consumerHandler) updateConsumer(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	h.consumerMutation(w, r, h.service.UpdateConsumerGroup)
}

func (h consumerHandler) consumerMutation(w stdhttp.ResponseWriter, r *stdhttp.Request, action func(string, string, string, int) error) {
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

func (h consumerHandler) deleteConsumer(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	if err := h.service.DeleteConsumerGroup(r.URL.Query().Get("group"), r.URL.Query().Get("brokerAddr")); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}

func (h consumerHandler) resetOffset(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input model.ResetOffsetRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if err := h.service.ResetOffset(input.Group, input.Topic, input.Timestamp, input.Force); err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusNoContent, nil)
}
