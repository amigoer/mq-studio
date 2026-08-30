package rocketmq

import (
	"context"
	"encoding/json"
	"strconv"

	"github.com/amigoer/mq-studio/internal/model"
)

// Attribute keys this driver puts on a Subscription.
const (
	AttrConsumeMode   = "consumeMode"
	AttrMaxRetry      = "maxRetry"
	AttrRetryQps      = "retryQps"
	AttrDLQ           = "dlq"
	AttrRemark        = "remark"
	AttrBrokerAddr    = "brokerAddr"
	AttrSubscriptions = "subscriptions"
	AttrClients       = "clients"
)

// ListSubscriptions returns the consumer groups.
func (c *Conn) ListSubscriptions(ctx context.Context) ([]*model.Subscription, error) {
	groups, err := c.GetConsumerGroups(ctx)
	if err != nil {
		return nil, err
	}
	subscriptions := make([]*model.Subscription, 0, len(groups))
	for _, group := range groups {
		subscriptions = append(subscriptions, subscriptionFromGroup(group))
	}
	return subscriptions, nil
}

// SubscriptionDetail returns one consumer group with its clients.
func (c *Conn) SubscriptionDetail(ctx context.Context, ref model.SubscriptionRef) (*model.Subscription, error) {
	group, err := c.GetConsumerGroupDetail(ctx, ref.Name)
	if err != nil {
		return nil, err
	}
	return subscriptionFromGroup(group), nil
}

// CreateSubscription adds a consumer group on the target broker.
func (c *Conn) CreateSubscription(ctx context.Context, spec model.SubscriptionSpec) error {
	return c.CreateConsumerGroup(ctx, spec.Ref.Name,
		spec.Attributes[AttrBrokerAddr], spec.Attributes[AttrConsumeMode],
		atoiOr(spec.Attributes[AttrMaxRetry], 0))
}

// RemoveSubscription deletes a consumer group.
func (c *Conn) RemoveSubscription(ctx context.Context, ref model.SubscriptionRef) error {
	return c.DeleteConsumerGroup(ctx, ref.Name, ref.Namespace)
}

// UpdateSubscription changes an existing consumer group's configuration.
func (c *Conn) UpdateSubscription(ctx context.Context, spec model.SubscriptionSpec) error {
	return c.UpdateConsumerGroup(ctx, spec.Ref.Name,
		spec.Attributes[AttrBrokerAddr], spec.Attributes[AttrConsumeMode],
		atoiOr(spec.Attributes[AttrMaxRetry], 0))
}

// ResetOffset moves a consumer group's read position.
func (c *Conn) ResetOffset(ctx context.Context, request model.ResetOffsetRequest) error {
	return c.ResetConsumerOffset(ctx, request.Group, request.Topic, request.Timestamp, request.Force)
}

// SubscriptionStats reports the per-queue consume progress of a group.
func (c *Conn) SubscriptionStats(ctx context.Context, ref model.SubscriptionRef) (map[string]interface{}, error) {
	return c.GetConsumeStats(ctx, ref.Name)
}

func subscriptionStatusFrom(status model.GroupStatus) model.SubscriptionStatus {
	switch status {
	case model.GroupOnline:
		return model.SubscriptionOnline
	case model.GroupWarning:
		return model.SubscriptionWarning
	default:
		return model.SubscriptionOffline
	}
}

func subscriptionFromGroup(group *model.ConsumerGroupItem) *model.Subscription {
	if group == nil {
		return nil
	}
	attributes := map[string]string{
		AttrConsumeMode: string(group.ConsumeMode),
		AttrMaxRetry:    strconv.Itoa(group.MaxRetry),
		AttrRetryQps:    strconv.Itoa(group.RetryQps),
		AttrDLQ:         strconv.Itoa(group.DLQ),
		AttrRemark:      group.Remark,
		AttrCluster:     group.Cluster,
	}
	if len(group.Subscriptions) > 0 {
		if encoded, err := json.Marshal(group.Subscriptions); err == nil {
			attributes[AttrSubscriptions] = string(encoded)
		}
	}
	if len(group.Clients) > 0 {
		if encoded, err := json.Marshal(group.Clients); err == nil {
			attributes[AttrClients] = string(encoded)
		}
	}

	return &model.Subscription{
		Ref:          model.SubscriptionRef{Namespace: group.Cluster, Name: group.Group},
		Status:       subscriptionStatusFrom(group.Status),
		Members:      group.OnlineClients,
		Destinations: group.TopicCount,
		Backlog:      group.Lag,
		RateOut:      model.UnknownMetric,
		LastUpdated:  group.LastUpdate,
		Attributes:   attributes,
	}
}

// GroupFromSubscription rebuilds the RocketMQ shape the current bridge still
// speaks. It disappears when the renderer moves onto the canonical model.
func GroupFromSubscription(subscription *model.Subscription) *model.ConsumerGroupItem {
	if subscription == nil {
		return nil
	}
	group := &model.ConsumerGroupItem{
		ID:            subscription.ID,
		Group:         subscription.Ref.Name,
		Cluster:       subscription.Attribute(AttrCluster),
		ConsumeMode:   model.ConsumeMode(subscription.Attribute(AttrConsumeMode)),
		Status:        groupStatusFrom(subscription.Status),
		OnlineClients: subscription.Members,
		TopicCount:    subscription.Destinations,
		Lag:           subscription.Backlog,
		RetryQps:      atoiOr(subscription.Attribute(AttrRetryQps), 0),
		DLQ:           atoiOr(subscription.Attribute(AttrDLQ), 0),
		MaxRetry:      atoiOr(subscription.Attribute(AttrMaxRetry), 0),
		LastUpdate:    subscription.LastUpdated,
		Remark:        subscription.Attribute(AttrRemark),
	}
	if encoded := subscription.Attribute(AttrSubscriptions); encoded != "" {
		var subs []model.GroupSubscription
		if json.Unmarshal([]byte(encoded), &subs) == nil {
			group.Subscriptions = subs
		}
	}
	if encoded := subscription.Attribute(AttrClients); encoded != "" {
		var clients []model.GroupClient
		if json.Unmarshal([]byte(encoded), &clients) == nil {
			group.Clients = clients
		}
	}
	return group
}

func groupStatusFrom(status model.SubscriptionStatus) model.GroupStatus {
	switch status {
	case model.SubscriptionOnline:
		return model.GroupOnline
	case model.SubscriptionWarning:
		return model.GroupWarning
	default:
		return model.GroupOffline
	}
}
