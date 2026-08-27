package rocketmq

import (
	"context"

	"github.com/amigoer/mq-studio/internal/model"
)

// AccessEnabled reports whether the broker has ACL turned on.
func (c *Conn) AccessEnabled(ctx context.Context) (bool, error) {
	return c.GetAclEnabled(ctx)
}

// AccessVersion returns the broker ACL config version.
func (c *Conn) AccessVersion(ctx context.Context) (*model.AclVersionInfo, error) {
	return c.GetAclVersion(ctx)
}

// PutAccessConfig creates or replaces an access entry.
func (c *Conn) PutAccessConfig(ctx context.Context, config model.AccessConfig) error {
	return c.CreateOrUpdateAccessConfig(ctx, config.AccessKey, config.SecretKey,
		config.WhiteRemoteAddress, config.IsAdmin, config.DefaultTopicPerm,
		config.DefaultGroupPerm, config.TopicPerms, config.GroupPerms)
}

// RemoveAccessConfig deletes an access entry.
func (c *Conn) RemoveAccessConfig(ctx context.Context, accessKey string) error {
	return c.DeleteAccessConfig(ctx, accessKey)
}

// SetGlobalWhiteAddrs replaces the broker global IP allow list.
func (c *Conn) SetGlobalWhiteAddrs(ctx context.Context, addresses []string) error {
	return c.UpdateGlobalWhiteAddrs(ctx, addresses)
}
