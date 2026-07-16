package cluster

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/routing"
)

// Routes returns the cluster HTTP route definitions.
func Routes(service Service) []routing.Route {
	h := newHandler(service)
	return []routing.Route{
		{Method: stdhttp.MethodGet, Path: "/v1/cluster", OperationID: "getClusterInfo", Handler: h.getClusterInfo},
		{Method: stdhttp.MethodGet, Path: "/v1/cluster/summary", OperationID: "getClusterSummary", Handler: h.getClusterSummary},
		{Method: stdhttp.MethodGet, Path: "/v1/cluster/brokers", OperationID: "getBrokers", Handler: h.getBrokers},
		{Method: stdhttp.MethodGet, Path: "/v1/cluster/brokers/detail", OperationID: "getBrokerDetail", Handler: h.getBrokerDetail},
	}
}
