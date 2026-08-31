package kafka

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kerr"
	"github.com/twmb/franz-go/pkg/kmsg"

	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * Kafka's access control is two systems on one cluster, and this port is
 * shaped for exactly that: principals the cluster authenticates, and rules
 * attached to a subject.
 *
 * The principals are SCRAM users - the only identity store Kafka keeps itself.
 * A cluster authenticating over mTLS or Kerberos has principals it never
 * stores, and they show up in the rules without appearing in the user list,
 * which is the truth rather than an omission.
 */

// Resource prefixes used in a policy's Resource field, so a page can tell a
// topic rule from a group rule without a second field.
const (
	resourceTopic       = "topic"
	resourceGroup       = "group"
	resourceCluster     = "cluster"
	resourceTransaction = "transactionalId"
	resourceToken       = "delegationToken"
	resourceUser        = "user"
)

// anyHost is what Kafka stores when a rule applies from anywhere.
const anyHost = "*"

// scramIterations is Kafka's own default. The broker refuses anything below
// 4096, and the client sends zero unless it is told a number.
const scramIterations = 4096

/*
 * DirectoryEnabled reports whether this cluster has an authorizer at all.
 *
 * A cluster with none answers SECURITY_DISABLED to every ACL call. That is a
 * deployment choice rather than a failure, so it comes back as false and the
 * page says which system is on - instead of an error that reads like the
 * cluster is broken.
 */
func (c *Conn) DirectoryEnabled(ctx context.Context) (bool, error) {
	results, err := c.admin.DescribeACLs(ctx, everyACL())
	if err != nil {
		if errors.Is(err, kerr.SecurityDisabled) {
			return false, nil
		}
		return false, err
	}
	// The refusal arrives per filter, not as a top-level error: a describe
	// against a cluster with no authorizer succeeds and every result inside it
	// says SECURITY_DISABLED. Reading only the outer error reported the page
	// as available and then failed the moment it was opened.
	for _, result := range results {
		if result.Err == nil {
			continue
		}
		if errors.Is(result.Err, kerr.SecurityDisabled) {
			return false, nil
		}
		return false, result.Err
	}
	return true, nil
}

// everyACL is the filter that matches all of them, which is what both the
// listing and the availability probe want.
func everyACL() *kadm.ACLBuilder {
	return kadm.NewACLs().
		AnyResource().
		ResourcePatternType(kadm.ACLPatternAny).
		Operations(kadm.OpAny).
		Allow().Deny().AllowHosts().DenyHosts()
}

// ListPrincipals reports the SCRAM users the cluster stores.
func (c *Conn) ListPrincipals(ctx context.Context) ([]*model.AccessPrincipal, error) {
	described, err := c.admin.DescribeUserSCRAMs(ctx)
	if err != nil {
		return nil, err
	}

	principals := make([]*model.AccessPrincipal, 0, len(described))
	for _, user := range described.Sorted() {
		if user.Err != nil {
			continue
		}
		principals = append(principals, &model.AccessPrincipal{
			Name: user.User,
			// The mechanisms a password exists for, which is the useful fact:
			// a user with only SHA-256 fails against a SHA-512 listener, and
			// that failure looks exactly like a wrong password.
			Type:   mechanismsOf(user),
			Status: "enabled",
		})
	}
	return principals, nil
}

func mechanismsOf(user kadm.DescribedUserSCRAM) string {
	names := make([]string, 0, len(user.CredInfos))
	for _, info := range user.CredInfos {
		names = append(names, info.Mechanism.String())
	}
	sort.Strings(names)
	return strings.Join(names, ", ")
}

/*
 * PutPrincipal creates or updates a SCRAM user.
 *
 * The mechanism travels in Type because that is where the form puts it, and a
 * SCRAM user is not one credential but one per mechanism: creating a user
 * without saying which is a request the cluster cannot answer.
 */
func (c *Conn) PutPrincipal(ctx context.Context, spec model.AccessPrincipalSpec) error {
	if strings.TrimSpace(spec.Name) == "" {
		return fmt.Errorf("a user name is required")
	}
	if spec.Secret == "" {
		return fmt.Errorf("a password is required; kafka stores it salted and cannot be asked for it later")
	}
	mechanism, err := scramMechanism(spec.Type)
	if err != nil {
		return err
	}

	altered, err := c.admin.AlterUserSCRAMs(ctx, nil, []kadm.UpsertSCRAM{{
		User:      spec.Name,
		Mechanism: mechanism,
		// Kafka refuses anything below 4096 with "too few iterations", and the
		// client sends zero unless told. This is Kafka's own default rather
		// than a number picked here: raising it is a cluster-wide policy
		// decision, not something a create form should make quietly.
		Iterations: scramIterations,
		Password:   spec.Secret,
	}})
	if err != nil {
		return err
	}
	if err := firstSCRAMError(altered); err != nil {
		return err
	}
	c.awaitPrincipal(ctx, spec.Name, true)
	return nil
}

/*
 * awaitPrincipal waits for the cluster to agree that a user does or does not
 * exist.
 *
 * A credential is written to the metadata log and read back from whichever
 * broker answers, and the two are not the same instant: a user created and
 * immediately listed came back missing under load. Bounded, and silent when
 * the bound is reached - the alter succeeded either way, and refusing to
 * return would turn a slow cluster into a failed write.
 */
func (c *Conn) awaitPrincipal(ctx context.Context, name string, want bool) {
	deadline := time.Now().Add(propagationLimit)
	for {
		described, err := c.admin.DescribeUserSCRAMs(ctx, name)
		if err == nil {
			user, listed := described[name]
			if exists := listed && user.Err == nil && len(user.CredInfos) > 0; exists == want {
				return
			}
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

// RemovePrincipal deletes a user's password for every mechanism it has.
//
// Every mechanism, because a user is only gone once none is left: deleting one
// leaves an account that still authenticates over the other listener.
func (c *Conn) RemovePrincipal(ctx context.Context, name string) error {
	described, err := c.admin.DescribeUserSCRAMs(ctx, name)
	if err != nil {
		return err
	}
	user, ok := described[name]
	if !ok || user.Err != nil {
		return fmt.Errorf("no such user: %s", name)
	}

	deletes := make([]kadm.DeleteSCRAM, 0, len(user.CredInfos))
	for _, info := range user.CredInfos {
		deletes = append(deletes, kadm.DeleteSCRAM{User: name, Mechanism: info.Mechanism})
	}
	if len(deletes) == 0 {
		return nil
	}

	altered, err := c.admin.AlterUserSCRAMs(ctx, deletes, nil)
	if err != nil {
		return err
	}
	if err := firstSCRAMError(altered); err != nil {
		return err
	}
	c.awaitPrincipal(ctx, name, false)
	return nil
}

func scramMechanism(name string) (kadm.ScramMechanism, error) {
	switch strings.ToUpper(strings.TrimSpace(name)) {
	case "SCRAM-SHA-256", "256":
		return kadm.ScramSha256, nil
	case "", "SCRAM-SHA-512", "512":
		return kadm.ScramSha512, nil
	default:
		return 0, fmt.Errorf("unsupported SCRAM mechanism %q", name)
	}
}

func firstSCRAMError(altered kadm.AlteredUserSCRAMs) error {
	for _, one := range altered {
		if one.Err != nil {
			if one.ErrMessage != "" {
				return fmt.Errorf("%w: %s", one.Err, one.ErrMessage)
			}
			return one.Err
		}
	}
	return nil
}

/*
 * ListAccessRules reports the cluster's ACLs, grouped by principal.
 *
 * Grouped because that is the question being asked: "what may this service
 * do" is answered by one subject's rules together, and Kafka stores them as a
 * flat list of one operation on one resource each.
 */
func (c *Conn) ListAccessRules(ctx context.Context) ([]*model.AccessRule, error) {
	results, err := c.admin.DescribeACLs(ctx, everyACL())
	if err != nil {
		return nil, err
	}

	bySubject := make(map[string][]model.AccessPolicy)
	for _, result := range results {
		if result.Err != nil {
			return nil, result.Err
		}
		for _, described := range result.Described {
			bySubject[described.Principal] = append(
				bySubject[described.Principal], policyFrom(described))
		}
	}

	subjects := make([]string, 0, len(bySubject))
	for subject := range bySubject {
		subjects = append(subjects, subject)
	}
	sort.Strings(subjects)

	rules := make([]*model.AccessRule, 0, len(subjects))
	for _, subject := range subjects {
		policies := bySubject[subject]
		sort.Slice(policies, func(i, j int) bool {
			if policies[i].Resource != policies[j].Resource {
				return policies[i].Resource < policies[j].Resource
			}
			return strings.Join(policies[i].Actions, ",") < strings.Join(policies[j].Actions, ",")
		})
		rules = append(rules, &model.AccessRule{Subject: subject, Policies: policies})
	}
	return rules, nil
}

func policyFrom(described kadm.DescribedACL) model.AccessPolicy {
	policy := model.AccessPolicy{
		Resource: resourceLabel(described),
		Actions:  []string{described.Operation.String()},
		Effect:   effectOf(described.Permission),
	}
	// A host of * is "from anywhere", which is the default and not worth
	// listing: an empty SourceIPs already means that.
	if described.Host != "" && described.Host != anyHost {
		policy.SourceIPs = []string{described.Host}
	}
	return policy
}

// resourceLabel names what a rule is about, prefixed by its kind so a topic
// called "orders" and a group called "orders" cannot be confused.
//
// A prefixed pattern keeps its trailing star: "topic:orders.*" and
// "topic:orders" are different rules and must not read the same.
func resourceLabel(described kadm.DescribedACL) string {
	kind := resourceKind(described.Type)
	name := described.Name
	if described.Pattern == kadm.ACLPatternPrefixed {
		name += "*"
	}
	if kind == resourceCluster {
		return kind
	}
	return kind + ":" + name
}

func resourceKind(kind kmsg.ACLResourceType) string {
	switch kind {
	case kmsg.ACLResourceTypeTopic:
		return resourceTopic
	case kmsg.ACLResourceTypeGroup:
		return resourceGroup
	case kmsg.ACLResourceTypeCluster:
		return resourceCluster
	case kmsg.ACLResourceTypeTransactionalId:
		return resourceTransaction
	case kmsg.ACLResourceTypeDelegationToken:
		return resourceToken
	case kmsg.ACLResourceTypeUser:
		return resourceUser
	default:
		return strings.ToLower(kind.String())
	}
}

func effectOf(permission kmsg.ACLPermissionType) string {
	if permission == kmsg.ACLPermissionTypeDeny {
		return "Deny"
	}
	return "Allow"
}

/*
 * PutAccessRule writes every policy a subject should have.
 *
 * Kafka has no update: an ACL exists or it does not. Writing a subject's rules
 * therefore means creating what the form now holds, and the caller removes
 * what it no longer wants - which is why the board edits a whole subject at a
 * time rather than one line.
 */
func (c *Conn) PutAccessRule(ctx context.Context, rule model.AccessRule) error {
	if strings.TrimSpace(rule.Subject) == "" {
		return fmt.Errorf("a principal is required, such as User:alice")
	}
	if len(rule.Policies) == 0 {
		return fmt.Errorf("a rule with no policies grants nothing; delete the subject instead")
	}

	for _, policy := range rule.Policies {
		builder, err := builderFor(rule.Subject, policy)
		if err != nil {
			return err
		}
		results, err := c.admin.CreateACLs(ctx, builder)
		if err != nil {
			return err
		}
		for _, result := range results {
			if result.Err != nil {
				return result.Err
			}
		}
	}
	c.awaitAccessRule(ctx, rule.Subject, true)
	return nil
}

/*
 * awaitAccessRule waits for the cluster to agree that a subject does or does
 * not have rules.
 *
 * The same lag as a credential, for the same reason: an authorizer writes its
 * rules to the metadata log and a describe is answered by whichever broker
 * took the request. A page that wrote a rule and immediately listed showed the
 * list without it, which reads as a write that did nothing.
 *
 * Bounded, and silent at the bound: the write succeeded either way, and a
 * cluster still catching up is not a failed create.
 */
func (c *Conn) awaitAccessRule(ctx context.Context, subject string, want bool) {
	deadline := time.Now().Add(propagationLimit)
	for {
		rules, err := c.ListAccessRules(ctx)
		if err == nil {
			listed := false
			for _, rule := range rules {
				if rule.Subject == subject {
					listed = true
				}
			}
			if listed == want {
				return
			}
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

// RemoveAccessRule deletes every ACL belonging to a principal.
func (c *Conn) RemoveAccessRule(ctx context.Context, subject string) error {
	if strings.TrimSpace(subject) == "" {
		return fmt.Errorf("a principal is required")
	}
	builder := kadm.NewACLs().
		AnyResource().
		ResourcePatternType(kadm.ACLPatternAny).
		Operations(kadm.OpAny).
		Allow(subject).Deny(subject).AllowHosts().DenyHosts()

	results, err := c.admin.DeleteACLs(ctx, builder)
	if err != nil {
		return err
	}
	for _, result := range results {
		if result.Err != nil {
			return result.Err
		}
	}
	c.awaitAccessRule(ctx, subject, false)
	return nil
}

// builderFor turns one policy into the ACL the cluster stores.
func builderFor(subject string, policy model.AccessPolicy) (*kadm.ACLBuilder, error) {
	operations, err := operationsOf(policy.Actions)
	if err != nil {
		return nil, err
	}
	hosts := policy.SourceIPs
	if len(hosts) == 0 {
		hosts = []string{anyHost}
	}

	builder := kadm.NewACLs().Operations(operations...)
	if strings.EqualFold(policy.Effect, "Deny") {
		builder = builder.Deny(subject).DenyHosts(hosts...)
	} else {
		builder = builder.Allow(subject).AllowHosts(hosts...)
	}

	kind, name, prefixed := splitResource(policy.Resource)
	if prefixed {
		builder = builder.ResourcePatternType(kadm.ACLPatternPrefixed)
	} else {
		builder = builder.ResourcePatternType(kadm.ACLPatternLiteral)
	}

	switch kind {
	case resourceTopic:
		builder = builder.Topics(name)
	case resourceGroup:
		builder = builder.Groups(name)
	case resourceCluster:
		builder = builder.Clusters()
	case resourceTransaction:
		builder = builder.TransactionalIDs(name)
	case resourceToken:
		builder = builder.DelegationTokens(name)
	default:
		return nil, fmt.Errorf("unknown resource %q", policy.Resource)
	}

	if err := builder.ValidateCreate(); err != nil {
		return nil, err
	}
	return builder, nil
}

// splitResource reads "topic:orders*" back into its parts.
func splitResource(resource string) (kind, name string, prefixed bool) {
	resource = strings.TrimSpace(resource)
	if resource == resourceCluster {
		return resourceCluster, "kafka-cluster", false
	}
	separator := strings.Index(resource, ":")
	if separator < 0 {
		return "", "", false
	}
	kind = resource[:separator]
	name = resource[separator+1:]
	if strings.HasSuffix(name, "*") && len(name) > 1 {
		return kind, strings.TrimSuffix(name, "*"), true
	}
	return kind, name, false
}

// operationsOf maps the verbs a form collects onto Kafka's own.
func operationsOf(actions []string) ([]kadm.ACLOperation, error) {
	if len(actions) == 0 {
		return nil, fmt.Errorf("at least one operation is required")
	}
	operations := make([]kadm.ACLOperation, 0, len(actions))
	for _, action := range actions {
		operation, ok := knownOperations[strings.ToUpper(strings.TrimSpace(action))]
		if !ok {
			return nil, fmt.Errorf("unknown operation %q", action)
		}
		operations = append(operations, operation)
	}
	return operations, nil
}

/*
 * The operations a form may ask for.
 *
 * A closed set rather than whatever string arrives: these grant access, and
 * what the UI can write has to be enumerable and reviewable. CLUSTER_ACTION is
 * deliberately absent - it is for brokers talking to each other, and nothing a
 * person does needs it.
 */
var knownOperations = map[string]kadm.ACLOperation{
	"ALL":              kadm.OpAll,
	"READ":             kadm.OpRead,
	"WRITE":            kadm.OpWrite,
	"CREATE":           kadm.OpCreate,
	"DELETE":           kadm.OpDelete,
	"ALTER":            kadm.OpAlter,
	"DESCRIBE":         kadm.OpDescribe,
	"DESCRIBE_CONFIGS": kadm.OpDescribeConfigs,
	"ALTER_CONFIGS":    kadm.OpAlterConfigs,
	"IDEMPOTENT_WRITE": kadm.OpIdempotentWrite,
}

// KnownACLOperations lists the verbs a form may offer, sorted.
func KnownACLOperations() []string {
	names := make([]string, 0, len(knownOperations))
	for name := range knownOperations {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

// KnownACLResourceKinds lists the resource kinds a rule may name.
func KnownACLResourceKinds() []string {
	return []string{resourceTopic, resourceGroup, resourceCluster, resourceTransaction}
}
