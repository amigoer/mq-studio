package api

import stdhttp "net/http"

type route struct {
	method      string
	path        string
	operationID string
	handler     stdhttp.HandlerFunc
}

func (r route) pattern() string {
	return r.method + " " + r.path
}

func newRouter(endpoints endpointHandlers) *stdhttp.ServeMux {
	mux := stdhttp.NewServeMux()
	for _, route := range routeCatalog(endpoints) {
		mux.HandleFunc(route.pattern(), route.handler)
	}
	return mux
}

func routeCatalog(h endpointHandlers) []route {
	return []route{
		// System
		{method: stdhttp.MethodGet, path: "/v1/health", operationID: "getHealth", handler: h.system.health},
		{method: stdhttp.MethodPost, path: "/v1/shutdown", operationID: "shutdown", handler: h.system.requestShutdown},

		// Connections
		{method: stdhttp.MethodGet, path: "/v1/connections", operationID: "listConnections", handler: h.connections.getConnections},
		{method: stdhttp.MethodPost, path: "/v1/connections", operationID: "addConnection", handler: h.connections.addConnection},
		{method: stdhttp.MethodPut, path: "/v1/connections/{id}", operationID: "updateConnection", handler: h.connections.updateConnection},
		{method: stdhttp.MethodDelete, path: "/v1/connections/{id}", operationID: "deleteConnection", handler: h.connections.deleteConnection},
		{method: stdhttp.MethodPost, path: "/v1/connections/{id}/connect", operationID: "connect", handler: h.connections.connect},
		{method: stdhttp.MethodPost, path: "/v1/connections/{id}/disconnect", operationID: "disconnect", handler: h.connections.disconnect},
		{method: stdhttp.MethodPost, path: "/v1/connections/{id}/default", operationID: "setDefaultConnection", handler: h.connections.setDefaultConnection},
		{method: stdhttp.MethodPost, path: "/v1/connections/{id}/test", operationID: "testConnection", handler: h.connections.testConnection},
		{method: stdhttp.MethodPost, path: "/v1/connections/connect-default", operationID: "connectDefault", handler: h.connections.connectDefault},

		// Settings
		{method: stdhttp.MethodGet, path: "/v1/settings", operationID: "getSettings", handler: h.settings.getSettings},
		{method: stdhttp.MethodPut, path: "/v1/settings", operationID: "updateSettings", handler: h.settings.updateSettings},
		{method: stdhttp.MethodPost, path: "/v1/settings/reset", operationID: "resetSettings", handler: h.settings.resetSettings},
		{method: stdhttp.MethodPost, path: "/v1/settings/clear-cache", operationID: "clearCache", handler: h.settings.clearCache},
		{method: stdhttp.MethodGet, path: "/v1/settings/export", operationID: "exportConfig", handler: h.settings.exportConfig},
		{method: stdhttp.MethodPost, path: "/v1/settings/import", operationID: "importConfig", handler: h.settings.importConfig},

		// Cluster
		{method: stdhttp.MethodGet, path: "/v1/cluster", operationID: "getClusterInfo", handler: h.cluster.getClusterInfo},
		{method: stdhttp.MethodGet, path: "/v1/cluster/summary", operationID: "getClusterSummary", handler: h.cluster.getClusterSummary},
		{method: stdhttp.MethodGet, path: "/v1/cluster/brokers", operationID: "getBrokers", handler: h.cluster.getBrokers},
		{method: stdhttp.MethodGet, path: "/v1/cluster/brokers/detail", operationID: "getBrokerDetail", handler: h.cluster.getBrokerDetail},

		// Topics
		{method: stdhttp.MethodGet, path: "/v1/topics", operationID: "listTopics", handler: h.topics.getTopics},
		{method: stdhttp.MethodPost, path: "/v1/topics", operationID: "createTopic", handler: h.topics.createTopic},
		{method: stdhttp.MethodGet, path: "/v1/topics/detail", operationID: "getTopicDetail", handler: h.topics.getTopicDetail},
		{method: stdhttp.MethodGet, path: "/v1/topics/stats", operationID: "getTopicStats", handler: h.topics.getTopicStats},
		{method: stdhttp.MethodPut, path: "/v1/topics", operationID: "updateTopic", handler: h.topics.updateTopic},
		{method: stdhttp.MethodDelete, path: "/v1/topics", operationID: "deleteTopic", handler: h.topics.deleteTopic},

		// Consumers
		{method: stdhttp.MethodGet, path: "/v1/consumers", operationID: "listConsumers", handler: h.consumers.getConsumers},
		{method: stdhttp.MethodPost, path: "/v1/consumers", operationID: "createConsumer", handler: h.consumers.createConsumer},
		{method: stdhttp.MethodGet, path: "/v1/consumers/detail", operationID: "getConsumerDetail", handler: h.consumers.getConsumerDetail},
		{method: stdhttp.MethodGet, path: "/v1/consumers/stats", operationID: "getConsumerStats", handler: h.consumers.getConsumeStats},
		{method: stdhttp.MethodPut, path: "/v1/consumers", operationID: "updateConsumer", handler: h.consumers.updateConsumer},
		{method: stdhttp.MethodDelete, path: "/v1/consumers", operationID: "deleteConsumer", handler: h.consumers.deleteConsumer},
		{method: stdhttp.MethodPost, path: "/v1/consumers/reset-offset", operationID: "resetOffset", handler: h.consumers.resetOffset},

		// Messages
		{method: stdhttp.MethodGet, path: "/v1/messages", operationID: "queryMessages", handler: h.messages.queryMessages},
		{method: stdhttp.MethodGet, path: "/v1/messages/by-id", operationID: "queryMessageById", handler: h.messages.queryMessageByID},
		{method: stdhttp.MethodGet, path: "/v1/messages/track", operationID: "getMessageTrack", handler: h.messages.getMessageTrack},
		{method: stdhttp.MethodGet, path: "/v1/messages/dlq", operationID: "queryDlqMessages", handler: h.messages.queryDLQMessages},
		{method: stdhttp.MethodGet, path: "/v1/messages/retry", operationID: "queryRetryMessages", handler: h.messages.queryRetryMessages},
		{method: stdhttp.MethodPost, path: "/v1/messages/resend", operationID: "resendMessage", handler: h.messages.resendMessage},
		{method: stdhttp.MethodPost, path: "/v1/messages/send", operationID: "sendMessage", handler: h.messages.sendMessage},

		// ACL
		{method: stdhttp.MethodGet, path: "/v1/acl/enabled", operationID: "getAclEnabled", handler: h.acl.getACLEnabled},
		{method: stdhttp.MethodGet, path: "/v1/acl/version", operationID: "getAclVersion", handler: h.acl.getACLVersion},
		{method: stdhttp.MethodPut, path: "/v1/acl/access-config", operationID: "updateAccessConfig", handler: h.acl.updateAccessConfig},
		{method: stdhttp.MethodDelete, path: "/v1/acl/access-config", operationID: "deleteAccessConfig", handler: h.acl.deleteAccessConfig},
		{method: stdhttp.MethodPut, path: "/v1/acl/global-white-addrs", operationID: "updateGlobalWhiteAddrs", handler: h.acl.updateGlobalWhiteAddrs},
	}
}
