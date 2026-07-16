package message

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/routing"
)

// Routes returns the message HTTP routes backed by service.
func Routes(service Service) []routing.Route {
	h := handler{service: service}
	return []routing.Route{
		{Method: stdhttp.MethodGet, Path: "/v1/messages", OperationID: "queryMessages", Handler: h.queryMessages},
		{Method: stdhttp.MethodGet, Path: "/v1/messages/by-id", OperationID: "queryMessageById", Handler: h.queryMessageByID},
		{Method: stdhttp.MethodGet, Path: "/v1/messages/track", OperationID: "getMessageTrack", Handler: h.getMessageTrack},
		{Method: stdhttp.MethodGet, Path: "/v1/messages/dlq", OperationID: "queryDlqMessages", Handler: h.queryDLQMessages},
		{Method: stdhttp.MethodGet, Path: "/v1/messages/retry", OperationID: "queryRetryMessages", Handler: h.queryRetryMessages},
		{Method: stdhttp.MethodPost, Path: "/v1/messages/resend", OperationID: "resendMessage", Handler: h.resendMessage},
		{Method: stdhttp.MethodPost, Path: "/v1/messages/send", OperationID: "sendMessage", Handler: h.sendMessage},
	}
}
