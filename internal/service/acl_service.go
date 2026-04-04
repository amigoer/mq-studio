package service

import (
	"context"
	"fmt"

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

// ListUsers 列出所有 ACL 用户
func (s *AclService) ListUsers() ([]*model.AclUser, error) {
	brokerAddr, client, err := s.getBrokerAddr()
	if err != nil {
		return nil, err
	}

	var result []*model.AclUser
	err = executeWithClientRetry(client, func(retryClient *admin.Client) error {
		ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
		defer cancel()

		userList, callErr := retryClient.ListUser(ctx, brokerAddr)
		if callErr != nil {
			return callErr
		}

		result = make([]*model.AclUser, 0, len(userList.Users))
		for _, u := range userList.Users {
			result = append(result, &model.AclUser{
				Username:    u.Username,
				Password:    u.Password,
				UserType:    u.UserType,
				UserStatus:  u.UserStatus,
				Permissions: u.Permissions,
			})
		}
		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("获取用户列表失败: %w", err)
	}
	return result, nil
}

// CreateUser 创建 ACL 用户
func (s *AclService) CreateUser(username, password, userType string) error {
	brokerAddr, client, err := s.getBrokerAddr()
	if err != nil {
		return err
	}

	return executeWithClientRetry(client, func(retryClient *admin.Client) error {
		ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
		defer cancel()

		return retryClient.CreateUser(ctx, brokerAddr, admin.UserInfo{
			Username: username,
			Password: password,
			UserType: userType,
		})
	})
}

// UpdateUser 更新 ACL 用户
func (s *AclService) UpdateUser(username, password, userType, userStatus string) error {
	brokerAddr, client, err := s.getBrokerAddr()
	if err != nil {
		return err
	}

	return executeWithClientRetry(client, func(retryClient *admin.Client) error {
		ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
		defer cancel()

		return retryClient.UpdateUser(ctx, brokerAddr, admin.UserInfo{
			Username:   username,
			Password:   password,
			UserType:   userType,
			UserStatus: userStatus,
		})
	})
}

// DeleteUser 删除 ACL 用户
func (s *AclService) DeleteUser(username string) error {
	brokerAddr, client, err := s.getBrokerAddr()
	if err != nil {
		return err
	}

	return executeWithClientRetry(client, func(retryClient *admin.Client) error {
		ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
		defer cancel()

		return retryClient.DeleteUser(ctx, brokerAddr, username)
	})
}

// ListAcls 列出所有 ACL 规则
func (s *AclService) ListAcls() ([]*model.AclRule, error) {
	brokerAddr, client, err := s.getBrokerAddr()
	if err != nil {
		return nil, err
	}

	var result []*model.AclRule
	err = executeWithClientRetry(client, func(retryClient *admin.Client) error {
		ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
		defer cancel()

		aclList, callErr := retryClient.ListAcl(ctx, brokerAddr)
		if callErr != nil {
			return callErr
		}

		result = make([]*model.AclRule, 0, len(aclList.Acls))
		for _, a := range aclList.Acls {
			policies := make([]model.AclPolicy, 0, len(a.Policies))
			for _, p := range a.Policies {
				policies = append(policies, model.AclPolicy{
					Resource:  p.Resource,
					Actions:   p.Actions,
					Effect:    p.Effect,
					SourceIPs: p.SourceIPs,
					Decision:  p.Decision,
				})
			}
			result = append(result, &model.AclRule{
				Subject:     a.Subject,
				Policies:    policies,
				Description: a.Description,
			})
		}
		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("获取 ACL 列表失败: %w", err)
	}
	return result, nil
}

// CreateAcl 创建 ACL 规则
func (s *AclService) CreateAcl(subject string, policies []model.AclPolicy, description string) error {
	brokerAddr, client, err := s.getBrokerAddr()
	if err != nil {
		return err
	}

	adminPolicies := make([]admin.AclPolicy, 0, len(policies))
	for _, p := range policies {
		adminPolicies = append(adminPolicies, admin.AclPolicy{
			Resource:  p.Resource,
			Actions:   p.Actions,
			Effect:    p.Effect,
			SourceIPs: p.SourceIPs,
			Decision:  p.Decision,
		})
	}

	return executeWithClientRetry(client, func(retryClient *admin.Client) error {
		ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
		defer cancel()

		return retryClient.CreateAcl(ctx, brokerAddr, admin.AclInfo{
			Subject:     subject,
			Policies:    adminPolicies,
			Description: description,
		})
	})
}

// DeleteAcl 删除 ACL 规则
func (s *AclService) DeleteAcl(subject string) error {
	brokerAddr, client, err := s.getBrokerAddr()
	if err != nil {
		return err
	}

	return executeWithClientRetry(client, func(retryClient *admin.Client) error {
		ctx, cancel := context.WithTimeout(context.Background(), s.settingsService.GetRequestTimeout())
		defer cancel()

		return retryClient.DeleteAcl(ctx, brokerAddr, subject)
	})
}
