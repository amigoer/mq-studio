package bridge

import (
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/acl"
)

// ACLService exposes broker ACL administration to the frontend.
type ACLService struct {
	service *acl.Service
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
func (s *ACLService) Enabled() (bool, error) {
	return s.service.GetAclEnabled()
}

// Version returns the broker ACL config version and its entries.
func (s *ACLService) Version() (*model.AclVersionInfo, error) {
	return s.service.GetAclVersion()
}

// UpdateAccess creates or replaces an ACL access config entry.
func (s *ACLService) UpdateAccess(input AccessConfigInput) error {
	return s.service.CreateOrUpdateAccessConfig(input.AccessKey, input.SecretKey,
		input.WhiteRemoteAddress, input.IsAdmin, input.DefaultTopicPerm,
		input.DefaultGroupPerm, input.TopicPerms, input.GroupPerms)
}

// DeleteAccess removes an ACL access config entry.
func (s *ACLService) DeleteAccess(accessKey string) error {
	return s.service.DeleteAccessConfig(accessKey)
}

// UpdateWhiteAddrs replaces the broker global IP white list.
func (s *ACLService) UpdateWhiteAddrs(addrs []string) error {
	return s.service.UpdateGlobalWhiteAddrs(addrs)
}
