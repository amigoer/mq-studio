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

// isRequestCodeNotSupported 判断错误是否为 broker 上的 "request type X not
// supported" —— 对应 RemotingSysResponseCode.REQUEST_CODE_NOT_SUPPORTED (3)。
// 老版本 broker 不支持新的 admin RPC 时会返回这个码。
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

// AclService ACL 管理服务
type AclService struct {
	settingsService *SettingsService
}

// NewAclService 创建 ACL 管理服务
func NewAclService(settingsService *SettingsService) *AclService {
	return &AclService{
		settingsService: settingsService,
	}
}

// getBrokerAddr 获取第一个可用的 Master Broker 地址
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

// GetAclEnabled 检查 Broker 是否启用 ACL
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

// GetAclVersion 获取 ACL 配置版本信息
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

	// 老 broker（未启用 ACL 或不支持该 RPC）会返回 "request code 52 not supported"。
	// 这是预期内的能力差异——返回 nil 让前端走"无版本信息"的空状态，不再
	// 记录错误日志。
	if err != nil && isRequestCodeNotSupported(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("获取 ACL 版本信息失败: %w", err)
	}
	return result, nil
}

// CreateOrUpdateAccessConfig 创建或更新 ACL 访问配置
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

// DeleteAccessConfig 删除 ACL 访问配置
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

// UpdateGlobalWhiteAddrs 更新全局白名单地址
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
