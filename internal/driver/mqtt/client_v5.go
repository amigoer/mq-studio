package mqtt

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/eclipse/paho.golang/autopaho"
	"github.com/eclipse/paho.golang/paho"
)

// disconnectGrace bounds the DISCONNECT packet on the way out. Closing a
// connection must not be able to hang a window that is shutting down, and a
// broker that will not take the packet is about to lose the socket anyway.
const disconnectGrace = 2 * time.Second

// MQTT 5.0 reason codes this driver reads by name.
const (
	// reasonNoMatchingSubscribers is the broker reporting that it accepted the
	// message and had nobody to deliver it to. Success, and worth saying.
	reasonNoMatchingSubscribers = 0x10
	// reasonUnspecifiedError is where the refusals start: every code from 0x80
	// up is the broker declining, and they arrive on an acknowledgement rather
	// than as a transport failure.
	reasonUnspecifiedError = 0x80
)

// clientV5 speaks MQTT 5.0 through paho.golang's autopaho.
//
// autopaho rather than the bare paho package because everything this driver
// reads later lives on a session: $SYS counters and a live subscription both
// stop arriving the moment the connection drops, and with no reconnection the
// pages would go quietly stale instead of recovering. autopaho reconnects and
// replays the subscriptions on the way back up.
type clientV5 struct {
	config clientConfig

	// manager runs the connect-and-reconnect loop. Its context is this
	// client's lifetime, not any one call's, so it is cancelled by Disconnect
	// rather than by the ctx that opened the connection.
	manager    *autopaho.ConnectionManager
	cancel     context.CancelFunc
	closeOnce  sync.Once
	lastErrMu  sync.Mutex
	lastErr    error
	registered bool
}

func newClientV5(config clientConfig) (*clientV5, error) {
	return &clientV5{config: config}, nil
}

// Connect dials, and gives up on the deadline rather than on the broker.
//
// autopaho retries until its context ends, which is right for a reconnection
// and wrong for the first attempt: a rejected password would otherwise be
// indistinguishable from a slow network, forever. So the wait is bounded here,
// and the reason reported is the one OnConnectError saw — the retry loop hides
// it otherwise, since AwaitConnection can only report that time ran out.
func (c *clientV5) Connect(ctx context.Context) error {
	managerCtx, cancel := context.WithCancel(context.WithoutCancel(ctx))
	c.cancel = cancel

	manager, err := autopaho.NewConnection(managerCtx, c.clientConfig())
	if err != nil {
		cancel()
		return fmt.Errorf("build mqtt client: %w", err)
	}
	c.manager = manager
	c.registered = true

	awaitCtx, awaitCancel := context.WithTimeout(ctx, c.config.DialTimeout)
	defer awaitCancel()
	if err := manager.AwaitConnection(awaitCtx); err != nil {
		return c.connectFailure(err)
	}
	return nil
}

// Ping proves the session is live rather than merely believed to be.
//
// AwaitConnection alone would answer from the manager's own state, which
// survives a broker that stopped answering until the keepalive notices — up to
// a minute on the default. Unsubscribing from a filter this driver never
// subscribes to forces a real round trip and changes nothing: the broker
// answers UNSUBACK, under 5.0 with "no subscription existed", and no other
// client can observe that it happened.
func (c *clientV5) Ping(ctx context.Context) error {
	if c.manager == nil {
		return errors.New("mqtt client is not connected")
	}
	if err := c.manager.AwaitConnection(ctx); err != nil {
		return c.connectFailure(err)
	}
	_, err := c.manager.Unsubscribe(ctx, &paho.Unsubscribe{Topics: []string{pingFilter}})
	return err
}

// Publish sends one message and returns the broker's own answer.
func (c *clientV5) Publish(ctx context.Context, request PublishRequest) (*publishAnswer, error) {
	if c.manager == nil {
		return nil, errConnectionDown
	}

	response, err := c.manager.Publish(ctx, &paho.Publish{
		Topic:      request.Topic,
		QoS:        request.QoS,
		Retain:     request.Retain,
		Payload:    []byte(request.Payload),
		Properties: publishProperties(request),
	})
	if err != nil {
		return nil, err
	}
	return publishAnswerOf(response)
}

// publishAnswerOf reads a PUBACK or PUBCOMP.
//
// Split out from the call because the two codes worth naming are hard to
// provoke from a test broker and easy to get wrong: 16 is a success the
// console should still report, and everything from 0x80 up is a refusal that
// arrives on an acknowledgement rather than as a transport error — so without
// this a rejected publish would be reported as sent.
func publishAnswerOf(response *paho.PublishResponse) (*publishAnswer, error) {
	// QoS 0 is acknowledged by nothing, so there is no response to read.
	if response == nil {
		return nil, nil
	}

	answer := &publishAnswer{
		ReasonCode:            int(response.ReasonCode),
		NoMatchingSubscribers: response.ReasonCode == reasonNoMatchingSubscribers,
	}
	if response.Properties != nil {
		answer.Reason = response.Properties.ReasonString
	}
	if response.ReasonCode >= reasonUnspecifiedError {
		return answer, fmt.Errorf("broker refused the publish (reason %d): %s",
			answer.ReasonCode, answer.Reason)
	}
	return answer, nil
}

// publishProperties is nil unless the request set one, because an empty
// properties struct still puts a properties block on the wire.
func publishProperties(request PublishRequest) *paho.PublishProperties {
	properties := &paho.PublishProperties{
		ContentType:     request.ContentType,
		ResponseTopic:   request.ResponseTopic,
		CorrelationData: []byte(request.CorrelationData),
	}
	set := request.ContentType != "" || request.ResponseTopic != "" ||
		request.CorrelationData != ""

	if request.MessageExpiry > 0 {
		expiry := request.MessageExpiry
		properties.MessageExpiry = &expiry
		set = true
	}
	for name, value := range request.UserProperties {
		properties.User.Add(name, value)
		set = true
	}
	if !set {
		return nil
	}
	return properties
}

// Disconnect ends the session and stops the reconnection loop. The registry
// closes a connection on both disconnect and shutdown, so the second call has
// to be the one that does nothing.
func (c *clientV5) Disconnect() error {
	c.closeOnce.Do(func() {
		if c.manager != nil {
			ctx, cancel := context.WithTimeout(context.Background(), disconnectGrace)
			defer cancel()
			_ = c.manager.Disconnect(ctx)
		}
		if c.cancel != nil {
			c.cancel()
		}
	})
	return nil
}

// clientConfig is this driver's profile expressed as autopaho's configuration.
func (c *clientV5) clientConfig() autopaho.ClientConfig {
	config := autopaho.ClientConfig{
		ServerUrls:                    c.config.Servers,
		TlsCfg:                        c.config.TLS,
		KeepAlive:                     uint16(c.config.KeepAlive / time.Second),
		CleanStartOnInitialConnection: c.config.CleanStart,
		SessionExpiryInterval:         c.config.SessionExpiry,
		// Bounds one attempt. Without it a broker that accepts the socket and
		// never sends CONNACK holds the attempt for autopaho's own ten
		// seconds, which can outlast the caller's whole request budget.
		ConnectTimeout: c.config.DialTimeout,
		OnConnectError: c.recordConnectError,
		ClientConfig: paho.ClientConfig{
			ClientID: c.config.ClientID,
		},
	}
	if c.config.Authenticates {
		config.ConnectUsername = c.config.Username
		config.ConnectPassword = []byte(c.config.Password)
	}
	return config
}

func (c *clientV5) recordConnectError(err error) {
	c.lastErrMu.Lock()
	defer c.lastErrMu.Unlock()
	c.lastErr = err
}

// connectFailure prefers the broker's own reason over "the deadline passed",
// which is all the caller would otherwise see.
func (c *clientV5) connectFailure(await error) error {
	c.lastErrMu.Lock()
	last := c.lastErr
	c.lastErrMu.Unlock()
	if last != nil {
		return last
	}
	return await
}
