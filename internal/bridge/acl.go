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
func (s *ACLService) Enabled() (bool, error) {
	return s.service.Enabled(context.Background())
}

// Version returns the broker ACL config version and its entries.
func (s *ACLService) Version() (*model.AclVersionInfo, error) {
	return s.service.Version(context.Background())
}

// UpdateAccess creates or replaces an ACL access config entry.
func (s *ACLService) UpdateAccess(input AccessConfigInput) error {
	return s.service.Put(context.Background(), model.AccessConfig{
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
func (s *ACLService) DeleteAccess(accessKey string) error {
	return s.service.Remove(context.Background(), accessKey)
}

// UpdateWhiteAddrs replaces the broker global IP white list.
func (s *ACLService) UpdateWhiteAddrs(addrs []string) error {
	return s.service.SetAllowList(context.Background(), addrs)
}
