package message

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/httpx"
)

func (h handler) resendMessage(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input resendMessageRequest
	if !httpx.DecodeJSON(w, r, &input) {
		return
	}
	result, err := h.service.ResendMessage(input.ConsumerGroup, input.ClientID, input.Topic, input.MessageID)
	if err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusOK, map[string]string{"messageId": result})
}

func (h handler) sendMessage(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input sendMessageRequest
	if !httpx.DecodeJSON(w, r, &input) {
		return
	}
	result, err := h.service.SendMessage(input.Topic, input.Tags, input.Keys, input.Body, input.DelayLevel)
	if err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusOK, map[string]string{"messageId": result})
}
