package consumer

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/routing"
)

// Routes returns the consumer HTTP route definitions.
func Routes(service Service) []routing.Route {
	h := newHandler(service)
	return []routing.Route{
		{Method: stdhttp.MethodGet, Path: "/v1/consumers", OperationID: "listConsumers", Handler: h.getConsumers},
		{Method: stdhttp.MethodPost, Path: "/v1/consumers", OperationID: "createConsumer", Handler: h.createConsumer},
		{Method: stdhttp.MethodGet, Path: "/v1/consumers/detail", OperationID: "getConsumerDetail", Handler: h.getConsumerDetail},
		{Method: stdhttp.MethodGet, Path: "/v1/consumers/stats", OperationID: "getConsumerStats", Handler: h.getConsumeStats},
		{Method: stdhttp.MethodPut, Path: "/v1/consumers", OperationID: "updateConsumer", Handler: h.updateConsumer},
		{Method: stdhttp.MethodDelete, Path: "/v1/consumers", OperationID: "deleteConsumer", Handler: h.deleteConsumer},
		{Method: stdhttp.MethodPost, Path: "/v1/consumers/reset-offset", OperationID: "resetOffset", Handler: h.resetOffset},
	}
}
