package mqtt

import (
	"context"
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
}

func newClientV311(config clientConfig) (*clientV311, error) {
	return &clientV311{config: config, client: paho3.NewClient(clientOptionsV311(config))}, nil
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

// Disconnect ends the session. The library's own Disconnect is a no-op when
// the client is already disconnected, so this needs no guard of its own.
func (c *clientV311) Disconnect() error {
	c.client.Disconnect(uint(disconnectGrace / time.Millisecond))
	return nil
}

// clientOptionsV311 is this driver's profile expressed as the library's
// options.
func clientOptionsV311(config clientConfig) *paho3.ClientOptions {
	options := paho3.NewClientOptions()
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
