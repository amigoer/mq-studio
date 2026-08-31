package kafka

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/twmb/franz-go/pkg/kadm"

	"github.com/amigoer/mq-studio/internal/model"
)

// The entity dimensions Kafka quotas are attached to.
const (
	QuotaUser     = "user"
	QuotaClientID = "client-id"
	QuotaIP       = "ip"
)

// KnownQuotaEntityTypes lists the dimensions a form may offer, in the order
// Kafka resolves them.
func KnownQuotaEntityTypes() []string {
	return []string{QuotaUser, QuotaClientID, QuotaIP}
}

/*
 * KnownQuotaLimits are the keys the form offers by name.
 *
 * Not a closed set: AlterQuota passes through whatever key it is given,
 * because a cluster knows keys this build has never heard of and refusing them
 * would make the page less capable than kafka-configs.sh. These are the four
 * worth naming.
 */
func KnownQuotaLimits() []string {
	return []string{
		"producer_byte_rate",
		"consumer_byte_rate",
		"request_percentage",
		"controller_mutation_rate",
	}
}

/*
 * ListQuotas reports every client quota the cluster holds.
 *
 * No filter at all, which is the one form that answers the question. Naming
 * the entity types looks like the obvious way to ask and is not: a filter
 * combining an IP component with a user or client-id one is refused outright
 * with INVALID_REQUEST, because network quotas are a separate namespace from
 * the ones attached to an identity - and asking for a single type non-strictly
 * comes back empty. An empty component list means "every entity", which is
 * what a listing wants and costs one request rather than three.
 */
func (c *Conn) ListQuotas(ctx context.Context) ([]*model.ClientQuota, error) {
	described, err := c.admin.DescribeClientQuotas(ctx, false, nil)
	if err != nil {
		return nil, err
	}

	quotas := make([]*model.ClientQuota, 0, len(described))
	for _, quota := range described {
		quotas = append(quotas, quotaFrom(quota))
	}
	sort.Slice(quotas, func(i, j int) bool {
		return quotaKey(quotas[i]) < quotaKey(quotas[j])
	})
	return quotas, nil
}

func quotaFrom(described kadm.DescribedClientQuota) *model.ClientQuota {
	entity := make([]model.QuotaEntity, 0, len(described.Entity))
	for _, component := range described.Entity {
		one := model.QuotaEntity{Type: component.Type}
		if component.Name == nil {
			// A null name is the default every unmatched client of this type
			// inherits, which is not the same as a name that happens to be
			// empty - and the two must not render alike.
			one.Default = true
		} else {
			one.Name = *component.Name
		}
		entity = append(entity, one)
	}
	sort.Slice(entity, func(i, j int) bool { return entity[i].Type < entity[j].Type })

	limits := make(map[string]float64, len(described.Values))
	for _, value := range described.Values {
		limits[value.Key] = value.Value
	}
	return &model.ClientQuota{Entity: entity, Limits: limits}
}

// quotaKey is a stable identity for a quota, so the list does not reshuffle
// between refreshes and a page can match a row it is editing.
func quotaKey(quota *model.ClientQuota) string {
	parts := make([]string, 0, len(quota.Entity))
	for _, component := range quota.Entity {
		if component.Default {
			parts = append(parts, component.Type+"=<default>")
			continue
		}
		parts = append(parts, component.Type+"="+component.Name)
	}
	return strings.Join(parts, ",")
}

/*
 * AlterQuota sets or removes limits on one entity.
 *
 * A limit given is set; a limit named with no value is removed. Removing is
 * not the same as setting zero: zero is a real quota that throttles a client
 * to nothing, and an operator who meant "no limit" and got that would have
 * stopped the thing they were trying to unblock.
 */
func (c *Conn) AlterQuota(
	ctx context.Context, entity []model.QuotaEntity, set map[string]float64, remove []string,
) error {
	if len(entity) == 0 {
		return fmt.Errorf("a quota needs an entity: a user, a client id or an IP address")
	}
	if len(set) == 0 && len(remove) == 0 {
		return fmt.Errorf("nothing to set or remove")
	}

	// Kafka refuses an entity combining an IP with an identity, and answers
	// INVALID_REQUEST without saying why. Refusing it here names the problem.
	if err := checkQuotaEntityCombination(entity); err != nil {
		return err
	}

	components := make(kadm.ClientQuotaEntity, 0, len(entity))
	for _, one := range entity {
		if !isKnownQuotaEntity(one.Type) {
			return fmt.Errorf("unknown quota entity type %q", one.Type)
		}
		component := kadm.ClientQuotaEntityComponent{Type: one.Type}
		if !one.Default {
			if strings.TrimSpace(one.Name) == "" {
				return fmt.Errorf("a %s quota needs a name, or the default flag", one.Type)
			}
			name := one.Name
			component.Name = &name
		}
		components = append(components, component)
	}

	ops := make([]kadm.AlterClientQuotaOp, 0, len(set)+len(remove))
	keys := make([]string, 0, len(set))
	for key := range set {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		ops = append(ops, kadm.AlterClientQuotaOp{Key: key, Value: set[key]})
	}
	for _, key := range remove {
		ops = append(ops, kadm.AlterClientQuotaOp{Key: key, Remove: true})
	}

	altered, err := c.admin.AlterClientQuotas(ctx, []kadm.AlterClientQuotaEntry{{
		Entity: components, Ops: ops,
	}})
	if err != nil {
		return err
	}
	for _, one := range altered {
		if one.Err != nil {
			if one.ErrMessage != "" {
				return fmt.Errorf("%w: %s", one.Err, one.ErrMessage)
			}
			return one.Err
		}
	}

	c.awaitQuota(ctx, entity, set, remove)
	return nil
}

/*
 * awaitQuota waits until the change is readable.
 *
 * A quota alter is accepted by the controller and propagates a moment later,
 * like everything else on a Kafka cluster - and a board that refreshes on
 * success would show the old value and invite the operator to save again.
 *
 * Best effort and bounded. If the cluster is still catching up when time runs
 * out the change has still been accepted, so the caller reports success rather
 * than a failure that did not happen.
 */
func (c *Conn) awaitQuota(
	ctx context.Context, entity []model.QuotaEntity, set map[string]float64, remove []string,
) {
	wanted := quotaKey(&model.ClientQuota{Entity: sortedEntity(entity)})
	deadline := time.Now().Add(propagationLimit)
	for {
		if c.quotaMatches(ctx, wanted, set, remove) {
			return
		}
		if time.Now().After(deadline) {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(25 * time.Millisecond):
		}
	}
}

func (c *Conn) quotaMatches(
	ctx context.Context, wanted string, set map[string]float64, remove []string,
) bool {
	quotas, err := c.ListQuotas(ctx)
	if err != nil {
		return false
	}

	var found *model.ClientQuota
	for _, quota := range quotas {
		if quotaKey(quota) == wanted {
			found = quota
		}
	}
	// An entity with every limit removed disappears entirely, which is the
	// wanted outcome rather than a read that failed.
	if found == nil {
		return len(set) == 0
	}
	for key, value := range set {
		if found.Limits[key] != value {
			return false
		}
	}
	for _, key := range remove {
		if _, present := found.Limits[key]; present {
			return false
		}
	}
	return true
}

// sortedEntity puts the components in the order quotaFrom produces, so a key
// built from a request matches one built from a response.
func sortedEntity(entity []model.QuotaEntity) []model.QuotaEntity {
	out := append([]model.QuotaEntity(nil), entity...)
	sort.Slice(out, func(i, j int) bool { return out[i].Type < out[j].Type })
	return out
}

// RemoveQuota clears every limit on an entity, which is how a quota stops
// existing: Kafka has no delete, only a set of removals.
func (c *Conn) RemoveQuota(ctx context.Context, entity []model.QuotaEntity, keys []string) error {
	if len(keys) == 0 {
		return fmt.Errorf("a quota with no limits is already gone")
	}
	return c.AlterQuota(ctx, entity, nil, keys)
}

/*
 * checkQuotaEntityCombination enforces Kafka's own rule about the dimensions.
 *
 * A user quota and a client-id quota compose - "this application, run by this
 * user" is a real limit. An IP quota does not compose with either: it throttles
 * connections before anybody has authenticated, so there is no user to combine
 * it with, and Kafka answers INVALID_REQUEST rather than explaining that.
 */
func checkQuotaEntityCombination(entity []model.QuotaEntity) error {
	hasIP := false
	hasIdentity := false
	for _, one := range entity {
		switch one.Type {
		case QuotaIP:
			hasIP = true
		case QuotaUser, QuotaClientID:
			hasIdentity = true
		}
	}
	if hasIP && hasIdentity {
		return fmt.Errorf(
			"an IP quota throttles connections before anyone authenticates, so it cannot be combined with a user or client id")
	}
	return nil
}

func isKnownQuotaEntity(kind string) bool {
	for _, known := range KnownQuotaEntityTypes() {
		if known == kind {
			return true
		}
	}
	return false
}
