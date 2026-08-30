package rocketmq

import (
	"context"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// CreateOrUpdateAccessConfig creates or updates an ACL access configuration.
func (c *Conn) CreateOrUpdateAccessConfig(ctx context.Context,
	accessKey, secretKey, whiteRemoteAddress string,
	isAdmin bool,
	defaultTopicPerm, defaultGroupPerm string,
	topicPerms, groupPerms []string,
) error {
	brokerAddress, err := c.getBrokerAddress(ctx)
	if err != nil {
		return err
	}

	return c.exec(func(retryClient *admin.Client) error {
		return retryClient.UpdatePlainAccessConfig(ctx, brokerAddress, admin.PlainAccessConfig{
			AccessKey:          accessKey,
			SecretKey:          secretKey,
			WhiteRemoteAddress: whiteRemoteAddress,
			Admin:              isAdmin,
			DefaultTopicPerm:   defaultTopicPerm,
			DefaultGroupPerm:   defaultGroupPerm,
			TopicPerms:         topicPerms,
			GroupPerms:         groupPerms,
		})
	})
}

// DeleteAccessConfig deletes an ACL access configuration.
func (c *Conn) DeleteAccessConfig(ctx context.Context, accessKey string) error {
	brokerAddress, err := c.getBrokerAddress(ctx)
	if err != nil {
		return err
	}

	return c.exec(func(retryClient *admin.Client) error {
		return retryClient.DeletePlainAccessConfig(ctx, brokerAddress, accessKey)
	})
}

// UpdateGlobalWhiteAddrs updates the global address allowlist.
func (c *Conn) UpdateGlobalWhiteAddrs(ctx context.Context, addresses []string) error {
	brokerAddress, err := c.getBrokerAddress(ctx)
	if err != nil {
		return err
	}

	return c.exec(func(retryClient *admin.Client) error {
		return retryClient.UpdateGlobalWhiteAddrsConfig(ctx, brokerAddress, addresses, "")
	})
}
