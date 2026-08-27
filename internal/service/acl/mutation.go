package acl

import (
	"context"

	"github.com/amigoer/mq-studio/internal/driver/rocketmq/mqexec"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// CreateOrUpdateAccessConfig creates or updates an ACL access configuration.
func (s *Service) CreateOrUpdateAccessConfig(
	accessKey, secretKey, whiteRemoteAddress string,
	isAdmin bool,
	defaultTopicPerm, defaultGroupPerm string,
	topicPerms, groupPerms []string,
) error {
	brokerAddress, client, err := s.getBrokerAddress()
	if err != nil {
		return err
	}

	return mqexec.Do(client, func(retryClient *admin.Client) error {
		ctx, cancel := context.WithTimeout(context.Background(), s.settings.GetRequestTimeout())
		defer cancel()
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
func (s *Service) DeleteAccessConfig(accessKey string) error {
	brokerAddress, client, err := s.getBrokerAddress()
	if err != nil {
		return err
	}

	return mqexec.Do(client, func(retryClient *admin.Client) error {
		ctx, cancel := context.WithTimeout(context.Background(), s.settings.GetRequestTimeout())
		defer cancel()
		return retryClient.DeletePlainAccessConfig(ctx, brokerAddress, accessKey)
	})
}

// UpdateGlobalWhiteAddrs updates the global address allowlist.
func (s *Service) UpdateGlobalWhiteAddrs(addresses []string) error {
	brokerAddress, client, err := s.getBrokerAddress()
	if err != nil {
		return err
	}

	return mqexec.Do(client, func(retryClient *admin.Client) error {
		ctx, cancel := context.WithTimeout(context.Background(), s.settings.GetRequestTimeout())
		defer cancel()
		return retryClient.UpdateGlobalWhiteAddrsConfig(ctx, brokerAddress, addresses, "")
	})
}
