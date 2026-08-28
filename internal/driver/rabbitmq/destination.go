package rabbitmq

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	rabbithole "github.com/michaelklishin/rabbit-hole/v2"

	"github.com/amigoer/mq-studio/internal/model"
)

// Attribute keys this driver puts on a Destination. They are a contract with
// frontend/src/mq/rabbitmq.
const (
	AttrDurable    = "durable"
	AttrAutoDelete = "autoDelete"
	AttrExclusive  = "exclusive"
	AttrQueueType  = "queueType"
	AttrNode       = "node"
	AttrState      = "state"
	AttrReady      = "messagesReady"
	AttrUnacked    = "messagesUnacknowledged"
	AttrMemory     = "memory"
)

// ListDestinations returns the queues in the connection's vhost.
//
// One request answers the whole list page: depth, consumer count and both
// rates all come back with the queue, which is why this driver needs no
// per-queue enrichment pass.
func (c *Conn) ListDestinations(ctx context.Context, filter model.DestinationFilter) ([]*model.Destination, error) {
	vhost := c.vhostOr(filter.Namespace)
	queues, err := c.client.ListQueuesIn(vhost)
	if err != nil {
		return nil, fmt.Errorf("list queues: %w", err)
	}

	destinations := make([]*model.Destination, 0, len(queues))
	for i := range queues {
		queue := queues[i]
		if !filter.IncludeInternal && isInternalQueue(queue.Name) {
			continue
		}
		destinations = append(destinations, destinationFromQueue(&queue))
	}
	return destinations, nil
}

// DestinationDetail returns one queue.
func (c *Conn) DestinationDetail(ctx context.Context, ref model.DestinationRef) (*model.Destination, error) {
	queue, err := c.client.GetQueue(c.vhostOr(ref.Namespace), ref.Name)
	if err != nil {
		return nil, fmt.Errorf("get queue %q: %w", ref.Name, err)
	}
	// DetailedQueueInfo is a QueueInfo alias; the conversion is what lets one
	// mapping serve both the list and the detail view.
	info := rabbithole.QueueInfo(*queue)
	return destinationFromQueue(&info), nil
}

// CreateDestination declares a queue.
func (c *Conn) CreateDestination(ctx context.Context, spec model.DestinationSpec) error {
	settings := rabbithole.QueueSettings{
		Durable:    spec.Attributes[AttrDurable] != "false",
		AutoDelete: spec.Attributes[AttrAutoDelete] == "true",
	}
	if queueType := spec.Attributes[AttrQueueType]; queueType != "" {
		settings.Arguments = map[string]interface{}{"x-queue-type": queueType}
	}
	_, err := c.client.DeclareQueue(c.vhostOr(spec.Ref.Namespace), spec.Ref.Name, settings)
	if err != nil {
		return fmt.Errorf("declare queue %q: %w", spec.Ref.Name, err)
	}
	return nil
}

// UpdateDestination is not offered: a queue's durability and type are fixed at
// declaration, so the connection never declares destination.update and the UI
// never shows an edit control.
func (c *Conn) UpdateDestination(ctx context.Context, spec model.DestinationSpec) error {
	return fmt.Errorf("rabbitmq queues cannot be reconfigured after declaration")
}

// RemoveDestination deletes a queue.
func (c *Conn) RemoveDestination(ctx context.Context, ref model.DestinationRef) error {
	_, err := c.client.DeleteQueue(c.vhostOr(ref.Namespace), ref.Name)
	if err != nil {
		return fmt.Errorf("delete queue %q: %w", ref.Name, err)
	}
	return nil
}

func (c *Conn) vhostOr(namespace string) string {
	if strings.TrimSpace(namespace) != "" {
		return namespace
	}
	return c.vhost
}

// isInternalQueue hides what RabbitMQ creates for itself, the same way the
// RocketMQ driver hides its system topics.
func isInternalQueue(name string) bool {
	return strings.HasPrefix(name, "amq.")
}

// deliverRate is how fast consumers are draining a queue.
func deliverRate(queue *rabbithole.QueueInfo) int {
	if queue.MessageStats == nil {
		return 0
	}
	return int(queue.MessageStats.DeliverGetDetails.Rate)
}

func destinationFromQueue(queue *rabbithole.QueueInfo) *model.Destination {
	rateIn, rateOut := 0, 0
	if queue.MessageStats != nil {
		rateIn = int(queue.MessageStats.PublishDetails.Rate)
		rateOut = int(queue.MessageStats.DeliverGetDetails.Rate)
	}

	return &model.Destination{
		Ref: model.DestinationRef{Namespace: queue.Vhost, Name: queue.Name},
		// A queue has no partitions. Reporting zero would read as "measured,
		// and it is one"; the sentinel is what makes the column render an em
		// dash instead.
		Partitions:  model.UnknownMetric,
		Subscribers: queue.Consumers,
		Depth:       int64(queue.MessagesReady + queue.MessagesUnacknowledged),
		RateIn:      rateIn,
		RateOut:     rateOut,
		Attributes: map[string]string{
			AttrDurable:    strconv.FormatBool(queue.Durable),
			AttrAutoDelete: strconv.FormatBool(bool(queue.AutoDelete)),
			AttrExclusive:  strconv.FormatBool(queue.Exclusive),
			AttrQueueType:  queue.Type,
			AttrNode:       queue.Node,
			AttrState:      queue.Status,
			AttrReady:      strconv.Itoa(queue.MessagesReady),
			AttrUnacked:    strconv.Itoa(queue.MessagesUnacknowledged),
			AttrMemory:     strconv.FormatInt(queue.Memory, 10),
		},
	}
}
