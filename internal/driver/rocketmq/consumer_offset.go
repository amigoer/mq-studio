package rocketmq

import (
	"context"
	"fmt"
	"strings"

	"github.com/amigoer/mq-studio/internal/model"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// SetQueueOffset writes one queue's committed offset for a consumer group.
//
// The request names the broker rather than addressing it, because that is what
// the page has: the per-queue progress rows are keyed by broker name, which is
// the only identity a message queue carries. The address is resolved from the
// cluster here.
//
// Nothing clamps the offset to the queue's readable range. A value past the
// end makes the group skip what has not arrived yet, and one before the start
// is silently pulled forward by the broker on the next fetch - both are
// deliberate uses, and refusing them here would be this layer deciding what an
// operator meant.
func (c *Conn) SetQueueOffset(ctx context.Context, request model.QueueOffsetRequest) error {
	group := c.wrap(strings.TrimSpace(request.Subscription))
	topic := c.wrap(strings.TrimSpace(request.Destination))
	node := strings.TrimSpace(request.Node)
	switch {
	case group == "":
		return fmt.Errorf("消费组名称不能为空")
	case topic == "":
		return fmt.Errorf("Topic 名称不能为空")
	case node == "":
		return fmt.Errorf("Broker 名称不能为空")
	case request.QueueID < 0:
		return fmt.Errorf("队列号不能为负数")
	case request.Offset < 0:
		return fmt.Errorf("位点不能为负数")
	}

	address, err := c.brokerAddressByName(ctx, node)
	if err != nil {
		return err
	}
	err = c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
		return retryClient.UpdateConsumeOffset(ctx, address, group, topic, request.QueueID, request.Offset)
	})
	if err != nil {
		return fmt.Errorf("设置队列位点失败: %w", err)
	}
	return nil
}

// brokerAddressByName resolves a broker name to its master's address.
//
// The master, specifically: an offset written to a slave is overwritten by the
// next sync from the master that owns it.
func (c *Conn) brokerAddressByName(ctx context.Context, name string) (string, error) {
	var clusterInfo *admin.ClusterInfo
	err := c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
		var callErr error
		clusterInfo, callErr = retryClient.ExamineBrokerClusterInfo(ctx)
		return callErr
	})
	if err != nil {
		return "", fmt.Errorf("获取集群信息失败: %w", err)
	}

	for brokerName, brokerData := range clusterInfo.BrokerAddrTable {
		if brokerData == nil || brokerName != name {
			continue
		}
		if address := brokerData.BrokerAddrs["0"]; address != "" {
			return address, nil
		}
		return "", fmt.Errorf("Broker %s 没有可用的 Master 地址", name)
	}
	return "", fmt.Errorf("集群里没有名为 %s 的 Broker", name)
}
