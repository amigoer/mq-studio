package pulsar

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"sync"

	"github.com/apache/pulsar-client-go/pulsaradmin/pkg/utils"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/timestamp"
)

/*
 * ListSubscriptions walks the namespace's topics.
 *
 * There is no cluster-wide subscription listing to ask for. A Pulsar
 * subscription belongs to a topic and is named only within it, so the only way
 * to enumerate them is to read every topic's stats - which is why this is the
 * one listing in the driver that costs a request per topic and why it is
 * bounded the same way the topic listing is.
 *
 * The port takes no scope, so the scope is the connection's own namespace.
 * That is the same namespace every other page opens on, so a subscription
 * missing from this list is a subscription in another namespace rather than
 * one that is not there.
 */
func (c *Conn) ListSubscriptions(ctx context.Context) ([]*model.Subscription, error) {
	namespace := c.config.scope()
	name, err := utils.GetNamespaceName(namespace)
	if err != nil {
		return nil, fmt.Errorf("read the namespace %q: %w", namespace, err)
	}

	partitioned, nonPartitioned, err := c.admin.Topics().ListWithContext(ctx, *name)
	if err != nil {
		return nil, fmt.Errorf("list the topics of %q: %w", namespace, err)
	}

	urls := make([]string, 0, len(partitioned)+len(nonPartitioned))
	urls = append(urls, partitioned...)
	urls = append(urls, nonPartitioned...)
	sort.Strings(urls)
	if len(urls) > listCap {
		urls = urls[:listCap]
	}

	var (
		guard         sync.Mutex
		subscriptions []*model.Subscription
		wait          sync.WaitGroup
	)
	slots := make(chan struct{}, statsConcurrency)
	for _, url := range urls {
		wait.Add(1)
		go func(url string) {
			defer wait.Done()
			slots <- struct{}{}
			defer func() { <-slots }()

			found := c.subscriptionsOf(ctx, url)
			guard.Lock()
			subscriptions = append(subscriptions, found...)
			guard.Unlock()
		}(url)
	}
	wait.Wait()

	// Sorted and numbered after the fan-out, because goroutines finish in
	// whatever order they finish in and a list that reshuffles on every
	// refresh is unusable.
	sort.Slice(subscriptions, func(i, j int) bool {
		left, right := subscriptions[i].Ref, subscriptions[j].Ref
		if left.Namespace != right.Namespace {
			return left.Namespace < right.Namespace
		}
		return left.Name < right.Name
	})
	for i, subscription := range subscriptions {
		subscription.ID = i + 1
	}
	return subscriptions, nil
}

// subscriptionsOf is every subscription on one topic.
func (c *Conn) subscriptionsOf(ctx context.Context, url string) []*model.Subscription {
	topic, err := utils.GetTopicName(url)
	if err != nil {
		return nil
	}
	stats, ok := c.topicStats(ctx, *topic)
	if !ok {
		return nil
	}

	names := make([]string, 0, len(stats.subscriptions))
	for name := range stats.subscriptions {
		names = append(names, name)
	}
	sort.Strings(names)

	subscriptions := make([]*model.Subscription, 0, len(names))
	for _, name := range names {
		subscriptions = append(subscriptions,
			newSubscription(url, name, stats.subscriptions[name]))
	}
	return subscriptions
}

// topicStatsResult is the subscription map out of whichever stats endpoint
// answered for this topic's shape.
type topicStatsResult struct {
	subscriptions map[string]utils.SubscriptionStats
}

// topicStats reads a topic's subscriptions through the endpoint its shape
// answers at, the same fall-through the topic listing uses.
func (c *Conn) topicStats(ctx context.Context, topic utils.TopicName) (topicStatsResult, bool) {
	stats, err := c.admin.Topics().GetPartitionedStatsWithContext(ctx, topic, false)
	if err == nil {
		return topicStatsResult{subscriptions: stats.Subscriptions}, true
	}
	if statusOf(err) != http.StatusNotFound {
		return topicStatsResult{}, false
	}
	plain, err := c.admin.Topics().GetStatsWithContext(ctx, topic)
	if err != nil {
		return topicStatsResult{}, false
	}
	return topicStatsResult{subscriptions: plain.Subscriptions}, true
}

func newSubscription(
	topic, name string, stats utils.SubscriptionStats,
) *model.Subscription {
	subscription := &model.Subscription{
		Ref:     subscriptionRef(topic, name),
		Status:  subscriptionStatus(stats),
		Members: len(stats.Consumers),
		// A Pulsar subscription belongs to exactly one topic. The count is not
		// a figure that could be missing.
		Destinations: 1,
		Backlog:      stats.MsgBacklog,
		RateOut:      int(stats.MsgRateOut),
		LastUpdated:  timestamp.FromUnixMilli(stats.LastConsumedTimestamp),
		Attributes: map[string]string{
			AttrSubscriptionTopic:         topic,
			AttrSubscriptionType:          stats.SubType,
			AttrSubscriptionDurable:       strconv.FormatBool(stats.IsDurable),
			AttrSubscriptionUnacked:       strconv.FormatInt(stats.UnAckedMessages, 10),
			AttrSubscriptionDelayed:       strconv.FormatInt(stats.MsgDelayed, 10),
			AttrSubscriptionBacklogB:      strconv.FormatInt(stats.BacklogSize, 10),
			AttrSubscriptionBlocked:       strconv.FormatBool(stats.BlockedSubscriptionOnUnackedMsgs),
			AttrSubscriptionRedeliverRate: strconv.Itoa(int(stats.MsgRateRedeliver)),
		},
	}
	if stats.ActiveConsumerName != "" {
		subscription.Attributes[AttrSubscriptionActiveConsumer] = stats.ActiveConsumerName
	}
	return subscription
}

/*
 * subscriptionStatus reads the two states a Pulsar subscription can be in that
 * an operator has to act on.
 *
 * Blocked is the one worth its own state: the subscription has hit its unacked
 * limit and the broker has stopped delivering to it entirely. It looks exactly
 * like a stalled consumer from the backlog alone, and is fixed somewhere
 * completely different.
 */
func subscriptionStatus(stats utils.SubscriptionStats) model.SubscriptionStatus {
	switch {
	case stats.BlockedSubscriptionOnUnackedMsgs:
		return model.SubscriptionWarning
	case len(stats.Consumers) == 0:
		return model.SubscriptionOffline
	default:
		return model.SubscriptionOnline
	}
}

// SubscriptionDetail is one subscription on one topic.
func (c *Conn) SubscriptionDetail(
	ctx context.Context, ref model.SubscriptionRef,
) (*model.Subscription, error) {
	url, err := subscriptionTopic(ref)
	if err != nil {
		return nil, err
	}
	topic, err := utils.GetTopicName(url)
	if err != nil {
		return nil, err
	}
	stats, ok := c.topicStats(ctx, *topic)
	if !ok {
		return nil, fmt.Errorf("read the stats of %s", url)
	}
	found, ok := stats.subscriptions[ref.Name]
	if !ok {
		return nil, fmt.Errorf("no subscription %q on %s", ref.Name, url)
	}
	return newSubscription(url, ref.Name, found), nil
}

/*
 * CreateSubscription adds one at the earliest message the topic still holds.
 *
 * Pulsar is the second family after RocketMQ that can do this at all: a
 * subscription is a cursor the broker stores, and creating one from the admin
 * API is how a consumer that has not connected yet stops missing everything
 * published before it does.
 *
 * Earliest rather than latest, and deliberately: a subscription created at the
 * latest position silently discards whatever is already on the topic, which is
 * the opposite of why somebody creates one ahead of time.
 */
func (c *Conn) CreateSubscription(ctx context.Context, spec model.SubscriptionSpec) error {
	url, err := subscriptionTopic(spec.Ref)
	if err != nil {
		return err
	}
	topic, err := utils.GetTopicName(url)
	if err != nil {
		return err
	}

	position := utils.Earliest
	if spec.Attributes[AttrSubscriptionStartAt] == StartAtLatest {
		position = utils.Latest
	}
	if err := c.admin.Subscriptions().CreateWithContext(
		ctx, *topic, spec.Ref.Name, position); err != nil {
		return fmt.Errorf("create subscription %q on %s: %w", spec.Ref.Name, url, err)
	}
	return nil
}

/*
 * UpdateSubscription has nothing to change.
 *
 * A Pulsar subscription is a name and a cursor. The type - Exclusive, Shared,
 * Failover, Key_Shared - is chosen by the consumers that attach to it, not
 * stored as configuration, so there is no admin-side edit. Moving the cursor
 * is CapOffsetReset, which is a separate control with a separate confirmation
 * because it discards or replays messages.
 */
func (c *Conn) UpdateSubscription(_ context.Context, _ model.SubscriptionSpec) error {
	return fmt.Errorf(
		"a pulsar subscription has nothing to edit: its type is chosen by the " +
			"consumers that attach, and its position is moved by resetting the cursor")
}

// RemoveSubscription deletes one.
//
// Not forced: Pulsar refuses while a consumer is still attached, and that
// refusal is the point. Forcing it disconnects them mid-flight.
func (c *Conn) RemoveSubscription(ctx context.Context, ref model.SubscriptionRef) error {
	url, err := subscriptionTopic(ref)
	if err != nil {
		return err
	}
	topic, err := utils.GetTopicName(url)
	if err != nil {
		return err
	}
	if err := c.admin.Subscriptions().DeleteWithContext(ctx, *topic, ref.Name); err != nil {
		return fmt.Errorf("delete subscription %q on %s: %w", ref.Name, url, err)
	}
	return nil
}

// SubscriptionStats is the detail panel's figures for one subscription.
func (c *Conn) SubscriptionStats(
	ctx context.Context, ref model.SubscriptionRef,
) (map[string]interface{}, error) {
	url, err := subscriptionTopic(ref)
	if err != nil {
		return nil, err
	}
	topic, err := utils.GetTopicName(url)
	if err != nil {
		return nil, err
	}

	stats, err := c.admin.Topics().GetStatsWithContext(ctx, *topic)
	if err != nil {
		partitioned, partErr := c.admin.Topics().GetPartitionedStatsWithContext(ctx, *topic, false)
		if partErr != nil {
			return nil, fmt.Errorf("read the stats of %s: %w", url, err)
		}
		stats.Subscriptions = partitioned.Subscriptions
	}
	found, ok := stats.Subscriptions[ref.Name]
	if !ok {
		return nil, fmt.Errorf("no subscription %q on %s", ref.Name, url)
	}

	return map[string]interface{}{
		"type":              found.SubType,
		"backlog":           found.MsgBacklog,
		"backlogBytes":      found.BacklogSize,
		"backlogNoDelayed":  found.MsgBacklogNoDelayed,
		"delayed":           found.MsgDelayed,
		"unacked":           found.UnAckedMessages,
		"blocked":           found.BlockedSubscriptionOnUnackedMsgs,
		"durable":           found.IsDurable,
		"msgRateOut":        found.MsgRateOut,
		"msgRateRedeliver":  found.MsgRateRedeliver,
		"msgRateExpired":    found.MsgRateExpired,
		"consumers":         len(found.Consumers),
		"lastConsumedAt":    timestamp.FromUnixMilli(found.LastConsumedTimestamp),
		"lastAckedAt":       timestamp.FromUnixMilli(found.LastAckedTimestamp),
		"earliestInBacklog": timestamp.FromUnixMilli(found.EarliestMsgPublishTimeInBacklog),
	}, nil
}

/*
 * SubscriptionClients is who is attached, and what each of them is doing.
 *
 * The broker answers this, not the clients: Pulsar reports every consumer's
 * permits, unacked count and redelivery rate as part of the topic's stats. So
 * unlike RocketMQ this needs no round trip to the consumer, and unlike Kafka
 * it can be answered at all.
 */
func (c *Conn) SubscriptionClients(
	ctx context.Context, ref model.SubscriptionRef,
) ([]*model.SubscriptionClient, error) {
	url, err := subscriptionTopic(ref)
	if err != nil {
		return nil, err
	}
	topic, err := utils.GetTopicName(url)
	if err != nil {
		return nil, err
	}
	stats, ok := c.topicStats(ctx, *topic)
	if !ok {
		return nil, fmt.Errorf("read the stats of %s", url)
	}
	found, ok := stats.subscriptions[ref.Name]
	if !ok {
		return nil, fmt.Errorf("no subscription %q on %s", ref.Name, url)
	}

	clients := make([]*model.SubscriptionClient, 0, len(found.Consumers))
	for _, consumer := range found.Consumers {
		clients = append(clients, &model.SubscriptionClient{
			ClientID: consumer.ConsumerName,
			// Assignments and Throughput are left empty rather than filled in
			// approximately. Assignments describes queues a consumer holds,
			// which Pulsar has no equivalent of - a Shared subscription
			// dispatches per message, not per partition - and Throughput is
			// pull latencies the broker does not measure per consumer. What
			// Pulsar does report goes in Properties, which is free-form for
			// exactly this reason.
			Properties: consumerProperties(consumer),
		})
	}
	return clients, nil
}

// consumerProperties is what the broker knows about one attached consumer.
//
// Free-form because none of it is worth a canonical field and every family
// names its own differently. Blocked and the permit count are the two an
// operator acts on: a consumer with no permits has stopped asking for
// messages, which looks identical to a slow one from the rate alone.
func consumerProperties(consumer utils.ConsumerStats) map[string]string {
	properties := map[string]string{
		"address":          consumer.Address,
		"clientVersion":    consumer.ClientVersion,
		"connectedSince":   consumer.ConnectedSince,
		"availablePermits": strconv.Itoa(consumer.AvailablePermits),
		"unackedMessages":  strconv.Itoa(consumer.UnAckedMessages),
		"blocked":          strconv.FormatBool(consumer.BlockedConsumerOnUnAckedMsgs),
		"msgRateRedeliver": strconv.Itoa(int(consumer.MsgRateRedeliver)),
		"msgRateOut":       strconv.Itoa(int(consumer.MsgRateOut)),
		"messageAckRate":   strconv.Itoa(int(consumer.MessageAckRate)),
	}
	for key, value := range consumer.Metadata {
		properties["meta."+key] = value
	}
	return properties
}
