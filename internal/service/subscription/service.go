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
type ConnSource func() (driver.Conn, error)

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

func (s *Service) admin() (driver.SubscriptionAdmin, error) {
	conn, err := s.conns()
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
func (s *Service) List(ctx context.Context) ([]*model.Subscription, error) {
	api, err := s.admin()
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
func (s *Service) Detail(ctx context.Context, ref model.SubscriptionRef) (*model.Subscription, error) {
	api, err := s.admin()
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
func (s *Service) Create(ctx context.Context, spec model.SubscriptionSpec) error {
	return s.mutate(ctx, model.CapSubscriptionCreate, func(api driver.SubscriptionAdmin, ctx context.Context) error {
		return api.CreateSubscription(ctx, spec)
	})
}

// Update changes an existing subscription.
func (s *Service) Update(ctx context.Context, spec model.SubscriptionSpec) error {
	return s.mutate(ctx, model.CapSubscriptionCreate, func(api driver.SubscriptionAdmin, ctx context.Context) error {
		return api.UpdateSubscription(ctx, spec)
	})
}

// Remove deletes a subscription.
func (s *Service) Remove(ctx context.Context, ref model.SubscriptionRef) error {
	return s.mutate(ctx, model.CapSubscriptionDelete, func(api driver.SubscriptionAdmin, ctx context.Context) error {
		return api.RemoveSubscription(ctx, ref)
	})
}

func (s *Service) mutate(
	ctx context.Context,
	capability model.Capability,
	call func(driver.SubscriptionAdmin, context.Context) error,
) error {
	conn, err := s.conns()
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
func (s *Service) ResetOffset(ctx context.Context, request model.ResetOffsetRequest) error {
	conn, err := s.conns()
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
func (s *Service) Stats(ctx context.Context, ref model.SubscriptionRef) (map[string]interface{}, error) {
	conn, err := s.conns()
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
