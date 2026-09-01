package mqtt

import (
	"context"
	"fmt"
	"time"

	paho3 "github.com/eclipse/paho.mqtt.golang"
)

// protocolVersion311 is paho.mqtt.golang's number for MQTT 3.1.1.
//
// Set explicitly rather than left at the library's zero, which means "try
// 3.1.1 and silently fall back to 3.1". That fallback would connect this
// driver to a broker at a version the rest of it does not assume, and the
// user picked 3.1.1 on the form.
const protocolVersion311 = 4

// subscribeFailure311 is the granted QoS a 3.1.1 broker returns for a filter
// it refused. It arrives in the SUBACK as a value rather than as an error,
// so a filter that was declined otherwise reads as a topic nobody publishes.
const subscribeFailure311 = 0x80

// clientV311 speaks MQTT 3.1.1 through paho.mqtt.golang.
//
// The library is in maintenance mode upstream and is still the only Go client
// for this version — paho.golang, its replacement, is 5.0 only. It is here for
// the brokers that refuse a 5.0 CONNECT: Mosquitto 1.x and a good deal of
// embedded and appliance MQTT.
//
// What is lost against 5.0 is worth naming, because it shapes what the boards
// can show: no reason codes (a refusal is a number from a fixed table, and a
// broker that just closes the socket says nothing at all), no user properties,
// no message expiry, and no shared subscriptions.
type clientV311 struct {
	config clientConfig
	client paho3.Client

	onMessage func(inboundMessage)
	onUp      func() []subscribeFilter
	onDown    func()
}

func newClientV311(config clientConfig) (*clientV311, error) {
	client := &clientV311{config: config}
	client.client = paho3.NewClient(clientOptionsV311(config, client))
	return client, nil
}

func (c *clientV311) OnMessage(handler func(inboundMessage))          { c.onMessage = handler }
func (c *clientV311) OnConnectionUp(handler func() []subscribeFilter) { c.onUp = handler }
func (c *clientV311) OnConnectionDown(handler func())                 { c.onDown = handler }

// Subscribe adds filters to the session.
//
// One SubscribeMultiple rather than a call per filter, because 3.1.1 grants a
// QoS per filter in a single SUBACK and this is the only way to read them
// together. 0x80 there is a refusal, which arrives as a granted QoS rather
// than as an error - so without the check below a filter the broker declined
// reads as a topic nobody publishes to.
func (c *clientV311) Subscribe(ctx context.Context, filters []subscribeFilter) error {
	if len(filters) == 0 {
		return nil
	}
	if !c.client.IsConnectionOpen() {
		return errConnectionDown
	}

	wanted := make(map[string]byte, len(filters))
	for _, filter := range filters {
		wanted[filter.Pattern] = filter.QoS
	}

	token := c.client.SubscribeMultiple(wanted, c.handleMessage)
	select {
	case <-token.Done():
		if err := token.Error(); err != nil {
			return err
		}
	case <-ctx.Done():
		return ctx.Err()
	}

	if granted, ok := token.(*paho3.SubscribeToken); ok {
		for pattern, qos := range granted.Result() {
			if qos == subscribeFailure311 {
				return fmt.Errorf("broker refused the subscription to %q", pattern)
			}
		}
	}
	return nil
}

// Unsubscribe drops filters from the session.
func (c *clientV311) Unsubscribe(ctx context.Context, patterns []string) error {
	if len(patterns) == 0 {
		return nil
	}
	if !c.client.IsConnectionOpen() {
		return errConnectionDown
	}

	token := c.client.Unsubscribe(patterns...)
	select {
	case <-token.Done():
		return token.Error()
	case <-ctx.Done():
		return ctx.Err()
	}
}

// handleMessage turns one delivery into the seam's shape.
//
// Everything 5.0 puts in properties is absent here, and so is NoLocal: 3.1.1
// has no way to ask the broker not to echo this connection's own publishes
// back, so a workbench watching a filter the send console publishes to will
// see its own messages. That is the protocol, not a defect, and the alternative
// - filtering them out by guessing - would hide a real duplicate.
func (c *clientV311) handleMessage(_ paho3.Client, message paho3.Message) {
	if c.onMessage == nil {
		return
	}
	c.onMessage(inboundMessage{
		Topic:    message.Topic(),
		Payload:  message.Payload(),
		QoS:      message.Qos(),
		Retained: message.Retained(),
	})
}

// resubscribe re-establishes the live filters after a connect. Clean session
// keeps none, so without this a reconnect comes back silent.
func (c *clientV311) resubscribe() {
	if c.onUp == nil {
		return
	}
	filters := c.onUp()
	if len(filters) == 0 {
		return
	}

	wanted := make(map[string]byte, len(filters))
	for _, filter := range filters {
		wanted[filter.Pattern] = filter.QoS
	}
	token := c.client.SubscribeMultiple(wanted, c.handleMessage)
	token.WaitTimeout(c.config.DialTimeout)
}

// Connect dials and waits for CONNACK.
//
// The token is waited on through its channel rather than WaitTimeout so the
// caller's cancellation is honoured: a user who closed the dialog should not
// keep a socket open for the rest of the dial timeout.
func (c *clientV311) Connect(ctx context.Context) error {
	token := c.client.Connect()
	select {
	case <-token.Done():
		return token.Error()
	case <-ctx.Done():
		// The library has no way to abandon an in-flight connect, so the
		// client is told to drop whatever it ends up with.
		c.client.Disconnect(0)
		return ctx.Err()
	}
}

// Ping proves the session is live rather than merely believed to be. See the
// note on pingFilter: unsubscribing from a filter never subscribed to is the
// only MQTT round trip with no observable effect.
func (c *clientV311) Ping(ctx context.Context) error {
	if !c.client.IsConnectionOpen() {
		return errConnectionDown
	}
	token := c.client.Unsubscribe(pingFilter)
	select {
	case <-token.Done():
		return token.Error()
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Publish sends one message.
//
// The answer is always empty: 3.1.1's PUBACK carries no reason code, so
// "accepted" is everything the broker says, and there is no way to learn that
// nothing was subscribed. The connection check is not redundant with that —
// the library queues QoS 1 and 2 publishes while it reconnects, so without it
// a send into a dead session reports success and may never leave the process.
func (c *clientV311) Publish(ctx context.Context, request PublishRequest) (*publishAnswer, error) {
	if !c.client.IsConnectionOpen() {
		return nil, errConnectionDown
	}

	token := c.client.Publish(request.Topic, request.QoS, request.Retain, []byte(request.Payload))
	select {
	case <-token.Done():
		if err := token.Error(); err != nil {
			return nil, err
		}
		return nil, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// Disconnect ends the session. The library's own Disconnect is a no-op when
// the client is already disconnected, so this needs no guard of its own.
func (c *clientV311) Disconnect() error {
	c.client.Disconnect(uint(disconnectGrace / time.Millisecond))
	return nil
}

// clientOptionsV311 is this driver's profile expressed as the library's
// options.
func clientOptionsV311(config clientConfig, owner *clientV311) *paho3.ClientOptions {
	options := paho3.NewClientOptions()
	// Called after every successful connect, reconnects included.
	options.SetOnConnectHandler(func(paho3.Client) { go owner.resubscribe() })
	options.SetConnectionLostHandler(func(paho3.Client, error) {
		if owner.onDown != nil {
			owner.onDown()
		}
	})
	for _, server := range config.Servers {
		options.AddBroker(server.String())
	}
	options.SetClientID(config.ClientID)
	options.SetProtocolVersion(protocolVersion311)
	options.SetCleanSession(config.CleanStart)
	options.SetKeepAlive(config.KeepAlive)
	options.SetConnectTimeout(config.DialTimeout)
	options.SetTLSConfig(config.TLS)
	// Reconnect after a drop, but do not retry the first connection: a
	// rejected password has to surface from Connect, and ConnectRetry would
	// turn it into a wait that never ends.
	options.SetAutoReconnect(true)
	options.SetConnectRetry(false)
	// The session is clean, so there is nothing to resume and asking the
	// library to replay subscriptions it never made only delays a reconnect.
	options.SetResumeSubs(false)
	if config.Authenticates {
		options.SetUsername(config.Username)
		options.SetPassword(config.Password)
	}
	return options
}
