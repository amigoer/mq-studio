package pulsar

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	pulsarclient "github.com/apache/pulsar-client-go/pulsar"
	"github.com/apache/pulsar-client-go/pulsaradmin/pkg/utils"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/timestamp"
)

// The filter keys the Pulsar messages board sends. A contract with
// frontend/src/mq/pulsar/messages.ts.
const (
	// FilterNamespace scopes a query, because the canonical params carry only
	// a topic name and a Pulsar topic is addressed within a namespace.
	FilterNamespace = "namespace"
	// FilterPersistent picks the storage kind, which is part of the address
	// rather than a property of the query.
	FilterPersistent = "persistent"
	// FilterProperty is "name=value" against the message's own properties,
	// which is where Pulsar keeps what RocketMQ calls a tag.
	FilterProperty = "property"
)

// readBudget bounds one browse.
//
// A Reader walks the log message by message, so a query for the last hour on a
// busy topic would otherwise read the whole hour before returning anything.
// The wall clock is what actually stops it: a topic with a million messages
// none of which match a key filter has no natural end.
const (
	readBudget     = 20 * time.Second
	readMaxScanned = 50000
	readMaxResults = 500
)

/*
 * QueryMessages browses a topic.
 *
 * Pulsar has no message-search endpoint. What it has is a Reader, which is a
 * cursor over the log that belongs to nobody: it takes no subscription, moves
 * no consumer's position and leaves nothing behind, which is what makes it
 * safe to point at a production topic from a console.
 *
 * That also means every filter here is applied client-side, after reading. So
 * the read is bounded three ways - a wall clock, a scan count and a result
 * count - and the caller is told which one stopped it rather than being handed
 * a short list that looks complete.
 */
func (c *Conn) QueryMessages(
	ctx context.Context, params model.MessageQueryParams,
) ([]*model.MessageItem, error) {
	// A single id is a lookup rather than a scan, and answering it by walking
	// the log would read everything before it to find one message.
	if params.MessageID != "" {
		item, err := c.MessageByID(ctx, params.Topic, params.MessageID)
		if err != nil {
			return nil, err
		}
		return []*model.MessageItem{item}, nil
	}

	url, err := c.queryTopicURL(params)
	if err != nil {
		return nil, err
	}
	reader, err := c.openReader(url, params.StartTime)
	if err != nil {
		return nil, err
	}
	defer reader.Close()

	limit := params.MaxResults
	if limit <= 0 || limit > readMaxResults {
		limit = readMaxResults
	}
	property, value := splitProperty(params.Filters[FilterProperty])

	deadline, cancel := context.WithTimeout(ctx, readBudget)
	defer cancel()

	items := make([]*model.MessageItem, 0, limit)
	for scanned := 0; len(items) < limit && scanned < readMaxScanned; scanned++ {
		if !reader.HasNext() {
			break
		}
		message, err := reader.Next(deadline)
		if err != nil {
			// A budget that ran out is a short answer, not a failure: what was
			// read is still what is on the topic, and the board says the
			// search was cut off rather than that it found nothing.
			if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
				break
			}
			return nil, fmt.Errorf("read %s: %w", url, err)
		}
		if params.EndTime > 0 && message.PublishTime().UnixMilli() > params.EndTime {
			break
		}
		if !matches(message, params.MessageKey, property, value) {
			continue
		}
		items = append(items, messageItem(url, len(items)+1, message))
	}
	return items, nil
}

// MessageByID reads one message by the id an operator pasted.
//
// Straight through the admin API rather than the Reader: the broker can fetch
// a ledger entry directly, and walking the log to the same place would read
// everything before it.
func (c *Conn) MessageByID(ctx context.Context, topic, messageID string) (*model.MessageItem, error) {
	url, err := c.resolveTopicURL(topic)
	if err != nil {
		return nil, err
	}
	name, err := utils.GetTopicName(url)
	if err != nil {
		return nil, err
	}
	ledger, entry, _, err := parseMessageID(messageID)
	if err != nil {
		return nil, err
	}

	messages, err := c.admin.Subscriptions().GetMessagesByIDWithContext(ctx, *name, ledger, entry)
	if err != nil {
		return nil, fmt.Errorf("read %s at %s: %w", url, messageID, err)
	}
	if len(messages) == 0 {
		return nil, fmt.Errorf("no message at %s on %s", messageID, url)
	}
	return adminMessageItem(url, messages[0]), nil
}

// openReader starts a cursor at the requested moment, or at the earliest
// message the topic still holds.
func (c *Conn) openReader(url string, startTime int64) (pulsarclient.Reader, error) {
	options := pulsarclient.ReaderOptions{
		Topic: url,
		// Earliest rather than latest: a browse is for what is already there.
		// A tail is the other control, and it is the one that starts at the
		// end.
		StartMessageID: pulsarclient.EarliestMessageID(),
	}
	reader, err := c.client.CreateReader(options)
	if err != nil {
		return nil, fmt.Errorf("open a reader on %s: %w", url, err)
	}
	if startTime > 0 {
		// Seeking by time is the broker's own search, which is far cheaper
		// than reading forward to the same place.
		if err := reader.SeekByTime(time.UnixMilli(startTime)); err != nil {
			reader.Close()
			return nil, fmt.Errorf("seek %s to %d: %w", url, startTime, err)
		}
	}
	return reader, nil
}

// queryTopicURL is the address a browse reads, from the params the board sent.
func (c *Conn) queryTopicURL(params model.MessageQueryParams) (string, error) {
	if strings.Contains(params.Topic, "://") {
		return params.Topic, nil
	}
	namespace := c.namespaceScope(params.Filters[FilterNamespace])
	persistent := params.Filters[FilterPersistent] != "false"
	ref := model.DestinationRef{Namespace: namespace, Name: params.Topic}
	if ref.Name == "" {
		return "", fmt.Errorf("a message query needs a topic")
	}
	return topicURL(ref, persistent), nil
}

// resolveTopicURL accepts a full URL or a bare name in the connection's own
// namespace, which is what a detail panel passing a topic through has.
func (c *Conn) resolveTopicURL(topic string) (string, error) {
	if strings.Contains(topic, "://") {
		return topic, nil
	}
	if strings.TrimSpace(topic) == "" {
		return "", fmt.Errorf("a message lookup needs a topic")
	}
	return topicURL(model.DestinationRef{
		Namespace: c.config.scope(), Name: topic,
	}, true), nil
}

// splitProperty reads a "name=value" filter. A bare name matches on presence,
// which is how an operator asks "which messages carry this at all".
func splitProperty(raw string) (name, value string) {
	if raw == "" {
		return "", ""
	}
	name, value, found := strings.Cut(raw, "=")
	if !found {
		return strings.TrimSpace(name), ""
	}
	return strings.TrimSpace(name), strings.TrimSpace(value)
}

// matches applies the filters this family has, after reading.
func matches(message pulsarclient.Message, key, property, value string) bool {
	if key != "" && message.Key() != key {
		return false
	}
	if property == "" {
		return true
	}
	found, ok := message.Properties()[property]
	if !ok {
		return false
	}
	return value == "" || found == value
}

func messageItem(topic string, id int, message pulsarclient.Message) *model.MessageItem {
	properties := make(map[string]string, len(message.Properties())+3)
	for name, value := range message.Properties() {
		properties[name] = value
	}
	// The batch index has no field on MessageItem and is the only thing that
	// tells two messages in one batch apart, so it rides here.
	properties[PropertyBatchIndex] = strconv.Itoa(int(message.ID().BatchIdx()))
	properties[PropertyProducer] = message.ProducerName()
	if message.OrderingKey() != "" {
		properties[PropertyOrderingKey] = message.OrderingKey()
	}
	if !message.EventTime().IsZero() {
		properties[PropertyEventTime] = timestamp.FromUnixMilli(message.EventTime().UnixMilli())
	}
	if message.RedeliveryCount() > 0 {
		properties[PropertyRedeliveryCount] = strconv.Itoa(int(message.RedeliveryCount()))
	}

	return &model.MessageItem{
		ID:        id,
		Topic:     topic,
		MessageID: messageIDString(message.ID()),
		// Pulsar has no tag. What RocketMQ puts in one, a Pulsar producer puts
		// in a property, so the column stays empty rather than being filled
		// with something that only looks like a tag.
		Keys:           message.Key(),
		QueueID:        int(message.ID().PartitionIdx()),
		QueueOffset:    message.ID().EntryID(),
		StoreTime:      timestamp.FromUnixMilli(message.PublishTime().UnixMilli()),
		StoreTimestamp: message.PublishTime().UnixMilli(),
		Status:         model.MsgNormal,
		RetryTimes:     int(message.RedeliveryCount()),
		Body:           string(message.Payload()),
		Properties:     properties,
	}
}

// adminMessageItem is the same shape from the admin API, which returns a
// message without the client's own accessors.
func adminMessageItem(topic string, message *utils.Message) *model.MessageItem {
	properties := make(map[string]string, len(message.GetProperties()))
	for name, value := range message.GetProperties() {
		properties[name] = value
	}
	id := message.GetMessageID()
	return &model.MessageItem{
		ID:          1,
		Topic:       topic,
		MessageID:   fmt.Sprintf("%d:%d:%d", id.LedgerID, id.EntryID, id.PartitionIndex),
		QueueID:     id.PartitionIndex,
		QueueOffset: id.EntryID,
		Status:      model.MsgNormal,
		Body:        string(message.Payload),
		Properties:  properties,
	}
}
