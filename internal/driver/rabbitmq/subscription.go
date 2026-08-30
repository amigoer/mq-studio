package rabbitmq

import (
	"context"
	"fmt"
	"strconv"

	rabbithole "github.com/michaelklishin/rabbit-hole/v3"

	"github.com/amigoer/mq-studio/internal/model"
)

// Attribute keys this driver puts on a Subscription.
const (
	AttrPrefetch    = "prefetchCount"
	AttrAckRequired = "ackRequired"
	AttrChannels    = "channels"
)

// ListSubscriptions returns each queue that has consumers.
//
// This is where RabbitMQ diverges hardest from the families the canonical
// model was drawn against. It has no named consumer group: a consumer is a
// transient channel-level registration, and what actually carries a backlog
// and a set of consumers is the queue itself. So the two canonical nouns
// collapse onto one object here, and a subscription is a queue seen from the
// consuming side rather than a separate thing to enumerate.
func (c *Conn) ListSubscriptions(ctx context.Context) ([]*model.Subscription, error) {
	queues, err := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.QueueInfo, error) {
		return client.ListQueuesIn(c.vhost)
	})
	if err != nil {
		return nil, fmt.Errorf("list queues: %w", err)
	}
	consumers, err := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.ConsumerInfo, error) {
		return client.ListConsumersIn(c.vhost)
	})
	if err != nil {
		return nil, fmt.Errorf("list consumers: %w", err)
	}

	prefetch := make(map[string]int, len(consumers))
	channels := make(map[string]int, len(consumers))
	acking := make(map[string]bool, len(consumers))
	for _, consumer := range consumers {
		name := consumer.Queue.Name
		prefetch[name] += consumer.PrefetchCount
		channels[name]++
		if bool(consumer.AcknowledgementMode) {
			acking[name] = true
		}
	}

	subscriptions := make([]*model.Subscription, 0, len(queues))
	for i := range queues {
		queue := queues[i]
		if isInternalQueue(queue.Name) || queue.Consumers == 0 {
			continue
		}
		subscriptions = append(subscriptions, &model.Subscription{
			Ref:     model.SubscriptionRef{Namespace: queue.Vhost, Name: queue.Name},
			Status:  subscriptionStatus(queue.Consumers, queue.MessagesUnacknowledged),
			Members: queue.Consumers,
			// One, always: a RabbitMQ consumer reads exactly the queue it is
			// attached to, so there is nothing to count here.
			Destinations: 1,
			Backlog:      int64(queue.MessagesReady + queue.MessagesUnacknowledged),
			RateOut:      deliverRate(&queue),
			Attributes: map[string]string{
				AttrPrefetch:    strconv.Itoa(prefetch[queue.Name]),
				AttrChannels:    strconv.Itoa(channels[queue.Name]),
				AttrAckRequired: strconv.FormatBool(acking[queue.Name]),
				AttrReady:       strconv.Itoa(queue.MessagesReady),
				AttrUnacked:     strconv.Itoa(queue.MessagesUnacknowledged),
			},
		})
	}
	return subscriptions, nil
}

// SubscriptionDetail returns one queue's consuming side.
func (c *Conn) SubscriptionDetail(ctx context.Context, ref model.SubscriptionRef) (*model.Subscription, error) {
	all, err := c.ListSubscriptions(ctx)
	if err != nil {
		return nil, err
	}
	for _, subscription := range all {
		if subscription.Ref.Name == ref.Name {
			return subscription, nil
		}
	}
	return nil, fmt.Errorf("queue %q has no consumers", ref.Name)
}

// CreateSubscription and RemoveSubscription have no meaning: a consumer
// appears when an application attaches and disappears when it detaches, so
// neither capability is declared and the UI never offers the buttons.
func (c *Conn) CreateSubscription(ctx context.Context, spec model.SubscriptionSpec) error {
	return fmt.Errorf("rabbitmq consumers are created by applications, not by an admin API")
}

func (c *Conn) UpdateSubscription(ctx context.Context, spec model.SubscriptionSpec) error {
	return fmt.Errorf("rabbitmq consumers cannot be reconfigured from an admin API")
}

func (c *Conn) RemoveSubscription(ctx context.Context, ref model.SubscriptionRef) error {
	return fmt.Errorf("rabbitmq consumers detach on their own, they are not deleted")
}

// subscriptionStatus reads health off what the queue reports.
//
// There is no heartbeat to check, so the signal is whether anyone is attached
// and whether unacknowledged work is piling up behind them.
func subscriptionStatus(consumers, unacked int) model.SubscriptionStatus {
	switch {
	case consumers == 0:
		return model.SubscriptionOffline
	case unacked > 0:
		return model.SubscriptionWarning
	default:
		return model.SubscriptionOnline
	}
}
