package service

import (
	"fmt"
	"log"
	"strings"

	"rocket-leaf/internal/rocketmq"

	admin "github.com/amigoer/rocketmq-admin-go"
)

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

	// 移除旧默认客户端，触发后续懒加载重新建立连接
	manager.RemoveClient(defaultNameServer)

	retryClient, reconnectErr := manager.GetDefaultClient()
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
