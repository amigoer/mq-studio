package rabbitmq

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/timestamp"
)

// Filter keys the messages board sends. They are a contract with
// frontend/src/mq/rabbitmq/messages.ts.
const (
	FilterRoutingKey = "routingKey"
	FilterHeader     = "header"
	FilterBody       = "body"
)

// defaultBrowseCount is what a page asks for when it says nothing.
const defaultBrowseCount = 32

// browseScanLimit caps how far a filtered browse reads before giving up.
//
// Filters are applied here rather than by the broker - AMQP has no server-side
// selector - so a narrow filter on a deep queue would otherwise walk the whole
// backlog into memory. Stopping early and reporting fewer results is better
// than a page that never loads.
const browseScanLimit = 2000

// browseIdleTimeout is how long to wait for the next message before deciding
// the queue has no more.
//
// A queue with fewer messages than asked for never signals that it is done:
// the consumer simply stops receiving. This is what turns that silence into a
// result.
const browseIdleTimeout = 400 * time.Millisecond

// QueryMessages browses a queue over AMQP.
//
// Browsing still alters the queue, and the connection says so through a caveat
// rather than pretending otherwise: AMQP has no non-destructive read of a
// classic or quorum queue. Every message taken is put back with nack, keeping
// its position, but it comes back flagged redelivered and anything consuming
// concurrently sees the gap.
//
// What moving off the management API's get endpoint buys is fidelity. Headers
// arrive as AMQP types rather than as whatever JSON made of them, payloads are
// not truncated at fifty kilobytes, and filters can be honoured at all.
func (c *Conn) QueryMessages(ctx context.Context, params model.MessageQueryParams) ([]*model.MessageItem, error) {
	queue := strings.TrimSpace(params.Topic)
	if queue == "" {
		return nil, fmt.Errorf("browsing needs a queue name")
	}
	wanted := params.MaxResults
	if wanted <= 0 {
		wanted = defaultBrowseCount
	}

	var items []*model.MessageItem
	err := c.data.withChannel(ctx, func(channel *amqp.Channel) error {
		found, browseErr := browse(ctx, channel, queue, wanted, params)
		items = found
		return browseErr
	})
	if err != nil {
		return nil, fmt.Errorf("browse queue %q: %w", queue, err)
	}
	return items, nil
}

// browse consumes, collects and puts everything back.
//
// A consumer rather than repeated basic.Get: the broker streams up to the
// prefetch window in one round trip, where a get-per-message costs one each.
// Cancelling the consumer before the nack is what keeps the broker from
// pushing more while the messages are being returned.
func browse(
	ctx context.Context,
	channel *amqp.Channel,
	queue string,
	wanted int,
	params model.MessageQueryParams,
) ([]*model.MessageItem, error) {
	scan := wanted
	if hasFilters(params) {
		// Filtering happens here, so a narrow filter has to be allowed to read
		// past the number of results it will keep.
		scan = browseScanLimit
	}

	prefetch := scan
	if prefetch > 500 {
		prefetch = 500
	}
	if err := channel.Qos(prefetch, 0, false); err != nil {
		return nil, fmt.Errorf("set prefetch: %w", err)
	}

	// A unique consumer tag per browse, so a previous one that has not been
	// torn down yet cannot collide with this.
	tag := fmt.Sprintf("mq-studio-browse-%d", time.Now().UnixNano())
	deliveries, err := channel.ConsumeWithContext(
		ctx, queue, tag,
		false, // manual ack: everything read is put back deliberately
		false, // not exclusive: browsing must not lock out the real consumers
		false, false, nil,
	)
	if err != nil {
		return nil, fmt.Errorf("consume: %w", err)
	}

	items := make([]*model.MessageItem, 0, wanted)
	var lastTag uint64
	var taken int

	idle := time.NewTimer(browseIdleTimeout)
	defer idle.Stop()

collect:
	for taken < scan && len(items) < wanted {
		select {
		case <-ctx.Done():
			break collect
		case delivery, ok := <-deliveries:
			if !ok {
				break collect
			}
			taken++
			lastTag = delivery.DeliveryTag
			if matches(&delivery, params) {
				items = append(items, messageFromDelivery(queue, &delivery, len(items)+1))
			}
			if !idle.Stop() {
				select {
				case <-idle.C:
				default:
				}
			}
			idle.Reset(browseIdleTimeout)
		case <-idle.C:
			// Nothing more is coming. A queue holding fewer messages than
			// asked for never says so; it simply stops delivering.
			break collect
		}
	}

	// Cancel first, then return everything in one nack. Nacking while the
	// consumer is still registered invites the broker to redeliver what was
	// just put back, and this would collect it a second time.
	if err := channel.Cancel(tag, false); err != nil {
		return nil, fmt.Errorf("cancel browse consumer: %w", err)
	}
	if taken > 0 {
		// multiple, requeue: everything up to and including the last tag goes
		// back where it was.
		if err := channel.Nack(lastTag, true, true); err != nil {
			return nil, fmt.Errorf("return browsed messages: %w", err)
		}
	}
	return items, nil
}

func hasFilters(params model.MessageQueryParams) bool {
	for _, key := range []string{FilterRoutingKey, FilterHeader, FilterBody} {
		if strings.TrimSpace(params.Filters[key]) != "" {
			return true
		}
	}
	return params.MessageKey != ""
}

// matches applies the filters the page sent.
//
// Client-side because AMQP has no server-side selector: a broker cannot be
// asked for "messages whose routing key starts with order". The alternative is
// offering no filter at all, which on a queue of ten thousand is no answer.
func matches(delivery *amqp.Delivery, params model.MessageQueryParams) bool {
	if key := strings.TrimSpace(params.Filters[FilterRoutingKey]); key != "" {
		if !strings.Contains(delivery.RoutingKey, key) {
			return false
		}
	}
	if needle := strings.TrimSpace(params.Filters[FilterBody]); needle != "" {
		if !strings.Contains(string(delivery.Body), needle) {
			return false
		}
	}
	if header := strings.TrimSpace(params.Filters[FilterHeader]); header != "" {
		if !headerMatches(delivery.Headers, header) {
			return false
		}
	}
	// MessageKey is the canonical field the shared search box fills. RabbitMQ
	// has no key index, so it means the message_id property here.
	if key := strings.TrimSpace(params.MessageKey); key != "" {
		if !strings.Contains(delivery.MessageId, key) {
			return false
		}
	}
	return true
}

// headerMatches accepts either "name" or "name=value", because both are
// questions people ask: does this message carry a header at all, and does it
// carry that header with that value.
func headerMatches(headers amqp.Table, filter string) bool {
	name, value, hasValue := strings.Cut(filter, "=")
	name = strings.TrimSpace(name)
	raw, present := headers[name]
	if !present {
		return false
	}
	if !hasValue {
		return true
	}
	return strings.Contains(formatHeaderValue(raw), strings.TrimSpace(value))
}

// messageFromDelivery maps one AMQP delivery onto the canonical shape.
//
// Everything the canonical model has no field for goes into Properties, which
// is where the family-specific half of a message belongs.
func messageFromDelivery(queue string, delivery *amqp.Delivery, sequence int) *model.MessageItem {
	properties := make(map[string]string, len(delivery.Headers)+10)
	for name, value := range delivery.Headers {
		properties["header."+name] = formatHeaderValue(value)
	}

	put := func(key, value string) {
		if value != "" {
			properties[key] = value
		}
	}
	put("exchange", delivery.Exchange)
	put("routingKey", delivery.RoutingKey)
	put("contentType", delivery.ContentType)
	put("contentEncoding", delivery.ContentEncoding)
	put("correlationId", delivery.CorrelationId)
	put("replyTo", delivery.ReplyTo)
	put("expiration", delivery.Expiration)
	put("type", delivery.Type)
	put("userId", delivery.UserId)
	put("appId", delivery.AppId)
	properties["redelivered"] = strconv.FormatBool(delivery.Redelivered)
	// Persistent is 2 and transient is 1. The word is what a reader wants, and
	// it decides whether this message survives a broker restart.
	properties["deliveryMode"] = deliveryModeName(delivery.DeliveryMode)
	if delivery.Priority > 0 {
		properties["priority"] = strconv.Itoa(int(delivery.Priority))
	}

	// The broker stamps no timestamp of its own. This is the publisher's, when
	// it set one, and its absence is left as zero rather than filled with now:
	// "when this was read" is not "when this was sent".
	var storedAt int64
	if !delivery.Timestamp.IsZero() {
		storedAt = delivery.Timestamp.UnixMilli()
	}

	return &model.MessageItem{
		ID:    sequence,
		Topic: queue,
		// RabbitMQ assigns no identifier. The publisher's message_id is the
		// only candidate and applications routinely leave it unset, so an
		// absent one stays absent rather than being invented.
		MessageID: delivery.MessageId,
		Keys:      delivery.RoutingKey,
		Body:      string(delivery.Body),
		Status:    model.MsgNormal,
		// There is no partition and no offset in AMQP. Zero would read as
		// "the first message on partition zero".
		QueueID:        model.UnknownMetric,
		QueueOffset:    model.UnknownMetric,
		StoreTime:      timestamp.FromUnixMilli(storedAt),
		StoreTimestamp: storedAt,
		Properties:     properties,
	}
}

func deliveryModeName(mode uint8) string {
	if mode == 2 {
		return "persistent"
	}
	return "transient"
}

// formatHeaderValue renders an AMQP field value as text without losing what it
// was.
//
// An AMQP table can hold integers, timestamps, nested tables and arrays, and
// the frontend receives a string map - so the conversion happens here, once,
// rather than each board guessing.
func formatHeaderValue(value interface{}) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case []byte:
		return string(typed)
	case string:
		return typed
	case time.Time:
		return timestamp.FromUnixMilli(typed.UnixMilli())
	case amqp.Table:
		parts := make([]string, 0, len(typed))
		for name, nested := range typed {
			parts = append(parts, name+"="+formatHeaderValue(nested))
		}
		return "{" + strings.Join(parts, ", ") + "}"
	case []interface{}:
		parts := make([]string, 0, len(typed))
		for _, nested := range typed {
			parts = append(parts, formatHeaderValue(nested))
		}
		return "[" + strings.Join(parts, ", ") + "]"
	default:
		return fmt.Sprint(typed)
	}
}
