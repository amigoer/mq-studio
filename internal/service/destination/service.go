// Package destination orchestrates destination operations for whichever
// broker the active connection speaks.
//
// It owns the five concerns that are not a driver's job and would otherwise be
// repeated in every bridge method: resolving the connection, checking the
// capability, applying the request timeout, assigning renderer list keys, and
// deciding whether a missing connection is an error or an empty page.
package destination

import (
	"context"
	"errors"
	"sync/atomic"
	"time"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

// Settings exposes only what destination operations need.
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

// New creates a destination service.
func New(conns ConnSource, settings Settings) *Service {
	return &Service{conns: conns, settings: settings, nextID: 1}
}

func (s *Service) nextListID() int {
	return int(atomic.AddInt64(&s.nextID, 1))
}

// admin resolves the active connection and its destination surface.
func (s *Service) admin() (driver.DestinationAdmin, error) {
	conn, err := s.conns()
	if err != nil {
		return nil, err
	}
	api, ok := conn.(driver.DestinationAdmin)
	if !ok {
		return nil, driver.Unsupported(conn, model.CapDestinationList)
	}
	return api, nil
}

// withTimeout applies the configured request timeout, which is how drivers
// stay free of any reference to application settings.
func (s *Service) withTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, s.settings.GetRequestTimeout())
}

// List returns the destinations the user should see.
//
// A missing connection yields an empty list rather than an error: the list
// pages render empty when offline, and turning that into an error banner
// would be a visible behaviour change.
func (s *Service) List(ctx context.Context, filter model.DestinationFilter) ([]*model.Destination, error) {
	api, err := s.admin()
	if err != nil {
		if errors.Is(err, driver.ErrNotConnected) {
			return []*model.Destination{}, nil
		}
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	destinations, err := api.ListDestinations(ctx, filter)
	if err != nil {
		return nil, err
	}
	for _, destination := range destinations {
		destination.ID = s.nextListID()
	}
	return destinations, nil
}

// Detail returns one destination. Unlike List it reports a missing connection,
// because reaching a detail view at all implies one was open.
func (s *Service) Detail(ctx context.Context, ref model.DestinationRef) (*model.Destination, error) {
	api, err := s.admin()
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	destination, err := api.DestinationDetail(ctx, ref)
	if err != nil {
		return nil, err
	}
	if destination != nil {
		destination.ID = s.nextListID()
	}
	return destination, nil
}

// Create adds a destination.
func (s *Service) Create(ctx context.Context, spec model.DestinationSpec) error {
	return s.mutate(ctx, model.CapDestinationCreate, func(api driver.DestinationAdmin, ctx context.Context) error {
		return api.CreateDestination(ctx, spec)
	})
}

// Update changes an existing destination.
func (s *Service) Update(ctx context.Context, spec model.DestinationSpec) error {
	return s.mutate(ctx, model.CapDestinationUpdate, func(api driver.DestinationAdmin, ctx context.Context) error {
		return api.UpdateDestination(ctx, spec)
	})
}

// Remove deletes a destination.
func (s *Service) Remove(ctx context.Context, ref model.DestinationRef) error {
	return s.mutate(ctx, model.CapDestinationDelete, func(api driver.DestinationAdmin, ctx context.Context) error {
		return api.RemoveDestination(ctx, ref)
	})
}

// mutate runs a write against the active connection, refusing it up front when
// the connection does not declare the capability. Checking before the call is
// what keeps a driver from having to reject work the UI should never have
// offered.
func (s *Service) mutate(
	ctx context.Context,
	capability model.Capability,
	call func(driver.DestinationAdmin, context.Context) error,
) error {
	conn, err := s.conns()
	if err != nil {
		return err
	}
	if !conn.Capabilities().Has(capability) {
		return driver.Unsupported(conn, capability)
	}
	api, ok := conn.(driver.DestinationAdmin)
	if !ok {
		return driver.Unsupported(conn, capability)
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return call(api, ctx)
}

// Stats returns the per-partition read ranges of a destination.
func (s *Service) Stats(ctx context.Context, ref model.DestinationRef) (map[string]interface{}, error) {
	conn, err := s.conns()
	if err != nil {
		return nil, err
	}
	api, ok := conn.(driver.DestinationStats)
	if !ok {
		return nil, driver.Unsupported(conn, model.CapPartitions)
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.DestinationStats(ctx, ref)
}
