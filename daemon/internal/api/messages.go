package api

import stdhttp "net/http"

func (h *handler) registerMessageRoutes(mux *stdhttp.ServeMux) {
	mux.HandleFunc("GET /v1/messages", h.queryMessages)
	mux.HandleFunc("GET /v1/messages/by-id", h.queryMessageByID)
	mux.HandleFunc("GET /v1/messages/track", h.getMessageTrack)
	mux.HandleFunc("GET /v1/messages/dlq", h.queryDLQMessages)
	mux.HandleFunc("GET /v1/messages/retry", h.queryRetryMessages)
	mux.HandleFunc("POST /v1/messages/resend", h.resendMessage)
	mux.HandleFunc("POST /v1/messages/send", h.sendMessage)
}

func (h *handler) queryMessages(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.Messages.QueryMessages(r.URL.Query().Get("topic"), r.URL.Query().Get("key"), r.URL.Query().Get("tag"), queryInt(r, "maxResults", 32), queryInt64(r, "startTime"), queryInt64(r, "endTime"))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h *handler) queryMessageByID(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.Messages.QueryMessageByID(r.URL.Query().Get("topic"), r.URL.Query().Get("messageId"))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h *handler) getMessageTrack(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.Messages.GetMessageTrack(r.URL.Query().Get("topic"), r.URL.Query().Get("messageId"))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h *handler) queryDLQMessages(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.Messages.QueryDLQMessages(r.URL.Query().Get("group"), queryInt(r, "maxResults", 32))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h *handler) queryRetryMessages(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.services.Messages.QueryRetryMessages(r.URL.Query().Get("group"), queryInt(r, "maxResults", 32))
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, result)
}

func (h *handler) resendMessage(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input struct {
		ConsumerGroup string `json:"consumerGroup"`
		ClientID      string `json:"clientId"`
		Topic         string `json:"topic"`
		MessageID     string `json:"messageId"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := h.services.Messages.ResendMessage(input.ConsumerGroup, input.ClientID, input.Topic, input.MessageID)
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, map[string]string{"messageId": result})
}

func (h *handler) sendMessage(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	var input struct {
		Topic      string `json:"topic"`
		Tags       string `json:"tags"`
		Keys       string `json:"keys"`
		Body       string `json:"body"`
		DelayLevel int    `json:"delayLevel"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := h.services.Messages.SendMessage(input.Topic, input.Tags, input.Keys, input.Body, input.DelayLevel)
	if err != nil {
		serviceError(w, r, err)
		return
	}
	writeJSON(w, stdhttp.StatusOK, map[string]string{"messageId": result})
}
