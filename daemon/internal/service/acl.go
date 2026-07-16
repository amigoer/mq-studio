package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
	"github.com/amigoer/rocket-leaf/daemon/internal/rocketmq"

	admin "github.com/amigoer/rocketmq-admin-go"
	"github.com/amigoer/rocketmq-admin-go/protocol/remoting"
)

// isRequestCodeNotSupported reports whether the broker returned "request type X not supported",
// which corresponds to RemotingSysResponseCode.REQUEST_CODE_NOT_SUPPORTED (3).
// Older brokers return this code when they do not support a newer admin RPC.
func isRequestCodeNotSupported(err error) bool {
	if err == nil {
		return false
	}
	var ae *admin.AdminError
	if errors.As(err, &ae) {
		return ae.Code == remoting.RequestCodeNotSupported
	}
	return false
}

// AclService provides ACL management operations.
type AclService struct {
	settingsService *SettingsService
}

// NewAclService creates an ACL service.
func NewAclService(settingsService *SettingsService) *AclService {
	return &AclService{
		settingsService: settingsService,
	}
}

// getBrokerAddr returns the address of the first available master broker.
func (s *AclService) getBrokerAddr() (string, *admin.Client, error) {
	client, err := rocketmq.GetClientManager().GetDefaultClient()
	if err != nil {
		return "", nil, fmt.Errorf("未连接集群: %w", err)
	}

	var (
		clusterInfo  *admin.ClusterInfo
		activeClient = client
	)
	err = executeWithClientRetryTimeout(client, s.settingsService.GetRequestTimeout(), func(ctx context.Context, retryClient *admin.Client) error {
		var callErr error
		clusterInfo, callErr = retryClient.ExamineBrokerClusterInfo(ctx)
		if callErr == nil {
			activeClient = retryClient
		}
		return callErr
	})
	if err != nil {
		return "", nil, fmt.Errorf("获取集群信息失败: %w", err)
	}

	for _, brokerData := range clusterInfo.BrokerAddrTable {
		if brokerData == nil {
			continue
		}
		if addr, ok := brokerData.BrokerAddrs["0"]; ok && addr != "" {
			return addr, activeClient, nil
		}
	}

	return "", nil, fmt.Errorf("未找到可用的 Master Broker")
}

// GetAclEnabled reports whether ACL is enabled on the broker.
func (s *AclService) GetAclEnabled() (bool, error) {
	brokerAddr, client, err := s.getBrokerAddr()
	if err != nil {
		return false, err
	}

	var enabled bool
	err = executeWithClientRetry(client, func(retryClient *admin.Client) error {
		ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
		defer cancel()

		config, callErr := retryClient.GetBrokerConfig(ctx, brokerAddr)
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
func (s *AclService) GetAclVersion() (*model.AclVersionInfo, error) {
	brokerAddr, client, err := s.getBrokerAddr()
	if err != nil {
		return nil, err
	}

	var result *model.AclVersionInfo
	err = executeWithClientRetry(client, func(retryClient *admin.Client) error {
		ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
		defer cancel()

		info, callErr := retryClient.GetBrokerClusterAclInfo(ctx, brokerAddr)
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

	// Older brokers with ACL disabled or without this RPC return "request code 52 not supported".
	// This is an expected capability difference. Return nil so the UI displays its empty
	// "no version information" state without logging an error.
	if err != nil && isRequestCodeNotSupported(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("获取 ACL 版本信息失败: %w", err)
	}
	return result, nil
}

// CreateOrUpdateAccessConfig creates or updates an ACL access configuration.
func (s *AclService) CreateOrUpdateAccessConfig(
	accessKey, secretKey, whiteRemoteAddress string,
	isAdmin bool,
	defaultTopicPerm, defaultGroupPerm string,
	topicPerms, groupPerms []string,
) error {
	brokerAddr, client, err := s.getBrokerAddr()
	if err != nil {
		return err
	}

	return executeWithClientRetry(client, func(retryClient *admin.Client) error {
		ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
		defer cancel()

		return retryClient.UpdatePlainAccessConfig(ctx, brokerAddr, admin.PlainAccessConfig{
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
func (s *AclService) DeleteAccessConfig(accessKey string) error {
	brokerAddr, client, err := s.getBrokerAddr()
	if err != nil {
		return err
	}

	return executeWithClientRetry(client, func(retryClient *admin.Client) error {
		ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
		defer cancel()

		return retryClient.DeletePlainAccessConfig(ctx, brokerAddr, accessKey)
	})
}

// UpdateGlobalWhiteAddrs updates the global address allowlist.
func (s *AclService) UpdateGlobalWhiteAddrs(addrs []string) error {
	brokerAddr, client, err := s.getBrokerAddr()
	if err != nil {
		return err
	}

	return executeWithClientRetry(client, func(retryClient *admin.Client) error {
		ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
		defer cancel()

		return retryClient.UpdateGlobalWhiteAddrsConfig(ctx, brokerAddr, addrs, "")
	})
}
