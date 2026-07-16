// Package api provides a private loopback HTTP API for the Electron main process only.
package api

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/app"
)

type endpointHandlers struct {
	system      systemHandler
	connections connectionHandler
	settings    settingsHandler
	cluster     clusterHandler
	topics      topicHandler
	consumers   consumerHandler
	messages    messageHandler
	acl         aclHandler
}

// NewHandler assembles the private API router and its middleware chain.
func NewHandler(services *app.Services, token string, shutdown func()) stdhttp.Handler {
	endpoints := newEndpointHandlers(services, shutdown)
	return recoverPanic(authenticate(token, newRouter(endpoints)))
}

func newEndpointHandlers(services *app.Services, shutdown func()) endpointHandlers {
	endpoints := endpointHandlers{system: systemHandler{shutdown: shutdown}}
	if services == nil {
		return endpoints
	}

	endpoints.connections.service = services.Connections
	endpoints.settings.service = services.Settings
	endpoints.cluster.service = services.Cluster
	endpoints.topics.service = services.Topics
	endpoints.consumers.service = services.Consumers
	endpoints.messages.service = services.Messages
	endpoints.acl.service = services.ACL
	return endpoints
}
