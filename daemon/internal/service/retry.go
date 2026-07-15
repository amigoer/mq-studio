package service

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/amigoer/rocket-leaf/daemon/internal/rocketmq"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// 多个并行指标请求可能同时发现同一个旧客户端断线。串行化重连判定，
// 避免后到的请求把先到请求刚创建好的客户端再次关闭。
var clientRetryMu sync.Mutex

// executeWithClientRetryTimeout 为每次尝试创建独立的超时上下文。
// 不能在重试之间复用 context：首次超时后旧 context 已经取消，重试会立即失败。
func executeWithClientRetryTimeout(
	client *admin.Client,
	timeout time.Duration,
	call func(context.Context, *admin.Client) error,
) error {
	return executeWithClientRetry(client, func(current *admin.Client) error {
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()
		return call(ctx, current)
	})
}

// executeWithClientRetry 使用默认客户端执行请求，遇到网络断连时自动重连并重试一次
func executeWithClientRetry(client *admin.Client, call func(*admin.Client) error) error {
	err := call(client)
	if err == nil {
		return nil
	}

	if !isRetryableNetworkError(err) {
		return err
	}

	manager := rocketmq.GetClientManager()
	defaultNameServer := strings.TrimSpace(manager.GetDefaultConnection())
	if defaultNameServer == "" {
		return err
	}

	log.Printf("[Service] 检测到连接异常，准备重连默认连接并重试: %v", err)
	clientRetryMu.Lock()
	// 其它请求可能已经完成重连。此时直接复用新客户端，不再重复替换。
	if current, currentErr := manager.GetClient(defaultNameServer); currentErr == nil && current != client {
		clientRetryMu.Unlock()
		return call(current)
	}

	config, configErr := manager.GetDefaultClientConfig()
	// 移除旧默认客户端，触发后续懒加载重新建立连接
	manager.RemoveClient(defaultNameServer)

	var (
		retryClient  *admin.Client
		reconnectErr error
	)
	if configErr == nil {
		retryClient, reconnectErr = manager.CreateClient(
			defaultNameServer,
			config.Timeout,
			config.EnableACL,
			config.AccessKey,
			config.SecretKey,
		)
		if reconnectErr == nil {
			reconnectErr = manager.SetDefaultConnection(defaultNameServer)
		}
	} else {
		retryClient, reconnectErr = manager.GetDefaultClient()
	}
	clientRetryMu.Unlock()
	if reconnectErr != nil {
		return fmt.Errorf("请求失败: %w；自动重连失败: %v", err, reconnectErr)
	}

	return call(retryClient)
}

func isRetryableNetworkError(err error) bool {
	if err == nil {
		return false
	}

	errMsg := strings.ToLower(err.Error())
	indicators := []string{
		"broken pipe",
		"connection reset by peer",
		"use of closed network connection",
		"connection refused",
		"no route to host",
		"network is unreachable",
		"i/o timeout",
		"eof",
		"发送数据失败",
		"所有 nameserver 请求失败",
	}

	for _, indicator := range indicators {
		if strings.Contains(errMsg, indicator) {
			return true
		}
	}

	return false
}
