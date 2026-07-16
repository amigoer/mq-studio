package message

import (
	stdhttp "net/http"
	"strconv"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/httpx"
)

func (h handler) queryMessages(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.QueryMessages(r.URL.Query().Get("topic"), r.URL.Query().Get("key"), r.URL.Query().Get("tag"), queryIntOrDefault(r, "maxResults", 32), queryInt64OrZero(r, "startTime"), queryInt64OrZero(r, "endTime"))
	if err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusOK, result)
}

func (h handler) queryMessageByID(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.QueryMessageByID(r.URL.Query().Get("topic"), r.URL.Query().Get("messageId"))
	if err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusOK, result)
}

func (h handler) getMessageTrack(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.GetMessageTrack(r.URL.Query().Get("topic"), r.URL.Query().Get("messageId"))
	if err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusOK, result)
}

func (h handler) queryDLQMessages(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.QueryDLQMessages(r.URL.Query().Get("group"), queryIntOrDefault(r, "maxResults", 32))
	if err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusOK, result)
}

func (h handler) queryRetryMessages(w stdhttp.ResponseWriter, r *stdhttp.Request) {
	result, err := h.service.QueryRetryMessages(r.URL.Query().Get("group"), queryIntOrDefault(r, "maxResults", 32))
	if err != nil {
		httpx.ServiceError(w, r, err)
		return
	}
	httpx.WriteJSON(w, stdhttp.StatusOK, result)
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
