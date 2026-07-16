package topic

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/routing"
)

// Routes returns the topic HTTP route definitions.
func Routes(service Service) []routing.Route {
	h := newHandler(service)
	return []routing.Route{
		{Method: stdhttp.MethodGet, Path: "/v1/topics", OperationID: "listTopics", Handler: h.getTopics},
		{Method: stdhttp.MethodPost, Path: "/v1/topics", OperationID: "createTopic", Handler: h.createTopic},
		{Method: stdhttp.MethodGet, Path: "/v1/topics/detail", OperationID: "getTopicDetail", Handler: h.getTopicDetail},
		{Method: stdhttp.MethodGet, Path: "/v1/topics/stats", OperationID: "getTopicStats", Handler: h.getTopicStats},
		{Method: stdhttp.MethodPut, Path: "/v1/topics", OperationID: "updateTopic", Handler: h.updateTopic},
		{Method: stdhttp.MethodDelete, Path: "/v1/topics", OperationID: "deleteTopic", Handler: h.deleteTopic},
	}
}
