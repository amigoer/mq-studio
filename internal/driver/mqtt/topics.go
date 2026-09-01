package mqtt

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/timestamp"
)

const (
	// discoveryWindow is how long a listing waits for the broker to replay its
	// retained messages.
	//
	// There is nothing to ask for the end of the list, so the only way to know
	// the replay is over is that it stopped arriving. The window is short
	// because it is spent on every refresh, and the quiet period below usually
	// ends it well inside that.
	discoveryWindow = 1500 * time.Millisecond

	// quietPeriod ends a listing early once nothing has arrived for a while.
	// The retained replay comes as fast as the socket allows, so a gap this
	// long means it is over.
	quietPeriod = 250 * time.Millisecond

	// maxDiscovered bounds a listing on a broker with a very large retained
	// set. Truncating and saying so beats holding an unbounded reply.
	maxDiscovered = 5000

	// discoveryFilter is what a listing subscribes to. $SYS is excluded by the
	// specification's own rule that a leading wildcard does not match a
	// leading $, which is what keeps the broker's telemetry out of the topic
	// list.
	discoveryFilter = "#"

	// Attributes a discovered topic carries. They are a contract with
	// frontend/src/mq/mqtt/destinations.ts.
	AttrSource        = "source"
	AttrRetainedBytes = "retainedBytes"

	// sourceRetained says where the topic came from. It is the whole caveat of
	// this listing in one attribute: the topic is here because it holds a
	// retained value, not because the broker was asked what exists.
	sourceRetained = "retained"
)

/*
 * Listing topics on a protocol that cannot enumerate them.
 *
 * MQTT has no topic registry. A topic exists while a message is in flight to
 * it and not otherwise, so there is nothing to ask. What there is: a retained
 * message, which the broker keeps as a topic's last known value and replays to
 * whoever subscribes next.
 *
 * So a listing subscribes to everything, collects the replay, and
 * unsubscribes. That is an honest answer to a different question - "which
 * topics hold a value" rather than "which topics exist" - and the source
 * attribute says which question was answered, because a device that publishes
 * without the retain flag will not appear here and its absence is not a fault.
 *
 * Only CapDestinationList is declared. Create and update have nothing to mean,
 * and delete would be the wrong word for the one write MQTT does have here:
 * publishing an empty retained message clears a topic's stored value and does
 * not remove a topic, because there was never an object to remove. That
 * belongs on MQTT's own service under its own name.
 */

// ListDestinations discovers topics from the broker's retained messages.
func (c *Conn) ListDestinations(
	ctx context.Context, _ model.DestinationFilter,
) ([]*model.Destination, error) {
	retained, err := c.collectRetained(ctx)
	if err != nil {
		return nil, err
	}

	destinations := make([]*model.Destination, 0, len(retained))
	for _, message := range retained {
		destinations = append(destinations, destinationOf(message))
	}
	sort.Slice(destinations, func(i, j int) bool {
		return destinations[i].Ref.Name < destinations[j].Ref.Name
	})
	for i, destination := range destinations {
		destination.ID = i + 1
	}
	return destinations, nil
}

// DestinationDetail reads one topic's retained value.
//
// It subscribes to the topic itself rather than filtering a full listing: on a
// broker with thousands of retained topics the difference is a single replayed
// message against all of them.
func (c *Conn) DestinationDetail(
	ctx context.Context, ref model.DestinationRef,
) (*model.Destination, error) {
	if ref.Name == "" {
		return nil, fmt.Errorf("a topic name is required")
	}
	if containsWildcard(ref.Name) {
		return nil, fmt.Errorf("a topic to inspect cannot contain + or #")
	}

	retained, err := c.collectRetainedFrom(ctx, ref.Name)
	if err != nil {
		return nil, err
	}
	message, held := retained[ref.Name]
	if !held {
		// Not an error: the topic may be perfectly live and simply publish
		// without the retain flag. Saying "no retained value" is the honest
		// answer, and saying "no such topic" would not be.
		return nil, fmt.Errorf("%q holds no retained message", ref.Name)
	}
	return destinationOf(message), nil
}

// CreateDestination has nothing to do. A topic is not an object here: it comes
// into being when a message is published to it and stops when the message is
// delivered.
func (c *Conn) CreateDestination(_ context.Context, _ model.DestinationSpec) error {
	return driver.Unsupported(c, model.CapDestinationCreate)
}

// UpdateDestination has nothing to configure: a topic carries no settings.
func (c *Conn) UpdateDestination(_ context.Context, _ model.DestinationSpec) error {
	return driver.Unsupported(c, model.CapDestinationUpdate)
}

// RemoveDestination has nothing to remove.
//
// Clearing a topic's retained value is a real operation - an empty retained
// publish does it - but it is not this one, and offering it here would put a
// Delete on a list of topics that mostly have no retained value to clear.
func (c *Conn) RemoveDestination(_ context.Context, _ model.DestinationRef) error {
	return driver.Unsupported(c, model.CapDestinationDelete)
}

// collectRetained subscribes to everything and gathers the replay.
func (c *Conn) collectRetained(ctx context.Context) (map[string]inboundMessage, error) {
	return c.collectRetainedFrom(ctx, discoveryFilter)
}

// collectRetainedFrom subscribes to one filter, gathers what the broker
// replays, and unsubscribes.
//
// Only one listing runs at a time. That is a consequence of there being one
// session: two listings would subscribe to the same filter and the second
// unsubscribe would take the first one's delivery away, so the collector is a
// single slot rather than a set.
func (c *Conn) collectRetainedFrom(ctx context.Context, filter string) (map[string]inboundMessage, error) {
	if c.client == nil {
		return nil, errConnectionDown
	}

	collector := &retainedCollector{
		messages: make(map[string]inboundMessage),
		quiet:    time.NewTimer(discoveryWindow),
	}
	defer collector.quiet.Stop()

	c.collectMu.Lock()
	c.collector = collector
	c.collectMu.Unlock()
	defer func() {
		c.collectMu.Lock()
		c.collector = nil
		c.collectMu.Unlock()
	}()

	if err := c.client.Subscribe(ctx, []subscribeFilter{{Pattern: filter}}); err != nil {
		return nil, err
	}
	defer func() {
		// Unsubscribing is not cleanup that can be skipped: the subscription
		// lives on the broker, and a listing that left it behind would keep
		// delivering the whole firehose to this session forever.
		//
		// A filter a live stream still wants is left alone, and the context is
		// deliberately not the caller's: a cancelled listing still has to let
		// go of the broker's side.
		if c.filterInUse(filter) {
			return
		}
		stopCtx, cancel := context.WithTimeout(context.Background(), c.config.DialTimeout)
		defer cancel()
		_ = c.client.Unsubscribe(stopCtx, []string{filter})
	}()

	deadline := time.NewTimer(discoveryWindow)
	defer deadline.Stop()
	select {
	case <-collector.done():
	case <-deadline.C:
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	return collector.collected(), nil
}

// retainedCollector gathers a retained replay and decides when it is over.
//
// Nothing marks the end of the replay, so the end is inferred from silence:
// the messages arrive as fast as the socket allows, and a gap means the broker
// has finished. quiet is reset on every arrival and firing it ends the wait.
type retainedCollector struct {
	mu        sync.Mutex
	messages  map[string]inboundMessage
	truncated bool
	quiet     *time.Timer
}

func (r *retainedCollector) accept(message inboundMessage) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// A live message arriving mid-listing is not a retained one and must not
	// be reported as a topic's stored value.
	if !message.Retained {
		return
	}
	if len(r.messages) >= maxDiscovered {
		r.truncated = true
		return
	}
	r.messages[message.Topic] = message
	r.quiet.Reset(quietPeriod)
}

func (r *retainedCollector) done() <-chan time.Time { return r.quiet.C }

func (r *retainedCollector) collected() map[string]inboundMessage {
	r.mu.Lock()
	defer r.mu.Unlock()

	collected := make(map[string]inboundMessage, len(r.messages))
	for topic, message := range r.messages {
		collected[topic] = message
	}
	return collected
}

func destinationOf(message inboundMessage) *model.Destination {
	return &model.Destination{
		Ref: model.DestinationRef{Name: message.Topic},
		// Every count MQTT has no concept of. A drawn zero next to a real
		// figure reads as "none", which is a different claim from "the
		// protocol does not report this".
		Partitions:  model.UnknownMetric,
		Subscribers: model.UnknownMetric,
		Depth:       model.UnknownMetric,
		RateIn:      model.UnknownMetric,
		RateOut:     model.UnknownMetric,
		LastUpdated: timestamp.Now(),
		Attributes: map[string]string{
			AttrSource:        sourceRetained,
			AttrRetainedBytes: strconv.Itoa(len(message.Payload)),
			AttrQoS:           strconv.Itoa(int(message.QoS)),
		},
	}
}
