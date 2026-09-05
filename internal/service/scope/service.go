// Package scope lists the values a connection's scope can be pointed at.
package scope

import (
	"context"
	"time"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

// Settings exposes only the application settings this service needs.
type Settings interface {
	GetRequestTimeout() time.Duration
}

// ConnSource yields the connection a request runs against.
type ConnSource func(connID int) (driver.Conn, error)

// Service answers what one live connection could be re-scoped to.
type Service struct {
	conns    ConnSource
	settings Settings
}

// New creates the service.
func New(conns ConnSource, settings Settings) *Service {
	return &Service{conns: conns, settings: settings}
}

func (s *Service) inspector(connID int) (driver.ScopeInspector, error) {
	conn, err := s.conns(connID)
	if err != nil {
		return nil, err
	}
	api, ok := conn.(driver.ScopeInspector)
	if !ok {
		return nil, driver.Unsupported(conn, model.CapConnectionScope)
	}
	return api, nil
}

// List returns the scopes the cluster's own names carry, sorted by name.
//
// The timeout is the ordinary request budget rather than a longer one: the
// listing walks every topic and every broker's groups, and a switcher the user
// is waiting on is worth failing fast.
func (s *Service) List(ctx context.Context, connID int) ([]*model.Scope, error) {
	api, err := s.inspector(connID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, s.settings.GetRequestTimeout())
	defer cancel()
	return api.ListScopes(ctx)
}

// Validate reports whether a name the listing did not offer is usable.
//
// Checked against the live connection rather than against a rule kept here,
// because what a name may contain is the family's business - and because
// storing one the driver would refuse leaves a profile that can no longer be
// opened at all.
func (s *Service) Validate(connID int, name string) error {
	api, err := s.inspector(connID)
	if err != nil {
		return err
	}
	return api.ValidateScope(name)
}
