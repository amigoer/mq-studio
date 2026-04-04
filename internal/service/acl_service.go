package service

import (
	"context"
	"fmt"
	"strings"

	"rocket-leaf/internal/model"
	"rocket-leaf/internal/rocketmq"

	admin "github.com/amigoer/rocketmq-admin-go"
)

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

	ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
	defer cancel()

	clusterInfo, err := client.ExamineBrokerClusterInfo(ctx)
	if err != nil {
		return "", nil, fmt.Errorf("获取集群信息失败: %w", err)
	}

	for _, brokerData := range clusterInfo.BrokerAddrTable {
		if brokerData == nil {
			continue
		}
		if addr, ok := brokerData.BrokerAddrs["0"]; ok && addr != "" {
			return addr, client, nil
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
