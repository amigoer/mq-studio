package pulsar

import (
	"context"
	"fmt"
	"regexp"
	"sort"
	"sync"

	"github.com/apache/pulsar-client-go/pulsaradmin/pkg/utils"

	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * How a Pulsar dead-letter topic is found.
 *
 * Pulsar has no broker-side dead-letter object. What it has is a convention in
 * the official client libraries: a consumer configured with a DLQ policy
 * republishes to "<topic>-<subscription>-DLQ", and retries go to
 * "<topic>-<subscription>-RETRY". Nothing on the broker records the link -
 * both are ordinary topics that happen to be named that way.
 *
 * That is exactly why this family answers the page through DeadLetterTopology
 * rather than DeadLetterReader: there is no group to ask for its dead letters,
 * only a namespace to walk and names to recognise. It is the same shape
 * RabbitMQ has, where a dead-letter queue is whatever an exchange happens to
 * route to.
 *
 * The convention is the client library's, not this app's, which is what makes
 * it discoverable rather than invented.
 */
const (
	deadLetterSuffix = "DLQ"
	retrySuffix      = "RETRY"
)

// dlqName splits "<topic>-<subscription>-DLQ" back into its two halves.
//
// The subscription name may contain hyphens, and so may the topic, so there is
// no split that is right on its own. What resolves it is the topic list: the
// origin has to be a topic that actually exists in the namespace, and the
// longest such prefix is the answer.
var dlqPattern = regexp.MustCompile(
	`^(.*)-(` + deadLetterSuffix + `|` + retrySuffix + `)$`)

/*
 * DeadLetterQueues walks a namespace for topics named by the convention.
 *
 * Every match is reported even when its origin topic is gone. A "-DLQ" topic
 * whose source was deleted is a backlog nobody will ever look at and nothing
 * will ever drain, which is the case most worth surfacing - dropping it
 * because the link could not be resolved would hide exactly that.
 */
func (c *Conn) DeadLetterQueues(
	ctx context.Context, namespace string,
) ([]*model.DeadLetterQueue, error) {
	scope := c.namespaceScope(namespace)
	name, err := utils.GetNamespaceName(scope)
	if err != nil {
		return nil, fmt.Errorf("read the namespace %q: %w", scope, err)
	}

	partitioned, nonPartitioned, err := c.admin.Topics().ListWithContext(ctx, *name)
	if err != nil {
		return nil, fmt.Errorf("list the topics of %q: %w", scope, err)
	}

	// The partitions of a partitioned topic come back in the second list as
	// topics of their own; the parent stands for them, so walking both would
	// read every subscription once per partition.
	urls := make([]string, 0, len(partitioned)+len(nonPartitioned))
	urls = append(urls, partitioned...)
	for _, url := range nonPartitioned {
		if !isPartitionOf(url, partitioned) {
			urls = append(urls, url)
		}
	}

	// The short names of everything in the namespace, which is what decides
	// where a "<topic>-<subscription>-DLQ" name splits.
	existing := make(map[string]bool, len(urls))
	for _, url := range urls {
		if ref, _, err := parseTopicURL(url); err == nil {
			existing[ref.Name] = true
		}
	}

	candidates := make([]string, 0)
	for _, url := range urls {
		ref, _, err := parseTopicURL(url)
		if err != nil {
			continue
		}
		if dlqPattern.MatchString(ref.Name) {
			candidates = append(candidates, url)
		}
	}
	sort.Strings(candidates)
	if len(candidates) > listCap {
		candidates = candidates[:listCap]
	}

	queues := make([]*model.DeadLetterQueue, len(candidates))
	var wait sync.WaitGroup
	slots := make(chan struct{}, statsConcurrency)
	for i, url := range candidates {
		wait.Add(1)
		go func(i int, url string) {
			defer wait.Done()
			slots <- struct{}{}
			defer func() { <-slots }()
			queues[i] = c.deadLetterQueueOf(ctx, scope, url, existing)
		}(i, url)
	}
	wait.Wait()

	found := make([]*model.DeadLetterQueue, 0, len(queues))
	for _, queue := range queues {
		if queue != nil {
			found = append(found, queue)
		}
	}
	return found, nil
}

func (c *Conn) deadLetterQueueOf(
	ctx context.Context, namespace, url string, existing map[string]bool,
) *model.DeadLetterQueue {
	ref, _, err := parseTopicURL(url)
	if err != nil {
		return nil
	}

	queue := &model.DeadLetterQueue{
		Namespace: namespace,
		Name:      ref.Name,
		// Unknown rather than zero until the stats read succeeds: a
		// dead-letter topic reported as empty is one nobody investigates.
		Depth:     model.UnknownMetric,
		Consumers: model.UnknownMetric,
	}
	if origin, subscription, ok := splitDeadLetterName(ref.Name, existing); ok {
		queue.Sources = []*model.DeadLetterSource{{
			Queue:        origin,
			Subscription: subscription,
		}}
	}

	topic, err := utils.GetTopicName(url)
	if err != nil {
		return queue
	}
	stats, ok := c.topicStats(ctx, *topic)
	if !ok {
		return queue
	}

	// A dead-letter topic's depth is what it is holding, which is the deepest
	// subscription's backlog for the same reason a topic's is - one copy of
	// each message, read independently.
	queue.Depth = backlogOf(stats.subscriptions)
	consumers := 0
	for _, subscription := range stats.subscriptions {
		consumers += len(subscription.Consumers)
	}
	queue.Consumers = consumers
	return queue
}

/*
 * splitDeadLetterName finds where "<topic>-<subscription>-DLQ" divides.
 *
 * Both halves may contain hyphens, so no fixed split is right: "orders-eu-
 * archive-worker-DLQ" could be any of four topics. What decides it is the
 * namespace's own topic list - the origin has to be a topic that exists - and
 * the longest matching prefix wins, because a shorter one would name a topic
 * that happens to be a prefix of the real origin.
 *
 * Returns false when no prefix matches, which is the orphan case: the origin
 * topic was deleted, or the name only looks like the convention.
 */
func splitDeadLetterName(name string, existing map[string]bool) (topic, subscription string, ok bool) {
	match := dlqPattern.FindStringSubmatch(name)
	if match == nil {
		return "", "", false
	}
	stem := match[1]

	// Longest first: with topics "orders" and "orders-eu" both present, the
	// name "orders-eu-worker-DLQ" belongs to the second.
	best := -1
	for i := len(stem) - 1; i > 0; i-- {
		if stem[i] != '-' {
			continue
		}
		if existing[stem[:i]] && i > best {
			best = i
		}
	}
	if best < 0 {
		return "", "", false
	}
	return stem[:best], stem[best+1:], true
}
