package pulsar

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"time"

	pulsarclient "github.com/apache/pulsar-client-go/pulsar"
	"github.com/apache/pulsar-client-go/pulsaradmin/pkg/utils"

	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * SendMessage publishes through the canonical port.
 *
 * The port is RocketMQ's shape and three of its five arguments do not exist on
 * this family, so each is mapped deliberately rather than dropped:
 *
 *   - keys becomes Pulsar's message key, which is the same idea: what the
 *     broker partitions and compacts by.
 *   - tags becomes a property named "tag". Pulsar has no tag, and a producer
 *     that wants one puts it in a property - so this is what a consumer
 *     written against this app's send console would actually filter on, and it
 *     is the same property the browse filter reads.
 *   - delayLevel is seconds, not a level. RocketMQ's levels are an index into
 *     a broker-side table; Pulsar takes a duration, and ports.go fixes no
 *     unit. Seconds is the reading the send console labels and the tests pin.
 *
 * The rich console goes through PulsarService instead, because an ordering
 * key, an event time and arbitrary properties have nowhere to go here.
 */
func (c *Conn) SendMessage(
	ctx context.Context, topic, tags, keys, body string, delayLevel int,
) (string, error) {
	request := PublishRequest{
		Topic:        topic,
		Key:          keys,
		Body:         body,
		Count:        1,
		DeliverAfter: time.Duration(delayLevel) * time.Second,
	}
	if tags != "" {
		request.Properties = map[string]string{"tag": tags}
	}

	result, err := c.Publish(ctx, request)
	if err != nil {
		return "", err
	}
	if len(result.MessageIDs) == 0 {
		return "", fmt.Errorf("the broker acknowledged no message id")
	}
	return result.MessageIDs[0], nil
}

// PublishRequest is a send in Pulsar's own vocabulary.
//
// Deliberately not model.PublishRequest, which is AMQP: an exchange, a routing
// key and a mandatory flag, none of which this family has. What it does have -
// an ordering key, an event time, a delivery delay and arbitrary properties -
// has no field there.
type PublishRequest struct {
	// Topic is a full URL or a bare name in the connection's namespace.
	Topic string
	// Key is what the broker partitions and compacts by.
	Key string
	// OrderingKey orders delivery independently of the routing key, which is
	// how a Key_Shared subscription keeps related messages on one consumer
	// without forcing them onto one partition.
	OrderingKey string
	Properties  map[string]string
	Body        string
	// DeliverAfter schedules the message. Pulsar holds it and delivers when
	// the time comes; it is not a level into a broker-side table.
	DeliverAfter time.Duration
	// EventTime is when the producer says the event happened, as opposed to
	// when the broker stores it.
	EventTime time.Time
	// Count sends the same message more than once, which is what a load check
	// from a console needs and what makes a repeat deliberate rather than a
	// button pressed twice.
	Count int
}

// PublishResult is what the broker acknowledged.
type PublishResult struct {
	// MessageIDs are in send order, one per message, in Pulsar's printed form
	// so each can be pasted straight into the browse box.
	MessageIDs []string
}

/*
 * Publish sends one or more messages.
 *
 * Synchronous on purpose. A console's send button has to be able to say the
 * broker took it, and an async send would report success the moment the
 * message entered a client-side queue - which is exactly the case somebody
 * uses this console to rule out.
 */
func (c *Conn) Publish(ctx context.Context, request PublishRequest) (*PublishResult, error) {
	url, err := c.resolveTopicURL(request.Topic)
	if err != nil {
		return nil, err
	}
	count := request.Count
	if count <= 0 {
		count = 1
	}
	if count > maxPublishCount {
		return nil, fmt.Errorf("a single send is capped at %d messages", maxPublishCount)
	}

	producer, err := c.producer(url)
	if err != nil {
		return nil, err
	}

	result := &PublishResult{MessageIDs: make([]string, 0, count)}
	for i := 0; i < count; i++ {
		message := &pulsarclient.ProducerMessage{
			Key:          request.Key,
			OrderingKey:  request.OrderingKey,
			Properties:   request.Properties,
			Payload:      []byte(request.Body),
			DeliverAfter: request.DeliverAfter,
		}
		if !request.EventTime.IsZero() {
			message.EventTime = request.EventTime
		}
		id, err := producer.Send(ctx, message)
		if err != nil {
			// Whatever went out already went out. Reporting the ids so far
			// alongside the failure is the difference between "nothing was
			// sent" and "three of five were", which are different problems.
			return result, fmt.Errorf("send to %s (%d of %d): %w", url, i+1, count, err)
		}
		result.MessageIDs = append(result.MessageIDs, messageIDString(id))
	}
	return result, nil
}

// maxPublishCount bounds a repeat, because the field is typed by hand and a
// slipped digit would hold the request open sending a million messages.
const maxPublishCount = 1000

/*
 * producer returns this connection's producer for a topic, creating it once.
 *
 * Reuse is not an optimisation. Every producer registers a name with the
 * broker and holds it until it is closed, so creating one per send leaks
 * broker-side producers until the topic hits maxProducersPerTopic and refuses
 * every further send - from this app and from everything else publishing to
 * it. They are all closed with the connection.
 */
func (c *Conn) producer(url string) (pulsarclient.Producer, error) {
	c.producerMu.Lock()
	defer c.producerMu.Unlock()

	if existing, ok := c.producers[url]; ok {
		return existing, nil
	}
	created, err := c.client.CreateProducer(pulsarclient.ProducerOptions{
		Topic: url,
		// Named for what it is, so an operator looking at the topic's
		// publishers can tell this console apart from their application.
		Name: producerName,
		// Off: batching trades an acknowledgement per message for throughput,
		// and a console needs the id of the message it just sent.
		DisableBatching: true,
	})
	if err != nil {
		return nil, fmt.Errorf("open a producer on %s: %w", url, err)
	}
	if c.producers == nil {
		c.producers = map[string]pulsarclient.Producer{}
	}
	c.producers[url] = created
	return created, nil
}

// producerName is what this app registers as on a topic.
const producerName = "mq-studio-console"

// closeProducers releases every producer this connection opened.
func (c *Conn) closeProducers() {
	c.producerMu.Lock()
	defer c.producerMu.Unlock()

	for _, producer := range c.producers {
		producer.Close()
	}
	c.producers = nil
}

// producerCache is the state the two functions above share, embedded in Conn.
type producerCache struct {
	producerMu sync.Mutex
	producers  map[string]pulsarclient.Producer
}

// publisherStats reads a topic's publishers, through the endpoint its shape
// answers at.
func (c *Conn) publisherStats(
	ctx context.Context, url string,
) ([]utils.PublisherStats, error) {
	topic, err := utils.GetTopicName(url)
	if err != nil {
		return nil, err
	}
	stats, err := c.admin.Topics().GetPartitionedStatsWithContext(ctx, *topic, false)
	if err == nil {
		return stats.Publishers, nil
	}
	if statusOf(err) != http.StatusNotFound {
		return nil, fmt.Errorf("read the publishers of %s: %w", url, err)
	}
	plain, err := c.admin.Topics().GetStatsWithContext(ctx, *topic)
	if err != nil {
		return nil, fmt.Errorf("read the publishers of %s: %w", url, err)
	}
	return plain.Publishers, nil
}

/*
 * ProducerClients is who is currently publishing to a topic.
 *
 * The group argument is ignored, and that is worth saying rather than hiding.
 * The port was shaped for RocketMQ, where producers are only enumerable per
 * producer group; Pulsar reports its publishers per topic, which is both a
 * better question and the only one it can answer.
 */
func (c *Conn) ProducerClients(
	ctx context.Context, _ string, destination string,
) ([]*model.ProducerClient, error) {
	url, err := c.resolveTopicURL(destination)
	if err != nil {
		return nil, err
	}
	stats, err := c.publisherStats(ctx, url)
	if err != nil {
		return nil, err
	}

	clients := make([]*model.ProducerClient, 0, len(stats))
	for _, publisher := range stats {
		clients = append(clients, &model.ProducerClient{
			ClientID: publisher.ProducerName,
			Address:  publisher.Address,
			Version:  publisher.ClientVersion,
			// Pulsar reports a client version string and no language of its
			// own. Guessing one from the version would be inventing a field.
		})
	}
	return clients, nil
}
