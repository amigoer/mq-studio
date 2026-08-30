package rabbitmq

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	rabbithole "github.com/michaelklishin/rabbit-hole/v3"

	"github.com/amigoer/mq-studio/internal/model"
)

// Attribute keys this driver puts on a Destination. They are a contract with
// frontend/src/mq/rabbitmq.
const (
	AttrDurable      = "durable"
	AttrAutoDelete   = "autoDelete"
	AttrExclusive    = "exclusive"
	AttrQueueType    = "queueType"
	AttrNode         = "node"
	AttrState        = "state"
	AttrReady        = "messagesReady"
	AttrUnacked      = "messagesUnacknowledged"
	AttrMemory       = "memory"
	AttrMessageBytes = "messageBytes"
	AttrPolicy       = "policy"
	AttrLeader       = "leader"
	AttrMembers      = "members"
	AttrOnline       = "onlineMembers"
	AttrUtilisation  = "consumerUtilisation"
	AttrArguments    = "arguments"
)

// The queue arguments this driver names, so the frontend can label them rather
// than printing raw x- keys at the reader. Anything else the queue carries
// still travels in AttrArguments untouched.
const (
	ArgMessageTTL           = "x-message-ttl"
	ArgExpires              = "x-expires"
	ArgDeadLetterExchange   = "x-dead-letter-exchange"
	ArgDeadLetterRoutingKey = "x-dead-letter-routing-key"
	ArgMaxLength            = "x-max-length"
	ArgMaxLengthBytes       = "x-max-length-bytes"
	ArgOverflow             = "x-overflow"
	ArgMaxPriority          = "x-max-priority"
	ArgSingleActiveConsumer = "x-single-active-consumer"
	ArgQueueType            = "x-queue-type"
)

// ListDestinations returns the queues in the connection's vhost.
//
// One request answers the whole list page: depth, consumer count and both
// rates all come back with the queue, which is why this driver needs no
// per-queue enrichment pass.
func (c *Conn) ListDestinations(ctx context.Context, filter model.DestinationFilter) ([]*model.Destination, error) {
	vhost := c.vhostOr(filter.Namespace)
	queues, err := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.QueueInfo, error) {
		return client.ListQueuesIn(vhost)
	})
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
	queue, err := call(ctx, c.mgmt, func(client *rabbithole.Client) (*rabbithole.DetailedQueueInfo, error) {
		return client.GetQueue(c.vhostOr(ref.Namespace), ref.Name)
	})
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
	err := exec(ctx, c.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.DeclareQueue(c.vhostOr(spec.Ref.Namespace), spec.Ref.Name, settings)
	})
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
	err := exec(ctx, c.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.DeleteQueue(c.vhostOr(ref.Namespace), ref.Name)
	})
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

	attributes := map[string]string{
		AttrDurable:      strconv.FormatBool(queue.Durable),
		AttrAutoDelete:   strconv.FormatBool(bool(queue.AutoDelete)),
		AttrExclusive:    strconv.FormatBool(queue.Exclusive),
		AttrQueueType:    queueTypeOf(queue),
		AttrNode:         queue.Node,
		AttrState:        queue.Status,
		AttrReady:        strconv.Itoa(queue.MessagesReady),
		AttrUnacked:      strconv.Itoa(queue.MessagesUnacknowledged),
		AttrMemory:       strconv.FormatInt(queue.Memory, 10),
		AttrMessageBytes: strconv.FormatInt(queue.MessagesBytes, 10),
		AttrPolicy:       queue.Policy,
		AttrArguments:    encodeArguments(queue.Arguments),
	}

	// Replication is a quorum and stream concept. A classic queue lives on one
	// node and reports none of this, so the keys stay absent rather than
	// carrying an empty list that would read as "replicated nowhere".
	if queue.Leader != "" {
		attributes[AttrLeader] = queue.Leader
	}
	if len(queue.Members) > 0 {
		attributes[AttrMembers] = strings.Join(queue.Members, ",")
		attributes[AttrOnline] = strings.Join(queue.Online, ",")
	}
	// Utilisation is only meaningful with a consumer attached: the broker
	// reports 0 for an unconsumed queue, which reads as "consumers are idle"
	// rather than "there are none".
	if queue.Consumers > 0 {
		attributes[AttrUtilisation] = strconv.FormatFloat(queue.ConsumerUtilisation, 'f', 2, 64)
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
		Attributes:  attributes,
	}
}

// queueTypeOf falls back to classic, which is what the broker means by an
// absent type: it only names the type when it is not the default.
func queueTypeOf(queue *rabbithole.QueueInfo) string {
	if queue.Type != "" {
		return queue.Type
	}
	if declared, ok := queue.Arguments[ArgQueueType].(string); ok && declared != "" {
		return declared
	}
	return "classic"
}

// encodeArguments carries the queue's declared arguments across as JSON.
//
// A flat map would lose the types - x-max-length is a number, x-overflow a
// string, and a header argument can be a nested table - and those types are
// what a reader needs to tell "5000" the limit from "5000" the name.
func encodeArguments(arguments map[string]interface{}) string {
	if len(arguments) == 0 {
		return ""
	}
	encoded, err := json.Marshal(arguments)
	if err != nil {
		return ""
	}
	return string(encoded)
}
