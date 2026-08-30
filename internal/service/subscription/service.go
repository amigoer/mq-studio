// Package subscription orchestrates consumer-group operations for whichever
// broker the active connection speaks.
package subscription

import (
	"context"
	"errors"
	"sync/atomic"
	"time"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

// Settings exposes only what subscription operations need.
type Settings interface {
	GetRequestTimeout() time.Duration
}

// ConnSource yields the connection a request runs against.
//
// Taking an id is what lets a caller name the connection instead of relying
// on an implicit default, which is the whole reason the bridge signatures
// grew one.
type ConnSource func(connID int) (driver.Conn, error)

// Service is the orchestration layer between the bridge and a driver.
type Service struct {
	conns    ConnSource
	settings Settings
	nextID   int64
}

// New creates a subscription service.
func New(conns ConnSource, settings Settings) *Service {
	return &Service{conns: conns, settings: settings, nextID: 1}
}

func (s *Service) nextListID() int {
	return int(atomic.AddInt64(&s.nextID, 1))
}

func (s *Service) withTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, s.settings.GetRequestTimeout())
}

func (s *Service) admin(connID int) (driver.SubscriptionAdmin, error) {
	conn, err := s.conns(connID)
	if err != nil {
		return nil, err
	}
	api, ok := conn.(driver.SubscriptionAdmin)
	if !ok {
		return nil, driver.Unsupported(conn, model.CapSubscriptionList)
	}
	return api, nil
}

// List returns the subscriptions the user should see.
//
// A missing connection yields an empty list rather than an error, matching
// what the list page renders when offline.
func (s *Service) List(ctx context.Context, connID int) ([]*model.Subscription, error) {
	api, err := s.admin(connID)
	if err != nil {
		if errors.Is(err, driver.ErrNotConnected) {
			return []*model.Subscription{}, nil
		}
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	subscriptions, err := api.ListSubscriptions(ctx)
	if err != nil {
		return nil, err
	}
	for _, subscription := range subscriptions {
		subscription.ID = s.nextListID()
	}
	return subscriptions, nil
}

// Detail returns one subscription with its members.
func (s *Service) Detail(ctx context.Context, connID int, ref model.SubscriptionRef) (*model.Subscription, error) {
	api, err := s.admin(connID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	subscription, err := api.SubscriptionDetail(ctx, ref)
	if err != nil {
		return nil, err
	}
	if subscription != nil {
		subscription.ID = s.nextListID()
	}
	return subscription, nil
}

// Create adds a subscription.
func (s *Service) Create(ctx context.Context, connID int, spec model.SubscriptionSpec) error {
	return s.mutate(ctx, connID, model.CapSubscriptionCreate, func(api driver.SubscriptionAdmin, ctx context.Context) error {
		return api.CreateSubscription(ctx, spec)
	})
}

// Update changes an existing subscription.
func (s *Service) Update(ctx context.Context, connID int, spec model.SubscriptionSpec) error {
	return s.mutate(ctx, connID, model.CapSubscriptionCreate, func(api driver.SubscriptionAdmin, ctx context.Context) error {
		return api.UpdateSubscription(ctx, spec)
	})
}

// Remove deletes a subscription.
func (s *Service) Remove(ctx context.Context, connID int, ref model.SubscriptionRef) error {
	return s.mutate(ctx, connID, model.CapSubscriptionDelete, func(api driver.SubscriptionAdmin, ctx context.Context) error {
		return api.RemoveSubscription(ctx, ref)
	})
}

func (s *Service) mutate(
	ctx context.Context,
	connID int,
	capability model.Capability,
	call func(driver.SubscriptionAdmin, context.Context) error,
) error {
	conn, err := s.conns(connID)
	if err != nil {
		return err
	}
	if !conn.Capabilities().Has(capability) {
		return driver.Unsupported(conn, capability)
	}
	api, ok := conn.(driver.SubscriptionAdmin)
	if !ok {
		return driver.Unsupported(conn, capability)
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return call(api, ctx)
}

// ResetOffset moves a subscription's read position.
//
// It goes through ProgressAdmin rather than SubscriptionAdmin because backlog
// and position are different things: RabbitMQ reports a backlog but has no
// position to move.
func (s *Service) ResetOffset(ctx context.Context, connID int, request model.ResetOffsetRequest) error {
	conn, err := s.conns(connID)
	if err != nil {
		return err
	}
	if !conn.Capabilities().Has(model.CapOffsetReset) {
		return driver.Unsupported(conn, model.CapOffsetReset)
	}
	api, ok := conn.(driver.ProgressAdmin)
	if !ok {
		return driver.Unsupported(conn, model.CapOffsetReset)
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.ResetOffset(ctx, request)
}

// Stats returns the per-partition consume progress of a subscription.
func (s *Service) Stats(ctx context.Context, connID int, ref model.SubscriptionRef) (map[string]interface{}, error) {
	conn, err := s.conns(connID)
	if err != nil {
		return nil, err
	}
	api, ok := conn.(driver.SubscriptionStats)
	if !ok {
		return nil, driver.Unsupported(conn, model.CapSubscriptionLag)
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.SubscriptionStats(ctx, ref)
}

// Clients reports what each connected consumer in a group is doing.
//
// Unlike Stats, which is the broker's view of a group's progress, this asks
// the clients themselves - so it is the only thing that can say which consumer
// holds which queue, and why one of them is behind while the others idle.
func (s *Service) Clients(ctx context.Context, connID int, ref model.SubscriptionRef) ([]*model.SubscriptionClient, error) {
	conn, err := s.conns(connID)
	if err != nil {
		return nil, err
	}
	if !conn.Capabilities().Has(model.CapSubscriptionRuntime) {
		return nil, driver.Unsupported(conn, model.CapSubscriptionRuntime)
	}
	api, ok := conn.(driver.SubscriptionRuntime)
	if !ok {
		return nil, driver.Unsupported(conn, model.CapSubscriptionRuntime)
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.SubscriptionClients(ctx, ref)
}
