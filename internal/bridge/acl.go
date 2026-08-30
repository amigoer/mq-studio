package bridge

import (
	"context"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/access"
)

// ACLService exposes access-control administration to the frontend.
type ACLService struct {
	service *access.Service
}

// AccessConfigInput carries an ACL access config form submission.
type AccessConfigInput struct {
	AccessKey          string   `json:"accessKey"`
	SecretKey          string   `json:"secretKey"`
	WhiteRemoteAddress string   `json:"whiteRemoteAddress"`
	IsAdmin            bool     `json:"isAdmin"`
	DefaultTopicPerm   string   `json:"defaultTopicPerm"`
	DefaultGroupPerm   string   `json:"defaultGroupPerm"`
	TopicPerms         []string `json:"topicPerms"`
	GroupPerms         []string `json:"groupPerms"`
}

// Enabled reports whether the broker has ACL turned on.
func (s *ACLService) Enabled(connID int) (bool, error) {
	return s.service.Enabled(context.Background(), connID)
}

// Version returns the broker ACL config version and its entries.
func (s *ACLService) Version(connID int) (*model.AclVersionInfo, error) {
	return s.service.Version(context.Background(), connID)
}

// UpdateAccess creates or replaces an ACL access config entry.
func (s *ACLService) UpdateAccess(connID int, input AccessConfigInput) error {
	return s.service.Put(context.Background(), connID, model.AccessConfig{
		AccessKey:          input.AccessKey,
		SecretKey:          input.SecretKey,
		WhiteRemoteAddress: input.WhiteRemoteAddress,
		IsAdmin:            input.IsAdmin,
		DefaultTopicPerm:   input.DefaultTopicPerm,
		DefaultGroupPerm:   input.DefaultGroupPerm,
		TopicPerms:         input.TopicPerms,
		GroupPerms:         input.GroupPerms,
	})
}

// DeleteAccess removes an ACL access config entry.
func (s *ACLService) DeleteAccess(connID int, accessKey string) error {
	return s.service.Remove(context.Background(), connID, accessKey)
}

// UpdateWhiteAddrs replaces the broker global IP white list.
func (s *ACLService) UpdateWhiteAddrs(connID int, addrs []string) error {
	return s.service.SetAllowList(context.Background(), connID, addrs)
}

// PrincipalInput carries a principal form submission. The secret is
// write-only: the broker stores it hashed and nothing sends it back.
type PrincipalInput struct {
	Name   string `json:"name"`
	Secret string `json:"secret"`
	Type   string `json:"type"`
	Status string `json:"status"`
}

// PolicyInput is one rule row of an access-rule form.
type PolicyInput struct {
	Resource  string   `json:"resource"`
	Actions   []string `json:"actions"`
	Effect    string   `json:"effect"`
	SourceIPs []string `json:"sourceIps"`
}

// AccessRuleInput carries an access-rule form submission.
type AccessRuleInput struct {
	Subject     string        `json:"subject"`
	Description string        `json:"description"`
	Policies    []PolicyInput `json:"policies"`
}

// DirectoryEnabled reports whether the broker runs identity-based access
// control, which is what decides which of the two ACL systems the page shows.
func (s *ACLService) DirectoryEnabled(connID int) (bool, error) {
	return s.service.DirectoryEnabled(context.Background(), connID)
}

// Principals returns the identities the broker authenticates.
func (s *ACLService) Principals(connID int) ([]*model.AccessPrincipal, error) {
	return s.service.Principals(context.Background(), connID)
}

// UpdatePrincipal creates a principal, or updates one that already exists.
func (s *ACLService) UpdatePrincipal(connID int, input PrincipalInput) error {
	return s.service.PutPrincipal(context.Background(), connID, model.AccessPrincipalSpec{
		Name:   input.Name,
		Secret: input.Secret,
		Type:   input.Type,
		Status: input.Status,
	})
}

// DeletePrincipal removes a principal.
func (s *ACLService) DeletePrincipal(connID int, name string) error {
	return s.service.RemovePrincipal(context.Background(), connID, name)
}

// Rules returns every subject's policies.
func (s *ACLService) Rules(connID int) ([]*model.AccessRule, error) {
	return s.service.Rules(context.Background(), connID)
}

// UpdateRule replaces one subject's policies. It replaces rather than merges,
// which is what the broker does with the set it is handed.
func (s *ACLService) UpdateRule(connID int, input AccessRuleInput) error {
	policies := make([]model.AccessPolicy, 0, len(input.Policies))
	for _, policy := range input.Policies {
		policies = append(policies, model.AccessPolicy{
			Resource:  policy.Resource,
			Actions:   policy.Actions,
			Effect:    policy.Effect,
			SourceIPs: policy.SourceIPs,
		})
	}
	return s.service.PutRule(context.Background(), connID, model.AccessRule{
		Subject:     input.Subject,
		Description: input.Description,
		Policies:    policies,
	})
}

// DeleteRule drops every policy attached to a subject.
func (s *ACLService) DeleteRule(connID int, subject string) error {
	return s.service.RemoveRule(context.Background(), connID, subject)
}
