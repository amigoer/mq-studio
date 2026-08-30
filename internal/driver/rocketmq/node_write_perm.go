package rocketmq

import (
	"context"
	"fmt"
	"strings"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// SetNodeWritable takes a broker out of the write path, or puts it back.
//
// It names a broker rather than an address because that is what the call
// takes: write permission is a property of the route table, which is keyed by
// broker name, and a master and its slaves share one.
//
// The change lands on the name server the client reaches first. A cluster with
// several name servers therefore has one telling producers something the
// others do not, until they gossip - which is the broker's own design and not
// something this can paper over, so the page says so rather than pretending
// the change is cluster-wide.
func (c *Conn) SetNodeWritable(ctx context.Context, name string, writable bool) (int, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return 0, fmt.Errorf("Broker 名称不能为空")
	}

	var affected int
	err := c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
		var callErr error
		if writable {
			affected, callErr = retryClient.AddWritePermOfBroker(ctx, name)
		} else {
			affected, callErr = retryClient.WipeWritePermOfBroker(ctx, name)
		}
		return callErr
	})
	if err != nil {
		if writable {
			return 0, fmt.Errorf("恢复 Broker 写权限失败: %w", err)
		}
		return 0, fmt.Errorf("摘除 Broker 写权限失败: %w", err)
	}
	return affected, nil
}
