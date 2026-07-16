package api

import (
	"github.com/amigoer/rocket-leaf/daemon/internal/api/acl"
	"github.com/amigoer/rocket-leaf/daemon/internal/api/cluster"
	"github.com/amigoer/rocket-leaf/daemon/internal/api/connection"
	"github.com/amigoer/rocket-leaf/daemon/internal/api/consumer"
	"github.com/amigoer/rocket-leaf/daemon/internal/api/message"
	"github.com/amigoer/rocket-leaf/daemon/internal/api/settings"
	"github.com/amigoer/rocket-leaf/daemon/internal/api/topic"
)

// Dependencies contains the business capabilities exposed by the HTTP API.
type Dependencies struct {
	Connections connection.Service
	Settings    settings.Service
	Cluster     cluster.Service
	Topics      topic.Service
	Consumers   consumer.Service
	Messages    message.Service
	ACL         acl.Service
}

// Config contains process-level HTTP API configuration.
type Config struct {
	Token    string
	Shutdown func()
}
