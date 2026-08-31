package rabbitmq

import (
	"context"
	"fmt"

	rabbithole "github.com/michaelklishin/rabbit-hole/v3"

	"github.com/amigoer/mq-studio/internal/model"
)

// DeadLetterQueues finds the queues dead letters land in, by walking the
// topology backwards.
//
// Nothing on the broker marks a queue as a dead-letter queue. What exists is
// the other end: a queue declared with x-dead-letter-exchange, an exchange
// that routes like any other, and whatever that exchange is bound to. This
// follows that chain - source queue, its dead-letter exchange, the bindings
// out of it - and reports the far end grouped by the queues that feed it.
func (c *Conn) DeadLetterQueues(ctx context.Context, namespace string) ([]*model.DeadLetterQueue, error) {
	vhost := c.vhostOr(namespace)

	queues, err := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.QueueInfo, error) {
		return client.ListQueuesIn(vhost)
	})
	if err != nil {
		return nil, fmt.Errorf("list queues: %w", err)
	}
	bindings, err := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.BindingInfo, error) {
		return client.ListBindingsIn(vhost)
	})
	if err != nil {
		return nil, fmt.Errorf("list bindings: %w", err)
	}

	byQueue := make(map[string]*rabbithole.QueueInfo, len(queues))
	for i := range queues {
		byQueue[queues[i].Name] = &queues[i]
	}

	// targets maps a dead-letter queue's name to the sources feeding it, in
	// declaration order so the page is stable between reads.
	targets := map[string][]*model.DeadLetterSource{}
	var order []string

	for i := range queues {
		source := &queues[i]
		exchange, declared := stringArgument(source.Arguments, ArgDeadLetterExchange)
		if !declared {
			continue
		}
		routingKey, _ := stringArgument(source.Arguments, ArgDeadLetterRoutingKey)

		for _, name := range deadLetterTargets(source, exchange, routingKey, bindings) {
			// A queue that dead-letters to itself is a loop, not a
			// dead-letter queue, and listing it would tell the reader the
			// opposite of what is happening.
			if name == source.Name {
				continue
			}
			if _, seen := targets[name]; !seen {
				order = append(order, name)
			}
			targets[name] = append(targets[name], &model.DeadLetterSource{
				Queue:      source.Name,
				Exchange:   exchange,
				RoutingKey: routingKey,
			})
		}
	}

	found := make([]*model.DeadLetterQueue, 0, len(order))
	for _, name := range order {
		queue, present := byQueue[name]
		if !present {
			// Bound to something that no longer exists. Reporting it as a
			// queue with an unknown depth would be worse than leaving it out:
			// the page is about backlogs, and this has none.
			continue
		}
		found = append(found, &model.DeadLetterQueue{
			Namespace: queue.Vhost,
			Name:      queue.Name,
			Depth:     int64(queue.MessagesReady + queue.MessagesUnacknowledged),
			Consumers: queue.Consumers,
			Sources:   targets[name],
		})
	}
	return found, nil
}

// deadLetterTargets is where one source queue's dead letters actually go.
//
// The default exchange is a special case worth handling rather than skipping:
// dead-lettering to it with a routing key sends straight to the queue of that
// name, and it is the simplest working setup there is.
func deadLetterTargets(
	source *rabbithole.QueueInfo,
	exchange, routingKey string,
	bindings []rabbithole.BindingInfo,
) []string {
	if exchange == "" {
		// The default exchange routes by queue name. With no routing key the
		// message keeps its own, which on the default exchange means it comes
		// straight back to the queue it died in.
		if routingKey == "" {
			return nil
		}
		return []string{routingKey}
	}

	var names []string
	seen := map[string]bool{}
	for _, binding := range bindings {
		if binding.Source != exchange || binding.DestinationType != "queue" {
			continue
		}
		// An empty dead-letter routing key means the message keeps the one it
		// arrived with, so which binding matches cannot be known from here -
		// every queue on the exchange is a possible destination, and showing
		// them all is more honest than picking one.
		if routingKey != "" && binding.RoutingKey != routingKey && binding.RoutingKey != "" {
			continue
		}
		if !seen[binding.Destination] {
			seen[binding.Destination] = true
			names = append(names, binding.Destination)
		}
	}
	return names
}

// stringArgument reads a queue argument that should be a string, reporting
// whether it was there at all - an argument declared with an empty value means
// something different from one that was never declared.
func stringArgument(arguments map[string]interface{}, key string) (string, bool) {
	raw, present := arguments[key]
	if !present {
		return "", false
	}
	if text, ok := raw.(string); ok {
		return text, true
	}
	return fmt.Sprint(raw), true
}
