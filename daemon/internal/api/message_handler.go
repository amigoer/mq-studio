package api

import (
	stdhttp "net/http"
	"strconv"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
)

type messageService interface {
	QueryMessages(string, string, string, int, int64, int64) ([]*model.MessageItem, error)
	QueryMessageByID(string, string) (*model.MessageItem, error)
	GetMessageTrack(string, string) ([]*model.MessageTrackItem, error)
	QueryDLQMessages(string, int) ([]*model.MessageItem, error)
	QueryRetryMessages(string, int) ([]*model.MessageItem, error)
	ResendMessage(string, string, string, string) (string, error)
	SendMessage(string, string, string, string, int) (string, error)
}

type messageHandler struct {
	service messageService
}

type resendMessageRequest struct {
	ConsumerGroup string `json:"consumerGroup"`
	ClientID      string `json:"clientId"`
	Topic         string `json:"topic"`
	MessageID     string `json:"messageId"`
}

type sendMessageRequest struct {
	Topic      string `json:"topic"`
	Tags       string `json:"tags"`
	Keys       string `json:"keys"`
	Body       string `json:"body"`
	DelayLevel int    `json:"delayLevel"`
}

func (h messageHandler) queryMessages(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.QueryMessages(r.URL.Query().Get("topic"), r.URL.Query().Get("key"), r.URL.Query().Get("tag"), queryIntOrDefault(r, "maxResults", 32), queryInt64OrZero(r, "startTime"), queryInt64OrZero(r, "endTime"))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h messageHandler) queryMessageByID(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.QueryMessageByID(r.URL.Query().Get("topic"), r.URL.Query().Get("messageId"))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h messageHandler) getMessageTrack(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.GetMessageTrack(r.URL.Query().Get("topic"), r.URL.Query().Get("messageId"))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h messageHandler) queryDLQMessages(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.QueryDLQMessages(r.URL.Query().Get("group"), queryIntOrDefault(r, "maxResults", 32))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h messageHandler) queryRetryMessages(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.QueryRetryMessages(r.URL.Query().Get("group"), queryIntOrDefault(r, "maxResults", 32))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h messageHandler) resendMessage(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input resendMessageRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := h.service.ResendMessage(input.ConsumerGroup, input.ClientID, input.Topic, input.MessageID)
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, map[string]string{"messageId": result})
}

func (h messageHandler) sendMessage(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input sendMessageRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := h.service.SendMessage(input.Topic, input.Tags, input.Keys, input.Body, input.DelayLevel)
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, map[string]string{"messageId": result})
}

func queryIntOrDefault(r *stdhttp.Request, name string, fallback int) int {
	value, err := strconv.Atoi(r.URL.Query().Get(name))
	if err != nil {
		return fallback
	}
	return value
}

func queryInt64OrZero(r *stdhttp.Request, name string) int64 {
	value, _ := strconv.ParseInt(r.URL.Query().Get(name), 10, 64)
	return value
}
