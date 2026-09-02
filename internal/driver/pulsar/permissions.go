package pulsar

import (
	"context"
	"fmt"
	"sort"

	"github.com/apache/pulsar-client-go/pulsaradmin/pkg/utils"

	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * How Pulsar's grants map onto the canonical permission model.
 *
 * Pulsar authorises a *role*, not a user. The role arrives inside the token -
 * it is the JWT's subject - and the cluster keeps no directory of them: a
 * grant names a role that may not exist yet and will still be honoured when a
 * token carrying it turns up. That is why this driver implements
 * IdentityPermissions and refuses IdentityList and IdentityAdmin: there are
 * grants to read and write, and nothing to enumerate them from.
 *
 * The actions are Pulsar's six, and they fold onto the model's three:
 *
 *   - produce  -> Write, and consume -> Read. Those are exact.
 *   - functions, sources, sinks and packages -> Configure. All four are
 *     "may deploy things into this namespace", which is what Configure means
 *     on every family that has it, and none of them is a publish or a read.
 *
 * The fold is lossy in one direction, and deliberately: granting Configure
 * grants all four, because a UI with four checkboxes for what an operator
 * thinks of as one permission is worse than one that grants slightly more than
 * asked. The read direction is exact - Configure is reported set only when a
 * configure action is present.
 */
const (
	permissionAllow = "allow"
	permissionNone  = ""
)

// configureActions are the four that fold into Configure.
func configureActions() []utils.AuthAction {
	actions := make([]utils.AuthAction, 0, 4)
	for _, name := range []string{"functions", "sources", "sinks", "packages"} {
		if action, err := utils.ParseAuthAction(name); err == nil {
			actions = append(actions, action)
		}
	}
	return actions
}

// authActions builds Pulsar's action list from the canonical three.
func authActions(configure, write, read string) ([]utils.AuthAction, error) {
	actions := make([]utils.AuthAction, 0, 6)
	if write == permissionAllow {
		action, err := utils.ParseAuthAction("produce")
		if err != nil {
			return nil, err
		}
		actions = append(actions, action)
	}
	if read == permissionAllow {
		action, err := utils.ParseAuthAction("consume")
		if err != nil {
			return nil, err
		}
		actions = append(actions, action)
	}
	if configure == permissionAllow {
		actions = append(actions, configureActions()...)
	}
	return actions, nil
}

// permissionOf folds Pulsar's actions back into the canonical three.
func permissionOf(actions []utils.AuthAction) (configure, write, read string) {
	for _, action := range actions {
		switch action.String() {
		case "produce":
			write = permissionAllow
		case "consume":
			read = permissionAllow
		case "functions", "sources", "sinks", "packages":
			configure = permissionAllow
		}
	}
	return configure, write, read
}

/*
 * SetPermission grants a role access to a namespace.
 *
 * Pulsar's grant replaces the whole action list for that role rather than
 * adding to it, so a call with no actions at all would silently revoke - which
 * is a different button. Refusing here keeps the two gestures distinct.
 */
func (c *Conn) SetPermission(ctx context.Context, permission model.NamespacePermission) error {
	namespace, err := c.namespaceName(permission.Namespace)
	if err != nil {
		return err
	}
	if permission.Identity == "" {
		return fmt.Errorf("a grant needs a role")
	}
	actions, err := authActions(permission.Configure, permission.Write, permission.Read)
	if err != nil {
		return err
	}
	if len(actions) == 0 {
		return fmt.Errorf(
			"a grant with no permission would revoke the role's access; use revoke instead")
	}
	if err := c.admin.Namespaces().GrantNamespacePermissionWithContext(
		ctx, *namespace, permission.Identity, actions); err != nil {
		return fmt.Errorf("grant %s on %s: %w", permission.Identity, permission.Namespace, err)
	}
	return nil
}

// RemovePermission revokes a role's access to a namespace entirely.
func (c *Conn) RemovePermission(ctx context.Context, namespace, identity string) error {
	name, err := c.namespaceName(namespace)
	if err != nil {
		return err
	}
	if err := c.admin.Namespaces().RevokeNamespacePermissionWithContext(
		ctx, *name, identity); err != nil {
		return fmt.Errorf("revoke %s on %s: %w", identity, namespace, err)
	}
	return nil
}

/*
 * ListTopicPermissions is every per-topic grant in the connection's namespace.
 *
 * A topic grant is narrower than a namespace one and is read separately
 * because Pulsar stores it separately: the namespace's own permissions come
 * back with its policies, and each topic's come from its own endpoint. So this
 * costs a request per topic and is bounded like every other walk here.
 */
func (c *Conn) ListTopicPermissions(ctx context.Context) ([]*model.TopicPermission, error) {
	namespace := c.config.scope()
	name, err := utils.GetNamespaceName(namespace)
	if err != nil {
		return nil, fmt.Errorf("read the namespace %q: %w", namespace, err)
	}

	partitioned, nonPartitioned, err := c.admin.Topics().ListWithContext(ctx, *name)
	if err != nil {
		return nil, fmt.Errorf("list the topics of %q: %w", namespace, err)
	}
	urls := append(append([]string{}, partitioned...), nonPartitioned...)
	sort.Strings(urls)
	if len(urls) > listCap {
		urls = urls[:listCap]
	}

	permissions := make([]*model.TopicPermission, 0)
	for _, url := range urls {
		topic, err := utils.GetTopicName(url)
		if err != nil {
			continue
		}
		grants, err := c.admin.Topics().GetPermissionsWithContext(ctx, *topic)
		if err != nil {
			continue
		}
		roles := make([]string, 0, len(grants))
		for role := range grants {
			roles = append(roles, role)
		}
		sort.Strings(roles)
		for _, role := range roles {
			_, write, read := permissionOf(grants[role])
			permissions = append(permissions, &model.TopicPermission{
				Namespace: namespace,
				Identity:  role,
				// Exchange is the model's field for "which object within the
				// namespace". On this family that is the topic.
				Exchange: url,
				Write:    write,
				Read:     read,
			})
		}
	}
	return permissions, nil
}

/*
 * SetTopicPermission grants a role access to one topic.
 *
 * There is no Configure at this level, and that is Pulsar's own shape rather
 * than a gap: functions, sinks and packages are deployed into a namespace, not
 * into a topic, so a topic grant is produce and consume only.
 */
func (c *Conn) SetTopicPermission(ctx context.Context, permission model.TopicPermission) error {
	if permission.Identity == "" {
		return fmt.Errorf("a grant needs a role")
	}
	url, err := c.resolveTopicURL(permission.Exchange)
	if err != nil {
		return err
	}
	topic, err := utils.GetTopicName(url)
	if err != nil {
		return err
	}
	actions, err := authActions(permissionNone, permission.Write, permission.Read)
	if err != nil {
		return err
	}
	if len(actions) == 0 {
		return fmt.Errorf(
			"a grant with no permission would revoke the role's access; use revoke instead")
	}
	if err := c.admin.Topics().GrantPermissionWithContext(
		ctx, *topic, permission.Identity, actions); err != nil {
		return fmt.Errorf("grant %s on %s: %w", permission.Identity, url, err)
	}
	return nil
}

/*
 * RemoveTopicPermission revokes a role's access to one topic.
 *
 * The port's first argument is a namespace on the family it was written for.
 * Here it is the topic, because that is what a per-topic grant is attached to
 * - a namespace-wide revoke is RemovePermission, and the two are different
 * operations rather than the same one at two scopes.
 */
func (c *Conn) RemoveTopicPermission(ctx context.Context, topicURL, identity string) error {
	url, err := c.resolveTopicURL(topicURL)
	if err != nil {
		return err
	}
	topic, err := utils.GetTopicName(url)
	if err != nil {
		return err
	}
	if err := c.admin.Topics().RevokePermissionWithContext(ctx, *topic, identity); err != nil {
		return fmt.Errorf("revoke %s on %s: %w", identity, url, err)
	}
	return nil
}

// NamespacePermissions is every role granted access to a namespace.
//
// Not on IdentityPermissions - the port reads permissions off an Identity, and
// this family has no identities to read them off - so the Tokens board asks
// for them through PulsarService instead.
func (c *Conn) NamespacePermissions(
	ctx context.Context, namespace string,
) ([]*model.NamespacePermission, error) {
	scope := c.namespaceScope(namespace)
	name, err := utils.GetNamespaceName(scope)
	if err != nil {
		return nil, fmt.Errorf("read the namespace %q: %w", scope, err)
	}

	grants, err := c.admin.Namespaces().GetNamespacePermissionsWithContext(ctx, *name)
	if err != nil {
		return nil, fmt.Errorf("read the permissions of %q: %w", scope, err)
	}

	roles := make([]string, 0, len(grants))
	for role := range grants {
		roles = append(roles, role)
	}
	sort.Strings(roles)

	permissions := make([]*model.NamespacePermission, 0, len(roles))
	for _, role := range roles {
		configure, write, read := permissionOf(grants[role])
		permissions = append(permissions, &model.NamespacePermission{
			Namespace: scope,
			Identity:  role,
			Configure: configure,
			Write:     write,
			Read:      read,
		})
	}
	return permissions, nil
}

func (c *Conn) namespaceName(namespace string) (*utils.NameSpaceName, error) {
	scope := c.namespaceScope(namespace)
	name, err := utils.GetNamespaceName(scope)
	if err != nil {
		return nil, fmt.Errorf("read the namespace %q: %w", scope, err)
	}
	return name, nil
}
