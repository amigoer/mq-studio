// Package access orchestrates access-control operations for whichever broker
// the active connection speaks.
package access

import (
	"context"
	"time"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

// Settings exposes only what access operations need.
type Settings interface {
	GetRequestTimeout() time.Duration
}

// ConnSource yields the connection a request runs against.
type ConnSource func() (driver.Conn, error)

// Service is the orchestration layer between the bridge and a driver.
type Service struct {
	conns    ConnSource
	settings Settings
}

// New creates an access service.
func New(conns ConnSource, settings Settings) *Service {
	return &Service{conns: conns, settings: settings}
}

func (s *Service) admin() (driver.AccessAdmin, error) {
	conn, err := s.conns()
	if err != nil {
		return nil, err
	}
	api, ok := conn.(driver.AccessAdmin)
	if !ok {
		return nil, driver.Unsupported(conn, model.CapAccessControl)
	}
	return api, nil
}

func (s *Service) withTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, s.settings.GetRequestTimeout())
}

// Enabled reports whether the broker has access control turned on.
func (s *Service) Enabled(ctx context.Context) (bool, error) {
	api, err := s.admin()
	if err != nil {
		return false, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.AccessEnabled(ctx)
}

// Version returns the broker access-control config version.
func (s *Service) Version(ctx context.Context) (*model.AclVersionInfo, error) {
	api, err := s.admin()
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.AccessVersion(ctx)
}

// Put creates or replaces an access entry.
func (s *Service) Put(ctx context.Context, config model.AccessConfig) error {
	api, err := s.admin()
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.PutAccessConfig(ctx, config)
}

// Remove deletes an access entry.
func (s *Service) Remove(ctx context.Context, principal string) error {
	api, err := s.admin()
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RemoveAccessConfig(ctx, principal)
}

// SetAllowList replaces the broker global IP allow list.
func (s *Service) SetAllowList(ctx context.Context, addresses []string) error {
	api, err := s.admin()
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.SetGlobalWhiteAddrs(ctx, addresses)
}
