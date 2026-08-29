package rocketmq

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"

	"github.com/amigoer/mq-studio/internal/driver/rocketmq/mqoffset"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/timestamp"

	admin "github.com/amigoer/rocketmq-admin-go"
)

func (c *Conn) enrichConsumerGroups(ctx context.Context, groups []*model.ConsumerGroupItem, dlqTopics map[string]struct{}) {
	const maxConcurrent = 6
	semaphore := make(chan struct{}, maxConcurrent)
	var waitGroup sync.WaitGroup
	for _, item := range groups {
		if item == nil {
			continue
		}
		waitGroup.Add(1)
		go func(group *model.ConsumerGroupItem) {
			defer waitGroup.Done()
			semaphore <- struct{}{}
			defer func() { <-semaphore }()
			c.enrichConsumerGroup(ctx, group, dlqTopics)
		}(item)
	}
	waitGroup.Wait()
}

func (c *Conn) enrichConsumerGroup(ctx context.Context, item *model.ConsumerGroupItem, dlqTopics map[string]struct{}) {
	if item == nil {
		return
	}
	item.Subscriptions = item.Subscriptions[:0]
	item.Clients = item.Clients[:0]
	connectionErr := c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
		connectionInfo, callErr := retryClient.ExamineConsumerConnectionInfo(ctx, item.Group)
		if callErr != nil {
			return callErr
		}
		if connectionInfo == nil {
			return nil
		}
		item.OnlineClients = len(connectionInfo.ConnectionSet)
		if item.OnlineClients > 0 {
			item.Status = model.GroupOnline
		} else {
			item.Status = model.GroupOffline
		}
		for _, connection := range connectionInfo.ConnectionSet {
			if connection == nil {
				continue
			}
			item.Clients = append(item.Clients, model.GroupClient{
				ClientID:      connection.ClientId,
				IP:            connection.ClientAddr,
				Version:       fmt.Sprintf("%d", connection.Version),
				LastHeartbeat: timestamp.Now(),
			})
		}
		for topicName, expression := range connectionInfo.SubscriptionTable {
			if expression == nil {
				continue
			}
			item.Subscriptions = append(item.Subscriptions, model.GroupSubscription{
				Topic:      topicName,
				Expression: expression.SubString,
			})
		}
		sort.Slice(item.Subscriptions, func(i, j int) bool {
			return item.Subscriptions[i].Topic < item.Subscriptions[j].Topic
		})
		item.TopicCount = len(item.Subscriptions)
		return nil
	})
	if connectionErr != nil {
		item.Status = model.GroupWarning
	}

	_ = c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
		stats, callErr := retryClient.ExamineConsumeStats(ctx, item.Group)
		if callErr != nil {
			return callErr
		}
		if stats == nil {
			return fmt.Errorf("Broker 返回空消费统计")
		}
		var lag int64
		for _, offset := range stats.OffsetTable {
			if offset == nil {
				continue
			}
			if difference := offset.BrokerOffset - offset.ConsumerOffset; difference > 0 {
				lag += difference
			}
		}
		item.Lag = lag
		return nil
	})

	dlqTopic := "%DLQ%" + item.Group
	if dlqTopics != nil {
		if _, exists := dlqTopics[dlqTopic]; !exists {
			item.DLQ = 0
			item.LastUpdate = timestamp.Now()
			return
		}
	}
	_ = c.execWithTimeout(timeoutFrom(ctx), func(ctx context.Context, retryClient *admin.Client) error {
		offsets, callErr := mqoffset.Collect(ctx, retryClient, dlqTopic)
		if callErr != nil {
			if errors.Is(callErr, admin.ErrTopicNotFound) {
				item.DLQ = 0
				return nil
			}
			return callErr
		}
		var total int64
		for _, offset := range offsets {
			if offset.MaxOffset > offset.MinOffset {
				total += offset.MaxOffset - offset.MinOffset
			}
		}
		item.DLQ = int(total)
		return nil
	})
	item.LastUpdate = timestamp.Now()
}
