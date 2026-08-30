package rocketmq

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/amigoer/mq-studio/internal/model"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// ProducerClients lists the publishers connected under one producer group.
//
// The topic is required because the broker resolves the group's connections
// through that topic's route: it asks the brokers serving the topic, not the
// name server, so a group publishing nowhere has nothing to report.
//
// A group with nobody connected is an empty list rather than an error, unlike
// SubscriptionClients: a producer that is idle between sends is normal, while a
// consumer group with nothing attached is an outage.
func (c *Conn) ProducerClients(ctx context.Context, group, destination string) ([]*model.ProducerClient, error) {
	group = strings.TrimSpace(group)
	destination = strings.TrimSpace(destination)
	if group == "" || destination == "" {
		return nil, fmt.Errorf("获取生产者连接失败: 生产者组和 Topic 都不能为空")
	}

	var connections *admin.ProducerConnection
	err := c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
		var callErr error
		connections, callErr = retryClient.ExamineProducerConnectionInfo(ctx, group, destination)
		return callErr
	})
	if err != nil {
		// "no connection info found" is the broker saying nobody is attached,
		// which is an answer rather than a failure.
		if strings.Contains(strings.ToLower(err.Error()), "no connection info") {
			return []*model.ProducerClient{}, nil
		}
		return nil, fmt.Errorf("获取生产者连接失败: %w", err)
	}
	if connections == nil {
		return []*model.ProducerClient{}, nil
	}

	clients := make([]*model.ProducerClient, 0, len(connections.ConnectionSet))
	for _, connection := range connections.ConnectionSet {
		clients = append(clients, &model.ProducerClient{
			ClientID: connection.ClientId,
			Address:  connection.ClientAddr,
			Language: connection.Language,
			Version:  strconv.Itoa(connection.Version),
		})
	}
	sort.Slice(clients, func(left, right int) bool {
		return clients[left].ClientID < clients[right].ClientID
	})
	return clients, nil
}
