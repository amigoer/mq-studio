package rabbitmq

import (
	"context"
	"fmt"
	"strings"

	amqp "github.com/rabbitmq/amqp091-go"

	"github.com/amigoer/mq-studio/internal/model"
)

// maxPublishBatch caps one send.
//
// The console offers a repeat count for generating load, and each copy is a
// confirm round trip. This is where "send a thousand" stops being a form
// submission and starts being a load test with no progress bar.
const maxPublishBatch = 1000

// Publish sends a message over AMQP and reports what the broker did with it.
//
// Over AMQP rather than the management API's publish endpoint, whose own
// documentation says not to use it for real traffic and which has no publisher
// confirms at all - it answers a "routed" boolean and nothing about whether
// the broker kept the message.
func (c *Conn) Publish(ctx context.Context, request model.PublishRequest) (*model.PublishResult, error) {
	if strings.TrimSpace(request.RoutingKey) == "" && request.Exchange == "" {
		// The default exchange routes by queue name, so a publish to it with
		// no routing key has no destination at all.
		return nil, fmt.Errorf("publishing to the default exchange needs a queue name as the routing key")
	}
	count := request.Count
	if count <= 0 {
		count = 1
	}
	if count > maxPublishBatch {
		return nil, fmt.Errorf("a single send is capped at %d messages", maxPublishBatch)
	}

	result := &model.PublishResult{}
	err := c.data.withChannel(ctx, func(channel *amqp.Channel) error {
		return send(ctx, channel, request, count, result)
	})
	if err != nil {
		return result, fmt.Errorf("publish to %q: %w", publishTarget(request), err)
	}
	return result, nil
}

func send(
	ctx context.Context,
	channel *amqp.Channel,
	request model.PublishRequest,
	count int,
	result *model.PublishResult,
) error {
	if err := channel.Confirm(false); err != nil {
		return fmt.Errorf("enable publisher confirms: %w", err)
	}
	// Buffered for the whole batch: the broker returns every unroutable
	// message, and an unbuffered channel would block the library's own reader
	// once more than one came back.
	returns := channel.NotifyReturn(make(chan amqp.Return, count))

	publishing := publishingOf(request)
	for i := 0; i < count; i++ {
		confirmation, err := channel.PublishWithDeferredConfirmWithContext(
			ctx, request.Exchange, request.RoutingKey,
			request.Mandatory, false, publishing,
		)
		if err != nil {
			return fmt.Errorf("publish: %w", err)
		}
		acked, err := confirmation.WaitContext(ctx)
		if err != nil {
			return fmt.Errorf("wait for confirm: %w", err)
		}
		if !acked {
			return fmt.Errorf("the broker refused the message after %d of %d", result.Sent, count)
		}
		result.Sent++
	}

	// Returns arrive before the confirm for the same message, so every one of
	// them is already waiting by now.
	for {
		select {
		case returned := <-returns:
			result.Unroutable++
			result.Reason = fmt.Sprintf("%d %s", returned.ReplyCode, returned.ReplyText)
		default:
			return nil
		}
	}
}

// SendMessage is the canonical publish, and it is this one with the fields
// RabbitMQ has no counterpart for dropped.
//
// A RocketMQ tag becomes the AMQP type property, which is the closest thing to
// it - a free string the consumer can filter on itself. Keys becomes the
// message id. The delay level has no equivalent at all and is refused rather
// than silently ignored: a caller asking for a delayed message and getting an
// immediate one is worse than an error.
func (c *Conn) SendMessage(ctx context.Context, topic, tags, keys, body string, delayLevel int) (string, error) {
	if delayLevel > 0 {
		return "", fmt.Errorf("rabbitmq has no delay levels; a per-message TTL with a dead-letter exchange is the equivalent")
	}
	result, err := c.Publish(ctx, model.PublishRequest{
		// The default exchange with the queue name as the routing key, which
		// is what publishing "to a queue" means in AMQP.
		RoutingKey: topic,
		Body:       body,
		Persistent: true,
		Mandatory:  true,
		MessageID:  keys,
		Type:       tags,
		Count:      1,
	})
	if err != nil {
		return "", err
	}
	if result.Unroutable > 0 {
		return "", fmt.Errorf("published, but nothing is bound to route it to %q: %s", topic, result.Reason)
	}
	return topic, nil
}

func publishingOf(request model.PublishRequest) amqp.Publishing {
	deliveryMode := amqp.Transient
	if request.Persistent {
		deliveryMode = amqp.Persistent
	}

	var headers amqp.Table
	if len(request.Headers) > 0 {
		headers = make(amqp.Table, len(request.Headers))
		for key, value := range request.Headers {
			// Header values stay strings. Guessing at a number would change
			// what a consumer matching on the header sees, and a headers
			// exchange compares types.
			headers[key] = value
		}
	}

	return amqp.Publishing{
		Headers:       headers,
		ContentType:   request.ContentType,
		DeliveryMode:  deliveryMode,
		Priority:      uint8(clampPriority(request.Priority)),
		CorrelationId: request.CorrelationID,
		ReplyTo:       request.ReplyTo,
		Expiration:    request.Expiration,
		MessageId:     request.MessageID,
		Type:          request.Type,
		AppId:         request.AppID,
		Body:          []byte(request.Body),
	}
}

// clampPriority keeps the value inside what AMQP can carry. Priority is only
// honoured at all on a queue declared with x-max-priority.
func clampPriority(priority int) int {
	if priority < 0 {
		return 0
	}
	if priority > 255 {
		return 255
	}
	return priority
}

func publishTarget(request model.PublishRequest) string {
	if request.Exchange == "" {
		return request.RoutingKey
	}
	return request.Exchange + " / " + request.RoutingKey
}
