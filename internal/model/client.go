package model

// ClientConnection is one application's connection to the broker.
//
// It has no counterpart in the canonical vocabulary on purpose. RocketMQ and
// Kafka expose producers and consumers, which are roles; this is the transport
// underneath them, and an operator uses it for a different job - finding which
// host is holding a connection open, which one is being throttled, and which
// one to close when an application will not let go.
type ClientConnection struct {
	// Name is the broker's own identifier, of the form "host:port -> host:port".
	// It is what a close request names, so it is the key rather than a label.
	Name string `json:"name"`
	// ClientName is what the application called itself, or "" when it said
	// nothing. Most libraries send nothing, which is why the peer address
	// stays the primary identifier.
	ClientName string `json:"clientName"`

	Namespace string `json:"namespace"`
	User      string `json:"user"`
	Node      string `json:"node"`
	PeerHost  string `json:"peerHost"`
	PeerPort  int    `json:"peerPort"`

	// Protocol is the wire protocol this connection speaks. A broker with the
	// MQTT or STOMP plugins on carries connections that are not AMQP at all,
	// and treating them alike would misreport both.
	Protocol string `json:"protocol"`
	State    string `json:"state"`
	Channels int    `json:"channels"`

	// TLS is whether the transport is encrypted, and Cipher names how. An
	// empty cipher on a TLS connection means the broker did not report one.
	TLS    bool   `json:"tls"`
	Cipher string `json:"cipher"`

	// HeartbeatSec is what the two sides negotiated. Zero means heartbeats are
	// off, which is worth seeing: a connection with none can sit half-open
	// through a network partition and look healthy from both ends.
	HeartbeatSec int `json:"heartbeatSec"`

	RecvBytes    int64   `json:"recvBytes"`
	SendBytes    int64   `json:"sendBytes"`
	RecvByteRate float64 `json:"recvByteRate"`
	SendByteRate float64 `json:"sendByteRate"`

	// ConnectedAtMs is when the connection was established, in Unix
	// milliseconds, or 0 when the broker did not report it.
	ConnectedAtMs int64 `json:"connectedAtMs"`

	// BlockedBy is why the broker last stopped this connection publishing -
	// a resource alarm, usually memory or disk. Empty means it was never
	// blocked.
	BlockedBy string `json:"blockedBy"`
}

// ClientChannel is one multiplexed session inside a connection.
//
// A channel is where the interesting failure lives: prefetch and
// unacknowledged counts are per channel, and a consumer that has stopped
// acknowledging shows up here long before the queue depth makes it obvious.
type ClientChannel struct {
	Name       string `json:"name"`
	Number     int    `json:"number"`
	Connection string `json:"connection"`

	Namespace string `json:"namespace"`
	User      string `json:"user"`
	Node      string `json:"node"`

	// There is deliberately no state field. The management API reports one but
	// the client library does not model it, and the two flags that matter -
	// flow-blocked and idle-since - are here in full, so deriving a word from
	// them would be inventing a field rather than reporting one.
	Consumers     int `json:"consumers"`
	PrefetchCount int `json:"prefetchCount"`

	// Unacknowledged is delivered and not yet acked. Unconfirmed is published
	// and not yet confirmed back to the publisher. They are the two sides of
	// in-flight work and fail for opposite reasons.
	Unacknowledged int `json:"unacknowledged"`
	Unconfirmed    int `json:"unconfirmed"`

	// Confirms and Transactional are the two delivery guarantees a channel can
	// be in, and they are mutually exclusive in AMQP.
	Confirms      bool `json:"confirms"`
	Transactional bool `json:"transactional"`

	// FlowBlocked is the broker telling this channel to stop publishing. It is
	// the single most useful field here: a publisher that has slowed down for
	// no apparent reason is usually looking at this.
	FlowBlocked bool `json:"flowBlocked"`

	// IdleSince is when the channel last did anything, as the broker spells
	// it. Empty means it is busy now.
	IdleSince string `json:"idleSince"`
}
