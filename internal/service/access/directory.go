package access

import (
	"context"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

func (s *Service) directory(connID int) (driver.AccessDirectory, error) {
	conn, err := s.conns(connID)
	if err != nil {
		return nil, err
	}
	api, ok := conn.(driver.AccessDirectory)
	if !ok || !conn.Capabilities().Has(model.CapAccessDirectory) {
		return nil, driver.Unsupported(conn, model.CapAccessDirectory)
	}
	return api, nil
}

// DirectoryEnabled reports whether the broker runs identity-based access
// control, so the page can say which system is on rather than showing the
// error a 4.x broker answers an unknown request code with.
func (s *Service) DirectoryEnabled(ctx context.Context, connID int) (bool, error) {
	api, err := s.directory(connID)
	if err != nil {
		return false, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.DirectoryEnabled(ctx)
}

// Principals returns the identities the broker authenticates.
func (s *Service) Principals(ctx context.Context, connID int) ([]*model.AccessPrincipal, error) {
	api, err := s.directory(connID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.ListPrincipals(ctx)
}

// PutPrincipal creates a principal, or updates one that already exists.
func (s *Service) PutPrincipal(ctx context.Context, connID int, spec model.AccessPrincipalSpec) error {
	api, err := s.directory(connID)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.PutPrincipal(ctx, spec)
}

// RemovePrincipal deletes a principal.
func (s *Service) RemovePrincipal(ctx context.Context, connID int, name string) error {
	api, err := s.directory(connID)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RemovePrincipal(ctx, name)
}

// Rules returns every subject's policies.
func (s *Service) Rules(ctx context.Context, connID int) ([]*model.AccessRule, error) {
	api, err := s.directory(connID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.ListAccessRules(ctx)
}

// PutRule replaces one subject's policies.
func (s *Service) PutRule(ctx context.Context, connID int, rule model.AccessRule) error {
	api, err := s.directory(connID)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.PutAccessRule(ctx, rule)
}

// RemoveRule drops every policy attached to a subject.
func (s *Service) RemoveRule(ctx context.Context, connID int, subject string) error {
	api, err := s.directory(connID)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RemoveAccessRule(ctx, subject)
}
