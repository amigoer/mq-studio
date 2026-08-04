// Package mqexec executes RocketMQ admin calls with bounded reconnect retries.
package mqexec

import (
	"context"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/amigoer/rocket-leaf/internal/rocketmq"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// Multiple concurrent metric requests may detect the same stale client disconnecting.
// Serialize reconnection decisions so a later request cannot close a client just created by an earlier one.
var clientRetryMu sync.Mutex

// WithTimeout creates an independent timeout context for each attempt.
// A context cannot be reused across retries: after the first timeout it is canceled,
// which would cause the retry to fail immediately.
func WithTimeout(
	client *admin.Client,
	timeout time.Duration,
	call func(context.Context, *admin.Client) error,
) error {
	return Do(client, func(current *admin.Client) error {
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()
		return call(ctx, current)
	})
}

// Do executes a request with the default client and reconnects once on a network disconnect.
func Do(client *admin.Client, call func(*admin.Client) error) error {
	err := call(client)
	if err == nil {
		return nil
	}

	if !IsRetryableNetworkError(err) {
		return err
	}

	manager := rocketmq.GetClientManager()
	defaultNameServer := strings.TrimSpace(manager.GetDefaultConnection())
	if defaultNameServer == "" {
		return err
	}

	log.Printf("[Service] 检测到连接异常，准备重连默认连接并重试: %v", err)
	clientRetryMu.Lock()
	// Another request may already have reconnected. Reuse its client instead of replacing it again.
	if current, currentErr := manager.GetClient(defaultNameServer); currentErr == nil && current != client {
		clientRetryMu.Unlock()
		return call(current)
	}

	config, configErr := manager.GetDefaultClientConfig()
	// Remove the stale default client so the connection is recreated lazily.
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

// IsRetryableNetworkError reports whether an admin call failed because its client became unusable.
func IsRetryableNetworkError(err error) bool {
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
