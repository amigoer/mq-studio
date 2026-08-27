package app

import (
	"fmt"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/driver/rocketmq"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/connection"
)

// newConnSource resolves a profile id to a live connection.
//
// The contract is by id, which is what lets a bridge method name the
// connection it acts on instead of relying on an implicit default. That the
// RocketMQ client manager underneath is still keyed by endpoint is an
// implementation detail of one driver, not something the layers above should
// have to know.
func newConnSource(connections *connection.Service) func(int) (driver.Conn, error) {
	return func(connID int) (driver.Conn, error) {
		profile, err := resolveProfile(connections, connID)
		if err != nil {
			return nil, err
		}
		if profile.Status != model.StatusOnline {
			return nil, fmt.Errorf("%w: %d", driver.ErrNotConnected, profile.ID)
		}
		switch profile.Kind {
		case model.KindRocketMQ, "":
			return rocketmq.CurrentConn()
		default:
			return nil, fmt.Errorf("%w: %s", driver.ErrUnknownKind, profile.Kind)
		}
	}
}

// resolveProfile falls back to the default profile when the caller passes no
// id. The renderer shows one connection at a time, so a page that has not yet
// been told which one still has to render something.
func resolveProfile(connections *connection.Service, connID int) (*model.ConnectionProfile, error) {
	if connID > 0 {
		return connections.GetConnection(connID)
	}
	for _, profile := range connections.GetConnections() {
		if profile != nil && profile.Status == model.StatusOnline {
			return profile, nil
		}
	}
	return nil, driver.ErrNotConnected
}
