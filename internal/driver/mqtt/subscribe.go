package mqtt

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sort"
	"strconv"
	"sync"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/timestamp"
)

const (
	// defaultStreamBuffer is how many messages one stream holds between polls.
	//
	// It is a bound on memory, not a target: an idle topic never fills it and
	// a busy one overruns whatever it is set to. What matters is that the
	// overrun is counted rather than hidden, which is what Dropped is for.
	defaultStreamBuffer = 500
	maxStreamBuffer     = 20000

	// maxBodyBytes caps one message. IoT payloads are usually tiny and
	// occasionally a firmware image, and a workbench holding several hundred
	// of the latter would take the window down.
	maxBodyBytes = 64 * 1024

	// maxStreams bounds how many subscriptions one connection can hold. Each
	// is a real subscription on the broker, so a page that leaked them would
	// leak them there too.
	maxStreams = 32

	// The keys a live message's attributes carry. They are a contract with
	// frontend/src/mq/mqtt/messages.ts.
	AttrQoS             = "qos"
	AttrRetained        = "retained"
	AttrContentType     = "contentType"
	AttrResponseTopic   = "responseTopic"
	AttrCorrelationData = "correlationData"
	AttrMessageExpiry   = "messageExpiry"
	AttrUserProperty    = "user."
)

// stream is one live subscription and the buffer behind it.
//
// The buffer is a ring rather than a queue that grows: a subscription to # on
// a busy broker produces faster than any UI polls, and the choice is between
// bounding memory and holding everything. Bounding it is right, and saying how
// much was lost is what makes it honest.
type stream struct {
	id        string
	filters   []model.LiveFilter
	startedAt string

	mu       sync.Mutex
	ring     []*model.LiveMessage
	start    int   // index of the oldest message held
	length   int   // how many of ring are in use
	nextSeq  int64 // sequence for the next message to arrive
	received int64
	dropped  int64
	live     bool
}

func newStream(id string, filters []model.LiveFilter, buffer int) *stream {
	return &stream{
		id:        id,
		filters:   filters,
		startedAt: timestamp.Now(),
		ring:      make([]*model.LiveMessage, buffer),
		nextSeq:   1,
		live:      true,
	}
}

// append stores one message, discarding the oldest when the ring is full.
func (s *stream) append(message *model.LiveMessage) {
	s.mu.Lock()
	defer s.mu.Unlock()

	message.Seq = s.nextSeq
	s.nextSeq++
	s.received++

	if s.length == len(s.ring) {
		s.ring[s.start] = message
		s.start = (s.start + 1) % len(s.ring)
		s.dropped++
		return
	}
	s.ring[(s.start+s.length)%len(s.ring)] = message
	s.length++
}

// poll returns what arrived after seq, oldest first.
func (s *stream) poll(after int64, limit int) *model.LiveBatch {
	s.mu.Lock()
	defer s.mu.Unlock()

	batch := &model.LiveBatch{
		Cursor:   after,
		Dropped:  s.dropped,
		Received: s.received,
		Live:     s.live,
	}
	for i := range s.length {
		message := s.ring[(s.start+i)%len(s.ring)]
		if message.Seq <= after {
			continue
		}
		if limit > 0 && len(batch.Messages) >= limit {
			break
		}
		batch.Messages = append(batch.Messages, message)
		batch.Cursor = message.Seq
	}
	// A caller that polled a quiet stream must not be handed a cursor behind
	// what has already been dropped, or it re-asks for a window that no longer
	// exists on every poll.
	if oldest := s.oldestSeqLocked(); len(batch.Messages) == 0 && oldest > 0 && after < oldest-1 {
		batch.Cursor = oldest - 1
	}
	return batch
}

func (s *stream) oldestSeqLocked() int64 {
	if s.length == 0 {
		return 0
	}
	return s.ring[s.start].Seq
}

func (s *stream) snapshot() *model.LiveSubscription {
	s.mu.Lock()
	defer s.mu.Unlock()

	return &model.LiveSubscription{
		ID:        s.id,
		Filters:   s.filters,
		StartedAt: s.startedAt,
		Received:  s.received,
		Dropped:   s.dropped,
		Live:      s.live,
	}
}

func (s *stream) setLive(live bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.live = live
}

// StartLiveSubscription subscribes on the broker and starts buffering.
func (c *Conn) StartLiveSubscription(
	ctx context.Context, spec model.LiveSubscriptionSpec,
) (*model.LiveSubscription, error) {
	if c.client == nil {
		return nil, errConnectionDown
	}
	if len(spec.Filters) == 0 {
		return nil, fmt.Errorf("a live subscription needs at least one filter")
	}

	subscriptions := make([]subscribeFilter, 0, len(spec.Filters))
	for _, filter := range spec.Filters {
		if !validFilter(filter.Pattern) {
			return nil, fmt.Errorf("%q is not a topic filter", filter.Pattern)
		}
		if group, _ := splitShared(filter.Pattern); group != "" && !c.config.ProtocolV5 {
			return nil, fmt.Errorf(
				"shared subscriptions are an MQTT 5.0 feature; this connection is 3.1.1")
		}
		qos, err := filterQoS(filter)
		if err != nil {
			return nil, err
		}
		subscriptions = append(subscriptions, subscribeFilter{Pattern: filter.Pattern, QoS: qos})
	}

	buffer := spec.Buffer
	switch {
	case buffer <= 0:
		buffer = defaultStreamBuffer
	case buffer > maxStreamBuffer:
		return nil, fmt.Errorf("buffer must be at most %d messages", maxStreamBuffer)
	}

	c.streamsMu.Lock()
	if len(c.streams) >= maxStreams {
		c.streamsMu.Unlock()
		return nil, fmt.Errorf("this connection already holds %d live subscriptions", maxStreams)
	}
	id := streamID()
	live := newStream(id, spec.Filters, buffer)
	c.streams[id] = live
	c.streamsMu.Unlock()

	if err := c.client.Subscribe(ctx, subscriptions); err != nil {
		c.streamsMu.Lock()
		delete(c.streams, id)
		c.streamsMu.Unlock()
		return nil, err
	}
	return live.snapshot(), nil
}

// PollLiveSubscription drains what arrived after the caller's last sequence.
func (c *Conn) PollLiveSubscription(
	_ context.Context, id string, after int64, limit int,
) (*model.LiveBatch, error) {
	c.streamsMu.RLock()
	live, known := c.streams[id]
	c.streamsMu.RUnlock()
	if !known {
		return nil, fmt.Errorf("no live subscription %q", id)
	}
	return live.poll(after, limit), nil
}

// StopLiveSubscription ends the stream and unsubscribes on the broker.
//
// The broker keeps a subscription until it is told otherwise, so a page that
// closed without this leaves the session receiving traffic nobody reads - and
// on a shared subscription, taking a share of it away from a real consumer.
func (c *Conn) StopLiveSubscription(ctx context.Context, id string) error {
	c.streamsMu.Lock()
	live, known := c.streams[id]
	if known {
		delete(c.streams, id)
	}
	c.streamsMu.Unlock()
	if !known {
		return fmt.Errorf("no live subscription %q", id)
	}
	if c.client == nil {
		return nil
	}

	// Only drop filters no surviving stream still wants: two panels watching
	// the same wildcard are one subscription on the broker.
	patterns := make([]string, 0, len(live.filters))
	for _, filter := range live.filters {
		if !c.filterInUse(filter.Pattern) {
			patterns = append(patterns, filter.Pattern)
		}
	}
	if len(patterns) == 0 {
		return nil
	}
	return c.client.Unsubscribe(ctx, patterns)
}

// LiveSubscriptions is what this connection is currently streaming.
func (c *Conn) LiveSubscriptions(_ context.Context) ([]*model.LiveSubscription, error) {
	c.streamsMu.RLock()
	defer c.streamsMu.RUnlock()

	subscriptions := make([]*model.LiveSubscription, 0, len(c.streams))
	for _, live := range c.streams {
		subscriptions = append(subscriptions, live.snapshot())
	}
	sort.Slice(subscriptions, func(i, j int) bool {
		return subscriptions[i].ID < subscriptions[j].ID
	})
	return subscriptions, nil
}

func (c *Conn) filterInUse(pattern string) bool {
	c.streamsMu.RLock()
	defer c.streamsMu.RUnlock()

	for _, live := range c.streams {
		for _, filter := range live.filters {
			if filter.Pattern == pattern {
				return true
			}
		}
	}
	return false
}

// deliver routes one arrival to every stream that asked for it, and to a
// topic listing if one is collecting.
//
// Every stream, not the first: two panels watching overlapping filters are one
// subscription on the broker and both have to see the message.
//
// A listing subscribes to # and the broker replays its retained messages to
// the whole session, so a stream watching a matching filter sees them again
// while a listing runs. They are not dropped on the way past: they really were
// delivered, they carry the retained flag that says what they are, and
// discarding them would mean losing a genuinely new retained publish that
// happened to land inside the window.
func (c *Conn) deliver(message inboundMessage) {
	c.collectMu.Lock()
	collector := c.collector
	c.collectMu.Unlock()
	if collector != nil {
		collector.accept(message)
	}

	c.streamsMu.RLock()
	streams := make([]*stream, 0, len(c.streams))
	for _, live := range c.streams {
		streams = append(streams, live)
	}
	c.streamsMu.RUnlock()

	for _, live := range streams {
		for _, filter := range live.filters {
			if !matchesFilter(filter.Pattern, message.Topic) {
				continue
			}
			live.append(liveMessageOf(message, filter.Pattern))
			break
		}
	}
}

// setStreamsLive marks every stream after the session went down or came back,
// so a panel can tell "nothing is being published" from "we stopped listening".
func (c *Conn) setStreamsLive(live bool) {
	c.streamsMu.RLock()
	defer c.streamsMu.RUnlock()

	for _, s := range c.streams {
		s.setLive(live)
	}
}

// resubscribeFilters is every filter the live streams need, for the client to
// re-establish after a reconnect. A clean session keeps nothing, so without
// this a dropped connection would come back silent.
func (c *Conn) resubscribeFilters() []subscribeFilter {
	c.streamsMu.RLock()
	defer c.streamsMu.RUnlock()

	seen := make(map[string]bool)
	filters := make([]subscribeFilter, 0)
	for _, live := range c.streams {
		for _, filter := range live.filters {
			if seen[filter.Pattern] {
				continue
			}
			seen[filter.Pattern] = true
			qos, err := filterQoS(filter)
			if err != nil {
				qos = 0
			}
			filters = append(filters, subscribeFilter{Pattern: filter.Pattern, QoS: qos})
		}
	}
	sort.Slice(filters, func(i, j int) bool { return filters[i].Pattern < filters[j].Pattern })
	return filters
}

func liveMessageOf(message inboundMessage, filter string) *model.LiveMessage {
	body := message.Payload
	truncated := false
	if len(body) > maxBodyBytes {
		body = body[:maxBodyBytes]
		truncated = true
	}

	live := &model.LiveMessage{
		Destination: message.Topic,
		Filter:      filter,
		ReceivedAt:  timestamp.Now(),
		Body:        string(body),
		Truncated:   truncated,
		Attributes: map[string]string{
			AttrQoS:      strconv.Itoa(int(message.QoS)),
			AttrRetained: strconv.FormatBool(message.Retained),
		},
	}
	if message.ContentType != "" {
		live.Attributes[AttrContentType] = message.ContentType
	}
	if message.ResponseTopic != "" {
		live.Attributes[AttrResponseTopic] = message.ResponseTopic
	}
	if message.CorrelationData != "" {
		live.Attributes[AttrCorrelationData] = message.CorrelationData
	}
	if message.MessageExpiry > 0 {
		live.Attributes[AttrMessageExpiry] = strconv.FormatUint(uint64(message.MessageExpiry), 10)
	}
	for name, value := range message.UserProperties {
		live.Attributes[AttrUserProperty+name] = value
	}
	return live
}

// filterQoS reads the per-filter QoS, which is the only option MQTT puts on a
// subscription.
func filterQoS(filter model.LiveFilter) (byte, error) {
	raw, set := filter.Options[AttrQoS]
	if !set || raw == "" {
		return 0, nil
	}
	qos, err := strconv.Atoi(raw)
	if err != nil || qos < 0 || qos > 2 {
		return 0, fmt.Errorf("qos must be 0, 1 or 2, not %q", raw)
	}
	return byte(qos), nil
}

func streamID() string {
	id := make([]byte, 8)
	if _, err := rand.Read(id); err != nil {
		return "stream"
	}
	return hex.EncodeToString(id)
}
