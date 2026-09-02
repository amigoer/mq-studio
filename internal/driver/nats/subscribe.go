package nats

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"

	natsclient "github.com/nats-io/nats.go"
	"github.com/nats-io/nuid"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/timestamp"
)

/*
 * Following a subject, as opposed to reading a stream.
 *
 * LiveSubscriber rather than MessageTailer, and the split is not an
 * implementation choice. A tail is incremental against a durable log: hand
 * back the cursor and receive what has arrived since. Core NATS has no log -
 * a message exists while it is in flight, reaches whoever is subscribed at
 * that instant, and is gone. There is nothing to re-read from, so a cursor
 * into stored data would be the wrong shape and a page offering "go back ten
 * minutes" would be lying.
 *
 * So the driver holds a bounded buffer per subscription, fed by the server,
 * and the caller drains it by sequence. The sequence counts within one
 * subscription and restarts with the next, because there is nothing durable
 * for it to refer to.
 *
 * This is the same shape MQTT uses, for the same reason.
 */

const (
	// defaultLiveBuffer is how many messages a stream holds between polls.
	// Enough that a page refreshing every second keeps up with a busy subject,
	// small enough that a hundred streams cannot exhaust this process.
	defaultLiveBuffer = 500
	// maxLiveBuffer bounds what a caller may ask for.
	maxLiveBuffer = 10000
	// maxLiveBody is where a message body is cut. A live view is for seeing
	// what is flowing, not for reading a megabyte, and Truncated says when it
	// happened - a silently shortened payload reads as a malformed message.
	maxLiveBody = 64 * 1024
	// maxLiveStreams bounds how many subscriptions one connection holds, since
	// each is a subscription on the server as well as a buffer here.
	maxLiveStreams = 32
)

// liveStream is one running subscription and what it has collected.
type liveStream struct {
	id      string
	filters []model.LiveFilter
	started string

	subscriptions []*natsclient.Subscription

	mu       sync.Mutex
	messages []*model.LiveMessage
	next     int64
	received int64
	dropped  int64
	buffer   int
	live     bool
}

// StartLiveSubscription subscribes and begins buffering.
func (c *Conn) StartLiveSubscription(ctx context.Context, spec model.LiveSubscriptionSpec) (*model.LiveSubscription, error) {
	if c.nc == nil {
		return nil, errConnectionDown
	}
	if len(spec.Filters) == 0 {
		return nil, fmt.Errorf("a subscription needs at least one subject")
	}
	for _, filter := range spec.Filters {
		// Wildcards are the point here, unlike a publish, so only the shape is
		// checked - a > anywhere but the end matches nothing at all, and the
		// page would sit silent with nothing to say why.
		if err := validateSubject(strings.TrimSpace(filter.Pattern)); err != nil {
			return nil, err
		}
	}

	c.streamsMu.Lock()
	if len(c.streams) >= maxLiveStreams {
		c.streamsMu.Unlock()
		return nil, fmt.Errorf("this connection already holds %d live subscriptions", maxLiveStreams)
	}
	c.streamsMu.Unlock()

	buffer := spec.Buffer
	if buffer <= 0 {
		buffer = defaultLiveBuffer
	}
	if buffer > maxLiveBuffer {
		buffer = maxLiveBuffer
	}

	stream := &liveStream{
		id:      "live-" + nuid.Next(),
		filters: spec.Filters,
		started: timestamp.Now(),
		buffer:  buffer,
		live:    true,
	}

	for _, filter := range spec.Filters {
		pattern := strings.TrimSpace(filter.Pattern)
		// A queue group makes several subscribers share the messages rather
		// than each receiving all of them. It is a filter option because it is
		// per subject, and it is offered because watching a subject a service
		// is already consuming is otherwise a way to take its traffic.
		group := strings.TrimSpace(filter.Options[LiveOptionQueueGroup])

		var subscription *natsclient.Subscription
		var err error
		handler := func(message *natsclient.Msg) { stream.deliver(pattern, message) }
		if group != "" {
			subscription, err = c.nc.QueueSubscribe(pattern, group, handler)
		} else {
			subscription, err = c.nc.Subscribe(pattern, handler)
		}
		if err != nil {
			stream.unsubscribe()
			return nil, err
		}
		// Cap what the server will queue for this subscription. Without it a
		// subscriber that cannot keep up becomes a slow consumer and the
		// server disconnects the whole connection - taking every other page
		// with it, for one busy subject.
		if err := subscription.SetPendingLimits(buffer*2, maxLiveBody*int(buffer)); err != nil {
			stream.unsubscribe()
			return nil, err
		}
		stream.subscriptions = append(stream.subscriptions, subscription)
	}

	if err := c.nc.FlushWithContext(ctx); err != nil {
		stream.unsubscribe()
		return nil, err
	}

	c.streamsMu.Lock()
	c.streams[stream.id] = stream
	c.streamsMu.Unlock()

	return stream.snapshot(), nil
}

// LiveOptionQueueGroup names the queue group a filter subscribes under.
const LiveOptionQueueGroup = "queueGroup"

// PollLiveSubscription drains what has arrived since the caller's cursor.
func (c *Conn) PollLiveSubscription(ctx context.Context, id string, after int64, limit int) (*model.LiveBatch, error) {
	stream, err := c.liveStream(id)
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > maxLiveBuffer {
		limit = defaultLiveBuffer
	}
	return stream.drain(after, limit), nil
}

// StopLiveSubscription ends a subscription and discards what it held.
//
// Not optional cleanup: the subscription lives on the server until it is
// stopped, so a page that forgot would leave the connection receiving
// everything on that subject for as long as it stayed open.
func (c *Conn) StopLiveSubscription(ctx context.Context, id string) error {
	c.streamsMu.Lock()
	stream, ok := c.streams[id]
	delete(c.streams, id)
	c.streamsMu.Unlock()
	if !ok {
		return fmt.Errorf("no live subscription %q", id)
	}
	stream.unsubscribe()
	return nil
}

// LiveSubscriptions is what is running, so a panel that remounts finds its own
// stream again instead of starting a second one.
func (c *Conn) LiveSubscriptions(ctx context.Context) ([]*model.LiveSubscription, error) {
	c.streamsMu.RLock()
	defer c.streamsMu.RUnlock()

	streams := make([]*model.LiveSubscription, 0, len(c.streams))
	for _, stream := range c.streams {
		streams = append(streams, stream.snapshot())
	}
	sort.Slice(streams, func(i, j int) bool { return streams[i].ID < streams[j].ID })
	return streams, nil
}

func (c *Conn) liveStream(id string) (*liveStream, error) {
	c.streamsMu.RLock()
	defer c.streamsMu.RUnlock()
	stream, ok := c.streams[id]
	if !ok {
		return nil, fmt.Errorf("no live subscription %q", id)
	}
	return stream, nil
}

// stopLiveStreams ends every subscription this connection holds.
func (c *Conn) stopLiveStreams() {
	c.streamsMu.Lock()
	streams := make([]*liveStream, 0, len(c.streams))
	for _, stream := range c.streams {
		streams = append(streams, stream)
	}
	c.streams = make(map[string]*liveStream)
	c.streamsMu.Unlock()

	for _, stream := range streams {
		stream.unsubscribe()
	}
}

// setLiveStreamsLive marks every stream as listening or not.
//
// A page that cannot tell a broken session from a quiet subject shows a
// stalled panel as a working one, which is the failure this exists to prevent.
func (c *Conn) setLiveStreamsLive(live bool) {
	c.streamsMu.RLock()
	defer c.streamsMu.RUnlock()
	for _, stream := range c.streams {
		stream.mu.Lock()
		stream.live = live
		stream.mu.Unlock()
	}
}

// deliver buffers one message, dropping the oldest when the buffer is full.
//
// The oldest rather than the newest: a live view is for watching what is
// happening now, so falling behind should cost history rather than the present.
func (s *liveStream) deliver(pattern string, message *natsclient.Msg) {
	body := message.Data
	truncated := false
	if len(body) > maxLiveBody {
		body = body[:maxLiveBody]
		truncated = true
	}

	attributes := make(map[string]string, len(message.Header)+1)
	for name, values := range message.Header {
		attributes[name] = strings.Join(values, ", ")
	}
	// A message that asked for an answer is a request, and that changes what
	// silence on the page means: nobody is replying, rather than nobody is
	// publishing.
	if message.Reply != "" {
		attributes[LiveAttrReplyTo] = message.Reply
	}
	attributes[LiveAttrSize] = strconv.Itoa(len(message.Data))

	s.mu.Lock()
	defer s.mu.Unlock()

	s.received++
	s.next++
	s.messages = append(s.messages, &model.LiveMessage{
		Seq:         s.next,
		Destination: message.Subject,
		Filter:      pattern,
		ReceivedAt:  timestamp.Now(),
		Body:        string(body),
		Truncated:   truncated,
		Attributes:  attributes,
	})
	if len(s.messages) > s.buffer {
		dropped := len(s.messages) - s.buffer
		s.messages = s.messages[dropped:]
		s.dropped += int64(dropped)
	}
}

// Attribute keys a live message carries.
const (
	LiveAttrReplyTo = "replyTo"
	LiveAttrSize    = "sizeBytes"
)

// drain returns the buffered messages after a sequence.
func (s *liveStream) drain(after int64, limit int) *model.LiveBatch {
	s.mu.Lock()
	defer s.mu.Unlock()

	batch := &model.LiveBatch{
		Cursor:   s.next,
		Dropped:  s.dropped,
		Received: s.received,
		Live:     s.live,
	}
	for _, message := range s.messages {
		if message.Seq <= after {
			continue
		}
		batch.Messages = append(batch.Messages, message)
		if len(batch.Messages) >= limit {
			// The cursor is where this batch got to, not where the stream is:
			// a caller cut short by the limit has to come back for the rest.
			batch.Cursor = message.Seq
			break
		}
	}
	return batch
}

func (s *liveStream) snapshot() *model.LiveSubscription {
	s.mu.Lock()
	defer s.mu.Unlock()
	return &model.LiveSubscription{
		ID:        s.id,
		Filters:   s.filters,
		StartedAt: s.started,
		Received:  s.received,
		Dropped:   s.dropped,
		Live:      s.live,
	}
}

func (s *liveStream) unsubscribe() {
	for _, subscription := range s.subscriptions {
		_ = subscription.Unsubscribe()
	}
	s.subscriptions = nil
}
