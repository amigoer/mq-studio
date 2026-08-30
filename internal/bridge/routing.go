package bridge

import (
	"context"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/routing"
)

// RoutingService exposes exchanges and bindings to the frontend.
//
// It is the one bridge service with no canonical page behind it: routing has
// no counterpart in any other family, so the driver that has it contributes
// a page and this feeds it.
type RoutingService struct {
	service *routing.Service
}

// Exchanges returns the exchanges in a namespace.
func (s *RoutingService) Exchanges(connID int, namespace string) ([]*model.Destination, error) {
	return s.service.Exchanges(context.Background(), connID, namespace)
}

// Bindings returns the routes in a namespace.
func (s *RoutingService) Bindings(connID int, namespace string) ([]*model.Binding, error) {
	return s.service.Bindings(context.Background(), connID, namespace)
}
