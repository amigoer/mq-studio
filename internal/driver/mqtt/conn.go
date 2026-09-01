package mqtt

import (
	"context"
	"errors"
	"sync"

	"github.com/amigoer/mq-studio/internal/model"
)

// errConnectionDown is the session having dropped, as opposed to a request
// failing. The two lead somewhere different — one is the network, the other is
// the broker's answer — so they must not arrive as the same error.
var errConnectionDown = errors.New("mqtt session is not connected")

// Conn is one live MQTT connection.
//
// There is one session, not a data plane and a management plane. When a
// management API is reached later it will be a second endpoint over HTTP, but
// it is optional: the session is what this connection is, and it staying up is
// what every page here depends on.
type Conn struct {
	client mqttClient
	config clientConfig

	// streams are the live subscriptions this connection is buffering. They
	// are state the driver holds, unlike everything else here, because MQTT
	// messages exist only while someone is subscribed - nothing else in the
	// process can go back for them.
	streamsMu sync.RWMutex
	streams   map[string]*stream

	// collector is set while a topic listing is gathering the broker's
	// retained replay. It is separate from the streams so that refreshing the
	// topic board does not route the whole retained set through them.
	collectMu sync.Mutex
	collector *retainedCollector

	capabilities model.Capabilities
	closeOnce    sync.Once
}

// newConn wraps a client and installs the handlers it delivers through.
//
// The handlers go on before Connect rather than after, because a session that
// reconnects resubscribes from inside the library's own connect callback: one
// installed later would miss the first delivery after every reconnect.
func newConn(client mqttClient, config clientConfig) *Conn {
	conn := &Conn{
		client:       client,
		config:       config,
		streams:      make(map[string]*stream),
		capabilities: model.NewCapabilities(capabilities()...),
	}
	if client != nil {
		client.OnMessage(conn.deliver)
		client.OnConnectionUp(conn.sessionUp)
		client.OnConnectionDown(conn.sessionDown)
	}
	return conn
}

// sessionUp marks every stream live again and says what to resubscribe.
func (c *Conn) sessionUp() []subscribeFilter {
	c.setStreamsLive(true)
	return c.resubscribeFilters()
}

// sessionDown marks the streams as no longer listening. A page that cannot
// tell that from a quiet broker will show a stalled panel as a working one.
func (c *Conn) sessionDown() {
	c.setStreamsLive(false)
}

// Kind identifies the family.
func (c *Conn) Kind() model.MQKind { return model.KindMQTT }

// Ping asks the broker to answer, over the wire, every time. See pingFilter
// for why an unsubscribe is what does the asking.
func (c *Conn) Ping(ctx context.Context) error {
	if c.client == nil {
		return errConnectionDown
	}
	return c.client.Ping(ctx)
}

// Capabilities is what this endpoint can do.
func (c *Conn) Capabilities() model.Capabilities { return c.capabilities }

// Close ends the session. The registry closes on both disconnect and shutdown,
// so the second call has to be the one that does nothing.
func (c *Conn) Close() error {
	c.closeOnce.Do(func() {
		if c.client != nil {
			_ = c.client.Disconnect()
		}
	})
	return nil
}

// capabilities is the family's best case.
//
// It grows one port at a time: CheckConformance fails a capability with no
// interface behind it, so each one arrives in the commit that implements it
// rather than as a promise the connection cannot keep.
//
// CapPublishRich is deliberately absent even though this driver publishes with
// QoS, retain and 5.0 properties. That capability is backed by RichPublisher,
// whose model.PublishRequest is AMQP-shaped, and answering it would mean a
// send console of exchange and routing-key controls that do nothing. The rich
// publish is MQTT's own, on MQTT's own service.
func capabilities() []model.Capability {
	return []model.Capability{
		model.CapDestinationList,
		model.CapPublish,
		model.CapLiveStream,
		model.CapClusterTopology,
		model.CapClusterMetrics,
	}
}

// probe narrows the family's best case to what this broker actually answers.
//
// Only the $SYS tier is probed, because it is the only one that can be absent
// on a connection that opened: publishing and subscribing are the protocol
// itself, and a session that connected can do both. What differs between
// brokers is whether they will talk about themselves - Mosquitto publishes a
// full tree, EMQX's default authorisation refuses the subscription outright,
// and an embedded broker may accept it and publish nothing.
//
// Those last two are reported apart. "The broker refused" sends an operator to
// its access rules; "the broker publishes nothing" tells them there is nothing
// to configure, and a single reason covering both would send half of them to
// the wrong place.
func (c *Conn) probe(ctx context.Context) {
	c.capabilities = model.NewCapabilities(capabilities()...)

	tree, err := c.readSys(ctx)
	reason := ""
	switch {
	case err != nil:
		reason = sysRefused
	case tree.empty():
		reason = sysSilent
	}
	if reason == "" {
		return
	}
	c.capabilities = c.capabilities.
		WithDegraded(model.CapClusterTopology, reason).
		WithDegraded(model.CapClusterMetrics, reason)
}

// The reasons a connection reports for a tier it cannot read. They are i18n
// keys rather than sentences: the renderer turns them into the user's own
// language, because each one asks the user to go and do something.
const (
	// sysRefused is the broker declining the subscription. EMQX does this by
	// default for any client that is not on the loopback, so it is the common
	// case rather than an unusual one, and the fix is in its access rules.
	sysRefused = "mq.mqtt.degraded.sysRefused"
	// sysSilent is a broker that took the subscription and publishes no $SYS
	// at all. There is nothing to configure; the tree simply does not exist.
	sysSilent = "mq.mqtt.degraded.sysSilent"
)
