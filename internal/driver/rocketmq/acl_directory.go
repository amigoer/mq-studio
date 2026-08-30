package rocketmq

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/amigoer/mq-studio/internal/model"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// Broker settings that turn RocketMQ 5.3 authentication on. Both have to be
// true for the store to be worth showing: authentication without
// authorization names identities that no rule ever consults.
const (
	settingAuthentication = "authenticationEnabled"
	settingAuthorization  = "authorizationEnabled"
)

// DirectoryEnabled reports whether this broker runs RocketMQ 5.3 auth.
//
// Read from the broker's own settings rather than probed with a listing: a
// broker that does not know the request code answers with an error, and "this
// broker is on 4.x" is a fact about the cluster rather than a failed call.
func (c *Conn) DirectoryEnabled(ctx context.Context) (bool, error) {
	address, err := c.getBrokerAddress(ctx)
	if err != nil {
		return false, err
	}
	config, err := c.NodeConfig(ctx, address)
	if err != nil {
		return false, err
	}
	return strings.EqualFold(config[settingAuthentication], "true") &&
		strings.EqualFold(config[settingAuthorization], "true"), nil
}

// ListPrincipals returns the users this cluster authenticates.
//
// Read from one master. Each broker holds its own store and a cluster whose
// brokers disagree about who exists has a problem this page cannot show;
// writes go to all of them, which is what keeps them from diverging.
func (c *Conn) ListPrincipals(ctx context.Context) ([]*model.AccessPrincipal, error) {
	address, err := c.getBrokerAddress(ctx)
	if err != nil {
		return nil, err
	}

	var list *admin.UserList
	err = c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
		var callErr error
		list, callErr = retryClient.ListUser(ctx, address)
		return callErr
	})
	if err != nil {
		return nil, fmt.Errorf("获取用户列表失败: %w", err)
	}

	principals := make([]*model.AccessPrincipal, 0, len(list.Users))
	for _, user := range list.Users {
		principals = append(principals, &model.AccessPrincipal{
			Name:   user.Username,
			Type:   user.UserType,
			Status: user.UserStatus,
		})
	}
	sort.Slice(principals, func(left, right int) bool {
		return principals[left].Name < principals[right].Name
	})
	return principals, nil
}

// PutPrincipal creates a user, or updates one that already exists.
//
// Create and update are one call because the caller is editing a row, not
// choosing an RPC: the broker rejects a create for a name it already holds,
// so this tries update first for a principal that is already there.
func (c *Conn) PutPrincipal(ctx context.Context, spec model.AccessPrincipalSpec) error {
	name := strings.TrimSpace(spec.Name)
	if name == "" {
		return fmt.Errorf("用户名不能为空")
	}

	user := admin.UserInfo{
		Username:   name,
		Password:   spec.Secret,
		UserType:   spec.Type,
		UserStatus: spec.Status,
	}
	existing, err := c.principalExists(ctx, name)
	if err != nil {
		return err
	}
	return c.onEveryMaster(ctx, func(ctx context.Context, client *admin.Client, address string) error {
		if existing {
			return client.UpdateUser(ctx, address, user)
		}
		return client.CreateUser(ctx, address, user)
	})
}

// RemovePrincipal deletes a user from every master.
func (c *Conn) RemovePrincipal(ctx context.Context, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("用户名不能为空")
	}
	return c.onEveryMaster(ctx, func(ctx context.Context, client *admin.Client, address string) error {
		return client.DeleteUser(ctx, address, name)
	})
}

// ListAccessRules returns every subject's policies.
func (c *Conn) ListAccessRules(ctx context.Context) ([]*model.AccessRule, error) {
	address, err := c.getBrokerAddress(ctx)
	if err != nil {
		return nil, err
	}

	var list *admin.AclList
	err = c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
		var callErr error
		list, callErr = retryClient.ListAcl(ctx, address)
		return callErr
	})
	if err != nil {
		return nil, fmt.Errorf("获取授权列表失败: %w", err)
	}

	rules := make([]*model.AccessRule, 0, len(list.Acls))
	for _, acl := range list.Acls {
		rules = append(rules, ruleFromAcl(acl))
	}
	sort.Slice(rules, func(left, right int) bool {
		return rules[left].Subject < rules[right].Subject
	})
	return rules, nil
}

// PutAccessRule replaces one subject's policies on every master.
//
// It replaces rather than merges, because that is what the broker does with
// the policy set it is handed - sending one policy for a subject that has
// three leaves it with one.
func (c *Conn) PutAccessRule(ctx context.Context, rule model.AccessRule) error {
	subject := strings.TrimSpace(rule.Subject)
	if subject == "" {
		return fmt.Errorf("授权主体不能为空")
	}

	acl := admin.AclInfo{
		Subject:     subject,
		Description: rule.Description,
		Policies:    make([]admin.AclPolicy, 0, len(rule.Policies)),
	}
	for _, policy := range rule.Policies {
		acl.Policies = append(acl.Policies, admin.AclPolicy{
			Resource:  policy.Resource,
			Actions:   policy.Actions,
			Effect:    policy.Effect,
			SourceIPs: policy.SourceIPs,
		})
	}

	existing, err := c.ruleExists(ctx, subject)
	if err != nil {
		return err
	}
	return c.onEveryMaster(ctx, func(ctx context.Context, client *admin.Client, address string) error {
		if existing {
			return client.UpdateAcl(ctx, address, acl)
		}
		return client.CreateAcl(ctx, address, acl)
	})
}

// RemoveAccessRule drops every policy attached to a subject.
func (c *Conn) RemoveAccessRule(ctx context.Context, subject string) error {
	subject = strings.TrimSpace(subject)
	if subject == "" {
		return fmt.Errorf("授权主体不能为空")
	}
	return c.onEveryMaster(ctx, func(ctx context.Context, client *admin.Client, address string) error {
		return client.DeleteAcl(ctx, address, subject)
	})
}

func ruleFromAcl(acl admin.AclInfo) *model.AccessRule {
	rule := &model.AccessRule{
		Subject:     acl.Subject,
		Description: acl.Description,
		Policies:    make([]model.AccessPolicy, 0, len(acl.Policies)),
	}
	for _, policy := range acl.Policies {
		rule.Policies = append(rule.Policies, model.AccessPolicy{
			Resource:  policy.Resource,
			Actions:   policy.Actions,
			Effect:    policy.Effect,
			SourceIPs: policy.SourceIPs,
			Decision:  policy.Decision,
		})
	}
	return rule
}

func (c *Conn) principalExists(ctx context.Context, name string) (bool, error) {
	principals, err := c.ListPrincipals(ctx)
	if err != nil {
		return false, err
	}
	for _, principal := range principals {
		if principal.Name == name {
			return true, nil
		}
	}
	return false, nil
}

func (c *Conn) ruleExists(ctx context.Context, subject string) (bool, error) {
	rules, err := c.ListAccessRules(ctx)
	if err != nil {
		return false, err
	}
	for _, rule := range rules {
		if rule.Subject == subject {
			return true, nil
		}
	}
	return false, nil
}

// onEveryMaster applies a write to each master in the cluster.
//
// Every broker keeps its own auth store, so a write to one leaves the rest
// authorising by the old rules - which for an access change is the failure
// worth avoiding. It stops at the first refusal rather than carrying on: a
// half-applied change is bad, and a change applied everywhere except the
// broker that refused it is worse than one that stopped and said so.
func (c *Conn) onEveryMaster(
	ctx context.Context,
	apply func(ctx context.Context, client *admin.Client, address string) error,
) error {
	addresses, err := c.masterAddresses(ctx)
	if err != nil {
		return err
	}
	for _, address := range addresses {
		target := address
		err := c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
			return apply(ctx, retryClient, target)
		})
		if err != nil {
			return fmt.Errorf("%s: %w", target, err)
		}
	}
	return nil
}

// masterAddresses returns every master in the cluster, in a stable order.
func (c *Conn) masterAddresses(ctx context.Context) ([]string, error) {
	var clusterInfo *admin.ClusterInfo
	err := c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
		var callErr error
		clusterInfo, callErr = retryClient.ExamineBrokerClusterInfo(ctx)
		return callErr
	})
	if err != nil {
		return nil, fmt.Errorf("获取集群信息失败: %w", err)
	}

	addresses := make([]string, 0, len(clusterInfo.BrokerAddrTable))
	for _, brokerData := range clusterInfo.BrokerAddrTable {
		if brokerData == nil {
			continue
		}
		if address := brokerData.BrokerAddrs["0"]; address != "" {
			addresses = append(addresses, address)
		}
	}
	if len(addresses) == 0 {
		return nil, fmt.Errorf("未找到可用的 Master Broker")
	}
	sort.Strings(addresses)
	return addresses, nil
}
