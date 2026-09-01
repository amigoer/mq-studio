package model

// A live stream is what a broker pushes, as opposed to what it stores.
//
// MessageTailer covers the other case and says why: no broker this app speaks
// to pushes admin data, so a tail is a poll however it is dressed, and what a
// driver contributes there is making the poll incremental against a durable
// log. MQTT has no such log. Its messages exist only while someone is
// subscribed, arrive without being asked for, and are gone if nobody was
// listening — so a cursor into stored data is the wrong shape entirely.
//
// What replaces it: the driver holds a bounded buffer per subscription, fed by
// the broker, and the caller drains it by sequence number. The sequence counts
// within one subscription and restarts with the next, because there is nothing
// durable for it to refer to.

// LiveFilter is one pattern a stream subscribes to.
type LiveFilter struct {
	// Pattern is the family's own filter syntax, unparsed. MQTT's + and #
	// wildcards mean nothing to another family, and translating them into a
	// neutral form would only lose the difference between them.
	Pattern string `json:"pattern"`
	// Options are the family's per-filter settings — for MQTT, the QoS to
	// subscribe at.
	Options map[string]string `json:"options"`
}

// LiveSubscriptionSpec asks a connection to start streaming.
type LiveSubscriptionSpec struct {
	Filters []LiveFilter `json:"filters"`
	// Buffer is how many messages to hold between two polls. Zero takes the
	// driver's default. It is a bound on memory, and the reason Dropped below
	// has to be reported rather than assumed to be zero.
	Buffer int `json:"buffer"`
}

// LiveSubscription is one stream that was started.
type LiveSubscription struct {
	ID        string       `json:"id"`
	Filters   []LiveFilter `json:"filters"`
	StartedAt string       `json:"startedAt"`
	// Received is every message this stream has seen, including any it later
	// had to drop.
	Received int64 `json:"received"`
	Dropped  int64 `json:"dropped"`
	// Live is false once the session behind the stream dropped. The stream
	// itself survives — a reconnect resubscribes it — so this is the
	// difference between "nothing is being published" and "we stopped
	// listening", which look identical otherwise.
	Live bool `json:"live"`
}

// LiveMessage is one message as it arrived.
type LiveMessage struct {
	// Seq orders the stream and is what the caller hands back to ask for more.
	// It is unique within one subscription and means nothing outside it.
	Seq int64 `json:"seq"`
	// Destination is where the message was actually published, which a
	// wildcard subscription cannot infer from the filter that matched it.
	Destination string `json:"destination"`
	// Filter is which of the subscription's filters matched, so a stream
	// watching several can be read back apart.
	Filter     string `json:"filter"`
	ReceivedAt string `json:"receivedAt"`
	Body       string `json:"body"`
	// Truncated says the body was cut to the driver's per-message limit. A
	// silently shortened payload reads as a malformed message.
	Truncated bool `json:"truncated"`
	// Attributes carry what the family puts on a message — for MQTT, the QoS,
	// the retain flag and the 5.0 properties.
	Attributes map[string]string `json:"attributes"`
}

// LiveBatch is one poll's worth of a stream.
type LiveBatch struct {
	// Messages are oldest first, which is the order a stream appends in.
	Messages []*LiveMessage `json:"messages"`
	// Cursor is what to pass next time. It advances even when nothing came
	// back, so a caller that polls a quiet stream does not re-ask for the
	// same window forever.
	Cursor int64 `json:"cursor"`
	// Dropped is every message this stream discarded because the buffer was
	// full when it arrived — a running total, not a delta, so a caller that
	// polls irregularly still sees the whole loss. A stream that is quietly
	// losing messages and one that is quiet look the same without it.
	Dropped int64 `json:"dropped"`
	// Received is the running total the stream has seen.
	Received int64 `json:"received"`
	// Live mirrors LiveSubscription.Live at the moment of the poll.
	Live bool `json:"live"`
}
