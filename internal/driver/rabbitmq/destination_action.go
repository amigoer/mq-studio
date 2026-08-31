package rabbitmq

import (
	"context"
	"fmt"
	"net/http"
	"time"

	rabbithole "github.com/michaelklishin/rabbit-hole/v3"
	amqp "github.com/rabbitmq/amqp091-go"

	"github.com/amigoer/mq-studio/internal/model"
)

// PurgeQueue drops everything a queue is holding.
//
// The broker offers no undo and no dry run, so this is one request and the
// confirmation belongs entirely to the page above.
func (c *Conn) PurgeQueue(ctx context.Context, ref model.DestinationRef) error {
	err := exec(ctx, c.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.PurgeQueue(c.vhostOr(ref.Namespace), ref.Name)
	})
	if err != nil {
		return fmt.Errorf("purge queue %q: %w", ref.Name, err)
	}
	return nil
}

// RebalanceQueues spreads quorum queue leaders back across the nodes.
//
// Leaders pile up on whichever node was available when each queue was
// declared, and after a rolling restart that is usually one node holding most
// of them. Nothing rebalances on its own.
func (c *Conn) RebalanceQueues(ctx context.Context) error {
	err := exec(ctx, c.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.RebalanceQueues()
	})
	if err != nil {
		return fmt.Errorf("rebalance queues: %w", err)
	}
	return nil
}

// moveIdleTimeout is how long to wait for the next message before deciding the
// source queue is empty. Same reasoning as browsing: a queue that has run out
// says nothing, it simply stops delivering.
const moveIdleTimeout = 500 * time.Millisecond

// MoveMessages drains a queue into an exchange, one message at a time.
//
// Over AMQP rather than a shovel. A shovel is the tool RabbitMQ documents for
// this, and it is a plugin - not enabled on a stock broker, and asking an
// operator to install one before they can put dead letters back is a poor
// trade. Doing it here costs a round trip per message and works everywhere.
//
// The order is what makes it safe: publish, wait for the broker to confirm it
// has the copy, check it was not handed straight back as unroutable, and only
// then acknowledge the original. A crash anywhere in between leaves a
// duplicate, never a hole - which is the right way round for a tool that is
// usually moving messages someone already failed to process.
func (c *Conn) MoveMessages(ctx context.Context, request model.MoveRequest) (int, error) {
	if request.From == "" {
		return 0, fmt.Errorf("moving needs a source queue")
	}
	limit := request.Limit
	if limit <= 0 {
		limit = defaultBrowseCount
	}

	var moved int
	err := c.data.withChannel(ctx, func(channel *amqp.Channel) error {
		count, moveErr := drain(ctx, channel, request, limit)
		moved = count
		return moveErr
	})
	if err != nil {
		return moved, fmt.Errorf("move from %q: %w", request.From, err)
	}
	return moved, nil
}

func drain(ctx context.Context, channel *amqp.Channel, request model.MoveRequest, limit int) (int, error) {
	// Confirms first: a publish that is not confirmed is a publish that may
	// not have happened, and this acknowledges the original on the strength of
	// it.
	if err := channel.Confirm(false); err != nil {
		return 0, fmt.Errorf("enable publisher confirms: %w", err)
	}
	// One at a time. Prefetching a hundred would mean a hundred messages held
	// unacknowledged if this fails halfway, and they would all be redelivered.
	if err := channel.Qos(1, 0, false); err != nil {
		return 0, fmt.Errorf("set prefetch: %w", err)
	}

	// A publisher confirm says the broker took responsibility for the message,
	// not that it routed it: an unroutable mandatory publish is returned and
	// then confirmed, so confirms alone would acknowledge the original and
	// drop the copy. This is where the return arrives.
	returns := channel.NotifyReturn(make(chan amqp.Return, 1))

	tag := fmt.Sprintf("mq-studio-move-%d", time.Now().UnixNano())
	deliveries, err := channel.ConsumeWithContext(ctx, request.From, tag, false, false, false, false, nil)
	if err != nil {
		return 0, fmt.Errorf("consume: %w", err)
	}
	defer func() { _ = channel.Cancel(tag, false) }()

	idle := time.NewTimer(moveIdleTimeout)
	defer idle.Stop()

	moved := 0
	for moved < limit {
		select {
		case <-ctx.Done():
			return moved, ctx.Err()
		case delivery, ok := <-deliveries:
			if !ok {
				return moved, nil
			}
			if err := forward(ctx, channel, returns, &delivery, request); err != nil {
				// Put it back where it was. Losing it here would be losing a
				// message the operator was trying to rescue.
				_ = delivery.Nack(false, true)
				return moved, err
			}
			moved++
			if !idle.Stop() {
				select {
				case <-idle.C:
				default:
				}
			}
			idle.Reset(moveIdleTimeout)
		case <-idle.C:
			return moved, nil
		}
	}
	return moved, nil
}

// forward publishes one message and acknowledges the original only once the
// broker has confirmed it and has not handed it back.
func forward(
	ctx context.Context,
	channel *amqp.Channel,
	returns <-chan amqp.Return,
	delivery *amqp.Delivery,
	request model.MoveRequest,
) error {
	routingKey := request.ToRoutingKey
	if routingKey == "" {
		// Keeping the original key is what makes a move back to a source queue
		// land where it came from, through the same topology it took before.
		routingKey = delivery.RoutingKey
	}

	confirmation, err := channel.PublishWithDeferredConfirmWithContext(
		ctx, request.ToExchange, routingKey,
		// Mandatory: without it a message matching no binding is dropped
		// silently and still confirmed, so the original would be acknowledged
		// and the copy would not exist. With it the broker hands the message
		// back, which is what the return check below is reading.
		true, false,
		republishing(delivery),
	)
	if err != nil {
		return fmt.Errorf("publish: %w", err)
	}
	acked, err := confirmation.WaitContext(ctx)
	if err != nil {
		return fmt.Errorf("wait for confirm: %w", err)
	}
	if !acked {
		return fmt.Errorf("the broker refused the copy; nothing was moved")
	}

	// RabbitMQ sends the return before the confirm for the same message, so by
	// now any return has already arrived and this read never blocks.
	select {
	case returned := <-returns:
		return fmt.Errorf(
			"nothing is bound to route this to %q on exchange %q (%d %s)",
			returned.RoutingKey, returned.Exchange, returned.ReplyCode, returned.ReplyText)
	default:
	}
	return delivery.Ack(false)
}

// republishing rebuilds a message for sending on.
//
// Everything the publisher set is carried over, headers included. The x-death
// history in particular has to survive: it is how a message that has been
// dead-lettered says where it came from and why, and dropping it would erase
// the only record of that.
func republishing(delivery *amqp.Delivery) amqp.Publishing {
	return amqp.Publishing{
		Headers:         delivery.Headers,
		ContentType:     delivery.ContentType,
		ContentEncoding: delivery.ContentEncoding,
		DeliveryMode:    delivery.DeliveryMode,
		Priority:        delivery.Priority,
		CorrelationId:   delivery.CorrelationId,
		ReplyTo:         delivery.ReplyTo,
		Expiration:      delivery.Expiration,
		MessageId:       delivery.MessageId,
		Timestamp:       delivery.Timestamp,
		Type:            delivery.Type,
		UserId:          delivery.UserId,
		AppId:           delivery.AppId,
		Body:            delivery.Body,
	}
}

// DropMessages discards a batch from the head of a queue.
//
// Not a purge. A purge empties the queue in one broker call and cannot be
// bounded; this takes a fixed number from the head and acknowledges them,
// which is what "discard these ten dead letters and leave the rest" means.
//
// Acknowledging is what discards: an acknowledged message is gone from the
// broker with no dead-lettering and no copy anywhere. That is the whole
// operation, and there is no undo.
func (c *Conn) DropMessages(ctx context.Context, ref model.DestinationRef, limit int) (int, error) {
	if limit <= 0 {
		return 0, fmt.Errorf("dropping needs a count")
	}

	var dropped int
	err := c.data.withChannel(ctx, func(channel *amqp.Channel) error {
		count, dropErr := discard(ctx, channel, ref.Name, limit)
		dropped = count
		return dropErr
	})
	if err != nil {
		return dropped, fmt.Errorf("drop from %q: %w", ref.Name, err)
	}
	return dropped, nil
}

func discard(ctx context.Context, channel *amqp.Channel, queue string, limit int) (int, error) {
	if err := channel.Qos(1, 0, false); err != nil {
		return 0, fmt.Errorf("set prefetch: %w", err)
	}
	tag := fmt.Sprintf("mq-studio-drop-%d", time.Now().UnixNano())
	deliveries, err := channel.ConsumeWithContext(ctx, queue, tag, false, false, false, false, nil)
	if err != nil {
		return 0, fmt.Errorf("consume: %w", err)
	}
	defer func() { _ = channel.Cancel(tag, false) }()

	idle := time.NewTimer(moveIdleTimeout)
	defer idle.Stop()

	dropped := 0
	for dropped < limit {
		select {
		case <-ctx.Done():
			return dropped, ctx.Err()
		case delivery, ok := <-deliveries:
			if !ok {
				return dropped, nil
			}
			if err := delivery.Ack(false); err != nil {
				return dropped, fmt.Errorf("acknowledge: %w", err)
			}
			dropped++
			if !idle.Stop() {
				select {
				case <-idle.C:
				default:
				}
			}
			idle.Reset(moveIdleTimeout)
		case <-idle.C:
			return dropped, nil
		}
	}
	return dropped, nil
}
