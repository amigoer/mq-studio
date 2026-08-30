package rocketmq

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// execWithTimeout creates an independent timeout context for each attempt.
// A context cannot be reused across retries: after the first timeout it is
// canceled, which would cause the retry to fail immediately.
func (c *Conn) execWithTimeout(
	timeout time.Duration,
	call func(context.Context, *admin.Client) error,
) error {
	return c.exec(func(current *admin.Client) error {
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()
		return call(ctx, current)
	})
}

// exec runs a request and reconnects this connection once on a network drop.
//
// The retry rebuilds only this Conn's client, from the config it was opened
// with. Reaching for a shared default here is what used to let one connection
// close another's client mid-request.
func (c *Conn) exec(call func(*admin.Client) error) error {
	client := c.current()
	if client == nil {
		return fmt.Errorf("连接已关闭")
	}

	err := call(client)
	if err == nil || !IsRetryableNetworkError(err) {
		return err
	}

	log.Printf("[rocketmq] 检测到连接异常，准备重连 %s 并重试: %v", c.endpoint, err)
	retryClient, reconnectErr := c.reconnect(client)
	if reconnectErr != nil {
		return fmt.Errorf("请求失败: %w；自动重连失败: %v", err, reconnectErr)
	}
	return call(retryClient)
}

// reconnect replaces a client that has stopped working.
//
// Concurrent requests can all observe the same drop, so the stale client is
// compared under the lock: whoever gets there first dials, and the rest reuse
// the client it installed instead of dialling again.
func (c *Conn) reconnect(stale *admin.Client) (*admin.Client, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.client == nil {
		return nil, fmt.Errorf("连接已关闭")
	}
	if c.client != stale {
		return c.client, nil
	}

	client, err := Dial(c.config)
	if err != nil {
		return nil, err
	}
	c.client = client
	stale.Close()
	return client, nil
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
