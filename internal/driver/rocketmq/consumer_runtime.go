package rocketmq

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/timestamp"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// SubscriptionClients asks every connected consumer in a group what it holds.
//
// This is one round trip per client, so it is not folded into the group list:
// a cluster with fifty consumers would turn one page load into fifty requests.
//
// A group with nothing connected returns an error rather than an empty list.
// The two mean different things - nobody is consuming, versus everyone is
// consuming nothing - and a page that shows them the same way hides an outage.
func (c *Conn) SubscriptionClients(ctx context.Context, ref model.SubscriptionRef) ([]*model.SubscriptionClient, error) {
	group := strings.TrimSpace(ref.Name)
	if group == "" {
		return nil, fmt.Errorf("获取消费端运行信息失败: 消费者组不能为空")
	}

	var connections *admin.ConsumerConnection
	err := c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
		var callErr error
		connections, callErr = retryClient.ExamineConsumerConnectionInfo(ctx, group)
		return callErr
	})
	if err != nil {
		return nil, fmt.Errorf("获取消费端连接失败: %w", err)
	}
	if connections == nil || len(connections.ConnectionSet) == 0 {
		return nil, fmt.Errorf("消费者组 %s 当前没有在线客户端", group)
	}

	clients := make([]*model.SubscriptionClient, 0, len(connections.ConnectionSet))
	for _, connection := range connections.ConnectionSet {
		if connection == nil || connection.ClientId == "" {
			continue
		}
		client := &model.SubscriptionClient{ClientID: connection.ClientId}

		var info *admin.ConsumerRunningInfo
		// jstack is deliberately off: it makes the broker collect a full thread
		// dump from the client, which is expensive and useless to this page.
		runErr := c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
			var callErr error
			info, callErr = retryClient.GetConsumerRunningInfo(ctx, group, connection.ClientId, false)
			return callErr
		})
		// One unreachable client must not lose the others: a rebalancing or
		// half-dead consumer is exactly what someone opens this page to find.
		if runErr == nil && info != nil {
			applyRunningInfo(client, info)
		}
		clients = append(clients, client)
	}

	sort.Slice(clients, func(left, right int) bool {
		return clients[left].ClientID < clients[right].ClientID
	})
	return clients, nil
}

func applyRunningInfo(client *model.SubscriptionClient, info *admin.ConsumerRunningInfo) {
	client.Properties = info.Properties

	for key, queue := range info.MqTable {
		broker, queueID := parseMQKey(key)
		client.Assignments = append(client.Assignments, model.QueueAssignment{
			Destination:  topicFromMQKey(key),
			Node:         broker,
			QueueID:      queueID,
			Pending:      queue.MsgCount,
			PendingBytes: queue.MsgSize,
			LastPull:     timestamp.FromUnixMilli(queue.LastPullTime),
			LastConsume:  timestamp.FromUnixMilli(queue.LastConsumeTime),
			Locked:       queue.Locked,
			Dropped:      queue.Dropped,
		})
	}
	sort.Slice(client.Assignments, func(left, right int) bool {
		if client.Assignments[left].Destination != client.Assignments[right].Destination {
			return client.Assignments[left].Destination < client.Assignments[right].Destination
		}
		if client.Assignments[left].Node != client.Assignments[right].Node {
			return client.Assignments[left].Node < client.Assignments[right].Node
		}
		return client.Assignments[left].QueueID < client.Assignments[right].QueueID
	})

	for destination, status := range info.StatusTable {
		client.Throughput = append(client.Throughput, model.ConsumeThroughput{
			Destination:      destination,
			PullLatencyMs:    status.PullRT,
			PullRate:         status.PullTPS,
			ConsumeLatencyMs: status.ConsumeRT,
			SuccessRate:      status.ConsumeOKTPS,
			FailureRate:      status.ConsumeFailedTPS,
			FailedMessages:   status.ConsumeFailedMsgs,
		})
	}
	sort.Slice(client.Throughput, func(left, right int) bool {
		return client.Throughput[left].Destination < client.Throughput[right].Destination
	})
}

// topicFromMQKey reads the topic out of a serialized MessageQueue.
//
// parseMQKey already handles the broker and queue id; the topic is the third
// field and no existing caller needed it.
func topicFromMQKey(key string) string {
	if index := strings.Index(key, `"topic"`); index >= 0 {
		rest := key[index+len(`"topic"`):]
		if start := strings.Index(rest, `"`); start >= 0 {
			rest = rest[start+1:]
			if end := strings.Index(rest, `"`); end >= 0 {
				return rest[:end]
			}
		}
	}
	if index := strings.Index(key, "topic="); index >= 0 {
		rest := key[index+len("topic="):]
		if end := strings.IndexAny(rest, ",]"); end >= 0 {
			return strings.TrimSpace(rest[:end])
		}
		return strings.TrimSpace(rest)
	}
	return ""
}
