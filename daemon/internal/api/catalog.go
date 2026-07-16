package api

import (
	"github.com/amigoer/rocket-leaf/daemon/internal/api/acl"
	"github.com/amigoer/rocket-leaf/daemon/internal/api/cluster"
	"github.com/amigoer/rocket-leaf/daemon/internal/api/connection"
	"github.com/amigoer/rocket-leaf/daemon/internal/api/consumer"
	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/routing"
	"github.com/amigoer/rocket-leaf/daemon/internal/api/message"
	"github.com/amigoer/rocket-leaf/daemon/internal/api/settings"
	"github.com/amigoer/rocket-leaf/daemon/internal/api/system"
	"github.com/amigoer/rocket-leaf/daemon/internal/api/topic"
)

func catalog(dependencies Dependencies, shutdown func()) []routing.Route {
	groups := [][]routing.Route{
		system.Routes(shutdown),
		connection.Routes(dependencies.Connections),
		settings.Routes(dependencies.Settings),
		cluster.Routes(dependencies.Cluster),
		topic.Routes(dependencies.Topics),
		consumer.Routes(dependencies.Consumers),
		message.Routes(dependencies.Messages),
		acl.Routes(dependencies.ACL),
	}

	routes := make([]routing.Route, 0, 46)
	for _, group := range groups {
		routes = append(routes, group...)
	}
	return routes
}
