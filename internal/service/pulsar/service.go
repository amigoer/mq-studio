// Package pulsar orchestrates the operations only Pulsar has.
//
// It exists beside the canonical services rather than inside them because the
// canonical ones cannot express the questions. Tenants are the clearest case:
// a tenant holds namespaces and carries the roles allowed to administer them
// and the clusters they may live in, and no canonical port describes anything
// of the sort - NamespaceAdmin starts one level below.
//
// The canonical services still serve Pulsar everything they can express -
// topics are destinations, subscriptions are subscriptions, brokers are nodes,
// namespaces are namespaces - so nothing here duplicates a read that already
// has a home.
package pulsar

import (
	"context"
	"fmt"
	"time"

	"github.com/amigoer/mq-studio/internal/driver"
	pulsardriver "github.com/amigoer/mq-studio/internal/driver/pulsar"
	"github.com/amigoer/mq-studio/internal/model"
)

// Settings exposes only what these operations need.
type Settings interface {
	GetRequestTimeout() time.Duration
}

// ConnSource yields the connection a request runs against.
type ConnSource func(connID int) (driver.Conn, error)

// Service is the orchestration layer between the bridge and the driver.
type Service struct {
	conns    ConnSource
	settings Settings
}

// New creates the service.
func New(conns ConnSource, settings Settings) *Service {
	return &Service{conns: conns, settings: settings}
}

func (s *Service) withTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, s.settings.GetRequestTimeout())
}

// pulsarConn resolves the connection and asserts it is this family's.
//
// There is no capability to gate on: tenants have no canonical port and
// therefore no Capability that could describe them, so the gate is the driver
// itself. A profile of another family reaching these methods is a bug in the
// renderer rather than an unsupported operation, and the error says so.
func (s *Service) pulsarConn(connID int) (*pulsardriver.Conn, error) {
	conn, err := s.conns(connID)
	if err != nil {
		return nil, err
	}
	api, ok := conn.(*pulsardriver.Conn)
	if !ok {
		return nil, fmt.Errorf("connection %d is %s, not pulsar", connID, conn.Kind())
	}
	return api, nil
}

// Tenants is every tenant on the cluster.
func (s *Service) Tenants(ctx context.Context, connID int) ([]*pulsardriver.Tenant, error) {
	conn, err := s.pulsarConn(connID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return conn.Tenants(ctx)
}

// SaveTenant creates a tenant or updates the one already there.
func (s *Service) SaveTenant(ctx context.Context, connID int, spec pulsardriver.TenantSpec) error {
	conn, err := s.pulsarConn(connID)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return conn.SaveTenant(ctx, spec)
}

// RemoveTenant deletes one, if it holds no namespaces.
func (s *Service) RemoveTenant(ctx context.Context, connID int, name string) error {
	conn, err := s.pulsarConn(connID)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return conn.RemoveTenant(ctx, name)
}

// Clusters is what a tenant's allowed-cluster list can be drawn from.
//
// It goes through the canonical cluster port rather than the driver, because
// listing a cluster's name is exactly what ClusterOverview already answers -
// this only saves the tenant form from asking for the whole overview.
func (s *Service) Clusters(ctx context.Context, connID int) ([]string, error) {
	conn, err := s.conns(connID)
	if err != nil {
		return nil, err
	}
	api, ok := conn.(driver.ClusterAdmin)
	if !ok {
		return nil, driver.Unsupported(conn, model.CapClusterTopology)
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	overview, err := api.ClusterOverview(ctx)
	if err != nil {
		return nil, err
	}
	return []string{overview.Name}, nil
}

// port resolves the connection and asserts it implements what the caller
// needs, checking the declared capability first.
//
// The capability check comes before the type assertion for the same reason it
// does in every other service: a driver should not have to refuse an operation
// the interface was never meant to offer, and the reason a page gets back
// should name the capability rather than the Go type.
func port[T any](s *Service, connID int, capability model.Capability) (T, error) {
	var zero T
	conn, err := s.conns(connID)
	if err != nil {
		return zero, err
	}
	if !conn.Capabilities().Has(capability) {
		return zero, driver.Unsupported(conn, capability)
	}
	api, ok := conn.(T)
	if !ok {
		return zero, driver.Unsupported(conn, capability)
	}
	return api, nil
}

// Namespaces is every namespace under the profile's tenant, with its limits.
func (s *Service) Namespaces(ctx context.Context, connID int) ([]*model.Namespace, error) {
	api, err := port[driver.NamespaceAdmin](s, connID, model.CapNamespaceList)
	if err != nil {
		return nil, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.ListNamespaces(ctx)
}

// CreateNamespace adds one under the profile's tenant.
func (s *Service) CreateNamespace(ctx context.Context, connID int, spec model.NamespaceSpec) error {
	api, err := port[driver.NamespaceAdmin](s, connID, model.CapNamespaceAdmin)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.CreateNamespace(ctx, spec)
}

// DeleteNamespace removes one. Pulsar refuses while it still holds topics.
func (s *Service) DeleteNamespace(ctx context.Context, connID int, name string) error {
	api, err := port[driver.NamespaceAdmin](s, connID, model.CapNamespaceAdmin)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RemoveNamespace(ctx, name)
}

// SetNamespaceLimit caps a namespace as a whole.
func (s *Service) SetNamespaceLimit(
	ctx context.Context, connID int, name, limit string, value int,
) error {
	api, err := port[driver.NamespaceLimits](s, connID, model.CapNamespaceLimits)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.SetNamespaceLimit(ctx, name, limit, value)
}

// RemoveNamespaceLimit puts a limit back to the broker's own default, which is
// not the same as setting it to zero.
func (s *Service) RemoveNamespaceLimit(
	ctx context.Context, connID int, name, limit string,
) error {
	api, err := port[driver.NamespaceLimits](s, connID, model.CapNamespaceLimits)
	if err != nil {
		return err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()
	return api.RemoveNamespaceLimit(ctx, name, limit)
}
