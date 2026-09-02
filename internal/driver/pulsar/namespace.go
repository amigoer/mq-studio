package pulsar

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/apache/pulsar-client-go/pulsaradmin/pkg/utils"

	"github.com/amigoer/mq-studio/internal/model"
)

// The limits a Pulsar namespace can carry, as the keys the UI sets them by.
//
// They are a contract with frontend/src/mq/pulsar/namespaces.ts. Absent from
// the map means uncapped, which is Pulsar's own default and is not the same as
// a limit of zero - zero producers is a namespace nothing can publish to.
const (
	LimitMessageTTLSeconds           = "messageTtlSeconds"
	LimitRetentionTimeMinutes        = "retentionTimeMinutes"
	LimitRetentionSizeMB             = "retentionSizeMb"
	LimitMaxProducersPerTopic        = "maxProducersPerTopic"
	LimitMaxConsumersPerTopic        = "maxConsumersPerTopic"
	LimitMaxConsumersPerSubscription = "maxConsumersPerSubscription"
)

// ListNamespaces is every namespace under the profile's tenant.
//
// Scoped to one tenant rather than the whole cluster on purpose: listing every
// tenant's namespaces needs a superuser, and the connection form asks for the
// tenant precisely because most credentials only reach one. The tenants page
// is what changes which one this is.
func (c *Conn) ListNamespaces(ctx context.Context) ([]*model.Namespace, error) {
	names, err := c.admin.Namespaces().GetNamespacesWithContext(ctx, c.config.Tenant)
	if err != nil {
		return nil, fmt.Errorf("list the namespaces of tenant %q: %w", c.config.Tenant, err)
	}
	sort.Strings(names)

	namespaces := make([]*model.Namespace, 0, len(names))
	for _, name := range names {
		namespaces = append(namespaces, c.namespaceOf(ctx, name))
	}
	return namespaces, nil
}

// namespaceOf reads one namespace's policies into the canonical shape.
//
// The policies come in one request rather than six: every limit this page
// shows is a field of the same document, and asking for them separately would
// turn a listing of twenty namespaces into a hundred and twenty calls.
//
// A namespace whose policies cannot be read is still listed, with no limits.
// It exists - the tenant just said so - and dropping it would make a namespace
// this credential cannot fully read look like one that is not there.
func (c *Conn) namespaceOf(ctx context.Context, name string) *model.Namespace {
	namespace := &model.Namespace{
		Name: name,
		// Counting a namespace's messages means walking its topics, which is
		// the topics page's job and costs a request each. Zero here would read
		// as an empty namespace.
		Messages:       model.UnknownMetric,
		Ready:          model.UnknownMetric,
		Unacknowledged: model.UnknownMetric,
		Limits:         map[string]int{},
	}

	policies, err := c.admin.Namespaces().GetPoliciesWithContext(ctx, name)
	if err != nil || policies == nil {
		return namespace
	}
	applyPolicies(namespace, policies)
	return namespace
}

// applyPolicies copies the limits that are set, and only those.
//
// Every one of these is a pointer in pulsaradmin because Pulsar distinguishes
// "not configured" from "configured to zero", and so does the UI: an absent
// limit renders as uncapped and a zero renders as zero. Flattening them would
// tell an operator a namespace is capped at nothing.
func applyPolicies(namespace *model.Namespace, policies *utils.Policies) {
	if policies.MessageTTLInSeconds != nil {
		namespace.Limits[LimitMessageTTLSeconds] = *policies.MessageTTLInSeconds
	}
	if policies.MaxProducersPerTopic != nil {
		namespace.Limits[LimitMaxProducersPerTopic] = *policies.MaxProducersPerTopic
	}
	if policies.MaxConsumersPerTopic != nil {
		namespace.Limits[LimitMaxConsumersPerTopic] = *policies.MaxConsumersPerTopic
	}
	if policies.MaxConsumersPerSubscription != nil {
		namespace.Limits[LimitMaxConsumersPerSubscription] = *policies.MaxConsumersPerSubscription
	}
	if policies.RetentionPolicies != nil {
		// Retention is a pair and both halves are meaningful on their own:
		// "keep for an hour" and "keep a gigabyte" are different promises, and
		// Pulsar retains until whichever is reached first.
		namespace.Limits[LimitRetentionTimeMinutes] = policies.RetentionPolicies.RetentionTimeInMinutes
		namespace.Limits[LimitRetentionSizeMB] = int(policies.RetentionPolicies.RetentionSizeInMB)
	}
}

// CreateNamespace adds one under the profile's tenant.
//
// The spec's name may be bare or already qualified. Both are accepted because
// the form collects a short name and an import carries a full one, and
// qualifying an already-qualified name would produce tenant/tenant/namespace.
func (c *Conn) CreateNamespace(ctx context.Context, spec model.NamespaceSpec) error {
	name, err := c.qualifyNamespace(spec.Name)
	if err != nil {
		return err
	}
	if err := c.admin.Namespaces().CreateNamespaceWithContext(ctx, name); err != nil {
		return fmt.Errorf("create namespace %q: %w", name, err)
	}
	return nil
}

// RemoveNamespace deletes one.
//
// Pulsar refuses while the namespace still holds topics, and that refusal is
// passed through rather than forced: deleting a namespace's topics is a
// separate decision from deleting the namespace, and doing both behind one
// button is how data goes missing.
func (c *Conn) RemoveNamespace(ctx context.Context, name string) error {
	qualified, err := c.qualifyNamespace(name)
	if err != nil {
		return err
	}
	if err := c.admin.Namespaces().DeleteNamespaceWithContext(ctx, qualified); err != nil {
		return fmt.Errorf("delete namespace %q: %w", qualified, err)
	}
	return nil
}

// SetNamespaceLimit caps a namespace as a whole.
func (c *Conn) SetNamespaceLimit(ctx context.Context, name, limit string, value int) error {
	qualified, err := c.qualifyNamespace(name)
	if err != nil {
		return err
	}
	namespaces := c.admin.Namespaces()

	switch limit {
	case LimitMessageTTLSeconds:
		err = namespaces.SetNamespaceMessageTTLWithContext(ctx, qualified, value)
	case LimitRetentionTimeMinutes, LimitRetentionSizeMB:
		err = c.setRetention(ctx, qualified, limit, value)
	case LimitMaxProducersPerTopic, LimitMaxConsumersPerTopic, LimitMaxConsumersPerSubscription:
		err = c.setPerTopicLimit(ctx, qualified, limit, value)
	default:
		return fmt.Errorf("%q is not a limit a pulsar namespace carries", limit)
	}
	if err != nil {
		return fmt.Errorf("set %s on namespace %q: %w", limit, qualified, err)
	}
	return nil
}

// setRetention writes one half of the retention pair without clearing the
// other. Pulsar takes both in one call, so the half that is not being edited
// has to be read back first - writing a zero would silently turn off the
// promise nobody touched.
func (c *Conn) setRetention(ctx context.Context, namespace, limit string, value int) error {
	namespaces := c.admin.Namespaces()

	policy := utils.RetentionPolicies{}
	if current, err := namespaces.GetRetentionWithContext(ctx, namespace); err == nil && current != nil {
		policy = *current
	}
	if limit == LimitRetentionTimeMinutes {
		policy.RetentionTimeInMinutes = value
	} else {
		policy.RetentionSizeInMB = int64(value)
	}
	return namespaces.SetRetentionWithContext(ctx, namespace, policy)
}

func (c *Conn) setPerTopicLimit(ctx context.Context, namespace, limit string, value int) error {
	name, err := utils.GetNameSpaceName(tenantOf(namespace), shortNamespaceOf(namespace))
	if err != nil {
		return err
	}
	namespaces := c.admin.Namespaces()

	switch limit {
	case LimitMaxProducersPerTopic:
		return namespaces.SetMaxProducersPerTopicWithContext(ctx, *name, value)
	case LimitMaxConsumersPerTopic:
		return namespaces.SetMaxConsumersPerTopicWithContext(ctx, *name, value)
	default:
		return namespaces.SetMaxConsumersPerSubscriptionWithContext(ctx, *name, value)
	}
}

// RemoveNamespaceLimit puts a limit back to whatever the broker defaults to.
//
// Removing is not setting zero, which is why it is a separate call: zero
// producers is a namespace nothing can publish to, and "no limit" is the
// broker's own setting taking over again.
func (c *Conn) RemoveNamespaceLimit(ctx context.Context, name, limit string) error {
	qualified, err := c.qualifyNamespace(name)
	if err != nil {
		return err
	}
	namespaces := c.admin.Namespaces()

	switch limit {
	case LimitMessageTTLSeconds:
		err = namespaces.RemoveNamespaceMessageTTLWithContext(ctx, qualified)
	case LimitRetentionTimeMinutes, LimitRetentionSizeMB:
		// Retention is one policy with two fields, so there is no way to
		// remove half of it. Removing either removes the pair, which is what
		// the broker offers and what the form has to say it will do.
		err = namespaces.RemoveRetentionWithContext(ctx, qualified)
	case LimitMaxProducersPerTopic, LimitMaxConsumersPerTopic, LimitMaxConsumersPerSubscription:
		err = c.removePerTopicLimit(ctx, qualified, limit)
	default:
		return fmt.Errorf("%q is not a limit a pulsar namespace carries", limit)
	}
	if err != nil {
		return fmt.Errorf("remove %s from namespace %q: %w", limit, qualified, err)
	}
	return nil
}

func (c *Conn) removePerTopicLimit(ctx context.Context, namespace, limit string) error {
	name, err := utils.GetNameSpaceName(tenantOf(namespace), shortNamespaceOf(namespace))
	if err != nil {
		return err
	}
	namespaces := c.admin.Namespaces()

	switch limit {
	case LimitMaxProducersPerTopic:
		return namespaces.RemoveMaxProducersPerTopicWithContext(ctx, *name)
	case LimitMaxConsumersPerTopic:
		return namespaces.RemoveMaxConsumersPerTopicWithContext(ctx, *name)
	default:
		return namespaces.RemoveMaxConsumersPerSubscriptionWithContext(ctx, *name)
	}
}

// qualifyNamespace turns a short name into tenant/namespace, and leaves an
// already-qualified one alone.
func (c *Conn) qualifyNamespace(name string) (string, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return "", fmt.Errorf("a namespace needs a name")
	}
	if strings.Contains(trimmed, "/") {
		if strings.Count(trimmed, "/") != 1 {
			return "", fmt.Errorf("%q is not a tenant/namespace", name)
		}
		return trimmed, nil
	}
	return c.config.Tenant + "/" + trimmed, nil
}

func tenantOf(namespace string) string {
	tenant, _, _ := strings.Cut(namespace, "/")
	return tenant
}

func shortNamespaceOf(namespace string) string {
	_, short, _ := strings.Cut(namespace, "/")
	return short
}
