package rocketmq

import (
	"context"
	"fmt"
	"strings"

	"github.com/amigoer/mq-studio/internal/model"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// GetAclEnabled reports whether ACL is enabled on the broker.
func (c *Conn) GetAclEnabled(ctx context.Context) (bool, error) {
	brokerAddress, client, err := c.getBrokerAddress(ctx)
	if err != nil {
		return false, err
	}

	var enabled bool
	err = Exec(client, func(retryClient *admin.Client) error {

		config, callErr := retryClient.GetBrokerConfig(ctx, brokerAddress)
		if callErr != nil {
			return callErr
		}
		enabled = strings.EqualFold(config["aclEnable"], "true")
		return nil
	})
	if err != nil {
		return false, fmt.Errorf("获取 Broker 配置失败: %w", err)
	}
	return enabled, nil
}

// GetAclVersion returns ACL configuration version information.
func (c *Conn) GetAclVersion(ctx context.Context) (*model.AclVersionInfo, error) {
	brokerAddress, client, err := c.getBrokerAddress(ctx)
	if err != nil {
		return nil, err
	}

	var result *model.AclVersionInfo
	err = Exec(client, func(retryClient *admin.Client) error {

		info, callErr := retryClient.GetBrokerClusterAclInfo(ctx, brokerAddress)
		if callErr != nil {
			return callErr
		}
		result = &model.AclVersionInfo{
			BrokerAddr:  info.BrokerAddr,
			BrokerName:  info.BrokerName,
			ClusterName: info.ClusterName,
			Version:     info.Version,
		}
		return nil
	})
	// Older brokers may not implement this RPC. The empty result is an expected capability state.
	if err != nil && isRequestCodeNotSupported(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("获取 ACL 版本信息失败: %w", err)
	}
	return result, nil
}
