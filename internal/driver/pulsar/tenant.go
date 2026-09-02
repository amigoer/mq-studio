package pulsar

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/apache/pulsar-client-go/pulsaradmin/pkg/utils"
)

// Tenant is the level above a namespace, which no canonical port describes.
//
// It is deliberately not squeezed into model.Namespace. A tenant holds
// namespaces and carries the two things that decide what a namespace may do -
// who administers it, and which clusters it may be replicated to - and neither
// has a field there. So it travels through PulsarService in its own shape,
// which is the same reason KafkaService exists beside the canonical topic one.
type Tenant struct {
	Name string `json:"name"`
	// AdminRoles are the roles allowed to administer this tenant's namespaces.
	// Empty means only a cluster superuser can.
	AdminRoles []string `json:"adminRoles"`
	// AllowedClusters bounds where this tenant's namespaces may live. A
	// namespace cannot be created in a cluster its tenant does not list.
	AllowedClusters []string `json:"allowedClusters"`
	// Namespaces is how many it holds, or UnknownMetric when this credential
	// could not list them - which happens for every tenant but its own on a
	// non-superuser connection.
	Namespaces int `json:"namespaces"`
}

// TenantSpec creates or updates a tenant.
type TenantSpec struct {
	Name            string   `json:"name"`
	AdminRoles      []string `json:"adminRoles"`
	AllowedClusters []string `json:"allowedClusters"`
}

// Tenants is every tenant on the cluster.
//
// Listing them needs a superuser. A credential scoped to one tenant gets a
// 403, which is passed through rather than swallowed: the page saying "this
// connection cannot list tenants" is more use than an empty list that reads as
// a cluster with none.
func (c *Conn) Tenants(ctx context.Context) ([]*Tenant, error) {
	names, err := c.admin.Tenants().ListWithContext(ctx)
	if err != nil {
		return nil, fmt.Errorf("list tenants: %w", err)
	}
	sort.Strings(names)

	tenants := make([]*Tenant, 0, len(names))
	for _, name := range names {
		tenants = append(tenants, c.tenantOf(ctx, name))
	}
	return tenants, nil
}

// tenantOf reads one tenant, filling in what this credential can see.
func (c *Conn) tenantOf(ctx context.Context, name string) *Tenant {
	tenant := &Tenant{Name: name, Namespaces: unknownCount}

	if data, err := c.admin.Tenants().GetWithContext(ctx, name); err == nil {
		tenant.AdminRoles = data.AdminRoles
		tenant.AllowedClusters = data.AllowedClusters
	}
	// Best-effort, and unknown rather than zero when it fails: a credential
	// that administers one tenant is refused the others, and reporting that as
	// "holds no namespaces" would be a claim about the cluster rather than
	// about this connection.
	if namespaces, err := c.admin.Namespaces().GetNamespacesWithContext(ctx, name); err == nil {
		tenant.Namespaces = len(namespaces)
	}
	return tenant
}

// unknownCount mirrors model.UnknownMetric for the counts on this driver's own
// shapes, which no canonical model covers.
const unknownCount = -1

// SaveTenant creates a tenant, or updates the one that is already there.
//
// One call rather than two because the form is one form: Pulsar's create and
// update take the same document and differ only in whether the tenant exists,
// which the caller would have to ask about first to choose between them.
func (c *Conn) SaveTenant(ctx context.Context, spec TenantSpec) error {
	name := strings.TrimSpace(spec.Name)
	if name == "" {
		return fmt.Errorf("a tenant needs a name")
	}
	if strings.Contains(name, "/") {
		return fmt.Errorf("a tenant name cannot contain a slash: %q", name)
	}

	clusters := spec.AllowedClusters
	if len(clusters) == 0 {
		// A tenant with no allowed cluster can hold no namespace anywhere, so
		// an empty list is a tenant that cannot be used. Defaulting to the
		// local cluster is what the form means by leaving it blank.
		local, err := c.localCluster(ctx)
		if err != nil {
			return err
		}
		clusters = []string{local}
	}

	data := utils.TenantData{
		Name:            name,
		AdminRoles:      spec.AdminRoles,
		AllowedClusters: clusters,
	}
	if _, err := c.admin.Tenants().GetWithContext(ctx, name); err != nil {
		if err := c.admin.Tenants().CreateWithContext(ctx, data); err != nil {
			return fmt.Errorf("create tenant %q: %w", name, err)
		}
		return nil
	}
	if err := c.admin.Tenants().UpdateWithContext(ctx, data); err != nil {
		return fmt.Errorf("update tenant %q: %w", name, err)
	}
	return nil
}

// RemoveTenant deletes one.
//
// Pulsar refuses while the tenant still holds namespaces, and that refusal is
// passed through: emptying a tenant is a separate decision from deleting it.
func (c *Conn) RemoveTenant(ctx context.Context, name string) error {
	if err := c.admin.Tenants().DeleteWithContext(ctx, name); err != nil {
		return fmt.Errorf("delete tenant %q: %w", name, err)
	}
	return nil
}
