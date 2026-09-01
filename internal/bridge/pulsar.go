package bridge

import (
	"context"

	pulsardriver "github.com/amigoer/mq-studio/internal/driver/pulsar"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/pulsar"
)

// PulsarService exposes what only Pulsar has.
//
// It is one service rather than several because it is one family's surface:
// splitting tenants, the send console and schema into three would put three
// names in the bindings for what a reader thinks of as "the Pulsar pages".
//
// Reading topics, subscriptions, namespaces and brokers is not here. Those are
// destinations, subscriptions, namespaces and nodes, and the canonical
// services already answer them; a second read path would be two sources for
// one number.
type PulsarService struct {
	service *pulsar.Service
}

// PulsarTenantView is a tenant as the tenants board draws it.
type PulsarTenantView struct {
	Name            string   `json:"name"`
	AdminRoles      []string `json:"adminRoles"`
	AllowedClusters []string `json:"allowedClusters"`
	// Namespaces is -1 when this credential could not list them, which happens
	// for every tenant but its own on a connection that is not a superuser.
	Namespaces int `json:"namespaces"`
}

// PulsarTenantInput is a tenant as the form collects it.
type PulsarTenantInput struct {
	Name string `json:"name"`
	// AdminRoles are the roles allowed to administer this tenant's namespaces.
	AdminRoles []string `json:"adminRoles"`
	// AllowedClusters bounds where the tenant's namespaces may live. Empty
	// means the cluster this connection is pointed at, which is what an
	// operator who left the field alone meant.
	AllowedClusters []string `json:"allowedClusters"`
}

// Tenants lists every tenant on the cluster.
func (s *PulsarService) Tenants(connID int) ([]*PulsarTenantView, error) {
	tenants, err := s.service.Tenants(context.Background(), connID)
	if err != nil {
		return nil, err
	}
	views := make([]*PulsarTenantView, 0, len(tenants))
	for _, tenant := range tenants {
		views = append(views, &PulsarTenantView{
			Name:            tenant.Name,
			AdminRoles:      tenant.AdminRoles,
			AllowedClusters: tenant.AllowedClusters,
			Namespaces:      tenant.Namespaces,
		})
	}
	return views, nil
}

// SaveTenant creates a tenant or updates the one already there.
func (s *PulsarService) SaveTenant(connID int, input PulsarTenantInput) error {
	return s.service.SaveTenant(context.Background(), connID, pulsardriver.TenantSpec{
		Name:            input.Name,
		AdminRoles:      input.AdminRoles,
		AllowedClusters: input.AllowedClusters,
	})
}

// RemoveTenant deletes one. Pulsar refuses while it still holds namespaces,
// and that refusal reaches the user rather than being forced through.
func (s *PulsarService) RemoveTenant(connID int, name string) error {
	return s.service.RemoveTenant(context.Background(), connID, name)
}

// Clusters is what the tenant form offers for its allowed-cluster list.
func (s *PulsarService) Clusters(connID int) ([]string, error) {
	return s.service.Clusters(context.Background(), connID)
}

// Namespaces returns every namespace under the profile's tenant, with the
// limits that are actually set on it.
func (s *PulsarService) Namespaces(connID int) ([]*model.Namespace, error) {
	return s.service.Namespaces(context.Background(), connID)
}

// PulsarNamespaceInput creates a namespace.
//
// Only a name, because that is all Pulsar takes: a namespace is created empty
// and its policies are set afterwards, one call each. A form that collected
// them here would have to either apply them in a second round the user cannot
// see fail, or pretend the create carried them.
type PulsarNamespaceInput struct {
	// Name may be bare or already tenant-qualified. A bare one is created
	// under the tenant this connection is scoped to.
	Name string `json:"name"`
}

// CreateNamespace adds one under the profile's tenant.
func (s *PulsarService) CreateNamespace(connID int, input PulsarNamespaceInput) error {
	return s.service.CreateNamespace(context.Background(), connID, model.NamespaceSpec{
		Name: input.Name,
	})
}

// DeleteNamespace removes one. Pulsar refuses while it still holds topics, and
// that refusal reaches the user rather than being forced through.
func (s *PulsarService) DeleteNamespace(connID int, name string) error {
	return s.service.DeleteNamespace(context.Background(), connID, name)
}

// SetNamespaceLimit caps a namespace as a whole.
func (s *PulsarService) SetNamespaceLimit(connID int, name, limit string, value int) error {
	return s.service.SetNamespaceLimit(context.Background(), connID, name, limit, value)
}

// RemoveNamespaceLimit hands a limit back to the broker's own default. Not the
// same as setting zero: zero producers is a namespace nothing can publish to.
func (s *PulsarService) RemoveNamespaceLimit(connID int, name, limit string) error {
	return s.service.RemoveNamespaceLimit(context.Background(), connID, name, limit)
}
