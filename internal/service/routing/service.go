// Package routing orchestrates exchange and binding operations.
//
// Only RabbitMQ has them, which is why this is the one domain with no
// canonical page: the driver contributes a page of its own and this is what
// feeds it.
package routing

import (
	"context"
	"errors"
	"time"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

// Settings exposes only what routing operations need.
type Settings interface {
	GetRequestTimeout() time.Duration
}

// ConnSource yields the connection a request runs against.
type ConnSource func(connID int) (driver.Conn, error)

// Service is the orchestration layer between the bridge and a driver.
type Service struct {
	conns    ConnSource
	settings Settings
}

// New creates a routing service.
func New(conns ConnSource, settings Settings) *Service {
	return &Service{conns: conns, settings: settings}
}

func (s *Service) admin(connID int) (driver.RoutingAdmin, error) {
	conn, err := s.conns(connID)
	if err != nil {
		return nil, err
	}
	api, ok := conn.(driver.RoutingAdmin)
	if !ok {
		return nil, driver.Unsupported(conn, model.CapRouting)
	}
	return api, nil
}

func (s *Service) withTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, s.settings.GetRequestTimeout())
}

// Exchanges returns the exchanges in a namespace.
//
// A missing connection yields an empty list, matching every other list page.
func (s *Service) Exchanges(ctx context.Context, connID int, namespace string) ([]*model.Destination, error) {
	api, err := s.admin(connID)
	if err != nil {
		if errors.Is(err, driver.ErrNotConnected) {
			return []*model.Destination{}, nil
		}
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	exchanges, err := api.ListExchanges(ctx, namespace)
	if err != nil {
		return nil, err
	}
	for i, exchange := range exchanges {
		exchange.ID = i + 1
	}
	return exchanges, nil
}

// Bindings returns the routes in a namespace.
func (s *Service) Bindings(ctx context.Context, connID int, namespace string) ([]*model.Binding, error) {
	api, err := s.admin(connID)
	if err != nil {
		if errors.Is(err, driver.ErrNotConnected) {
			return []*model.Binding{}, nil
		}
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.ListBindings(ctx, namespace)
}
