package model

// StreamClients is who is reading and writing a stream over the stream
// protocol.
//
// Separate from the consumer list every other queue type has, because the
// stream protocol is not AMQP: a client on port 5552 never appears in
// /api/consumers. A stream being read by three applications reports zero
// consumers there, which is the misreading this exists to prevent.
type StreamClients struct {
	Publishers []*StreamPublisher `json:"publishers"`
	Consumers  []*StreamConsumer  `json:"consumers"`
}

// StreamPublisher is one client writing to a stream.
type StreamPublisher struct {
	// Reference is the publisher's own name, which the broker uses to
	// deduplicate messages across a reconnect. Empty means the client sent
	// none, so it gets no deduplication.
	Reference  string `json:"reference"`
	Connection string `json:"connection"`
	PeerHost   string `json:"peerHost"`
	User       string `json:"user"`
	Node       string `json:"node"`

	Published int64 `json:"published"`
	Confirmed int64 `json:"confirmed"`
	Errored   int64 `json:"errored"`
}

// StreamConsumer is one client reading a stream.
type StreamConsumer struct {
	Connection string `json:"connection"`
	PeerHost   string `json:"peerHost"`
	User       string `json:"user"`
	Node       string `json:"node"`

	// Offset is where in the stream this client has read to, and Lag is how
	// far that is behind the end. A stream keeps its messages after they are
	// read, so lag is the only thing that says whether a consumer is keeping
	// up - there is no queue depth to fall behind on.
	Offset int64 `json:"offset"`
	Lag    int64 `json:"lag"`

	Consumed int64 `json:"consumed"`
	// Credits is how many messages the broker may still send before the
	// client asks for more. Zero on an active consumer means it has stopped
	// asking.
	Credits int `json:"credits"`
	// Active is false for a single-active-consumer subscription that is
	// connected and waiting its turn, which is working rather than stuck.
	Active bool `json:"active"`
}
