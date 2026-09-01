package mqtt

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/driver/mqtt/emqx"
	"github.com/amigoer/mq-studio/internal/model"
)

// Attributes a client carries beyond the canonical fields. They are a contract
// with frontend/src/mq/mqtt/clients.ts.
const (
	AttrCleanStart       = "cleanStart"
	AttrSessionExpiry    = "sessionExpiry"
	AttrSubscriptionsCnt = "subscriptions"
	AttrInflight         = "inflight"
	AttrQueued           = "queued"
	AttrQueueDropped     = "queueDropped"
	AttrListener         = "listener"
	AttrDurable          = "durable"
	AttrDisconnectedAt   = "disconnectedAt"
)

// ClientSubscription is one topic filter a client holds.
//
// It is this package's own type rather than model.Subscription, which is a
// consumer group: it has a lag, an offset and members. An MQTT subscription
// has none of those - it is one client's filter, and it stops existing when
// the client goes. Reporting it as a group would put a lag column on a page
// that can never fill one in.
type ClientSubscription struct {
	ClientID string `json:"clientId"`
	Node     string `json:"node"`
	Topic    string `json:"topic"`
	QoS      int    `json:"qos"`
	// The three MQTT 5.0 subscription options. They decide whether a client
	// gets its own publishes back, whether the retain flag survives, and
	// whether retained messages are replayed - all of which change what a
	// consumer sees and none of which 3.1.1 can express.
	NoLocal           bool `json:"noLocal"`
	RetainAsPublished bool `json:"retainAsPublished"`
	RetainHandling    int  `json:"retainHandling"`
	Durable           bool `json:"durable"`
}

/*
 * The management tier: what the broker adds that the protocol cannot express.
 *
 * MQTT can publish, subscribe, and read a broker's own $SYS counters. It
 * cannot say who is connected, what they subscribed to, or end a session.
 * EMQX answers all three over HTTP and Mosquitto has no such endpoint at all,
 * which is the whole reason this is probed at connect time rather than
 * declared: the same driver has to be honest on both.
 */

// ListClientConnections is who the broker is holding a session for.
func (c *Conn) ListClientConnections(
	ctx context.Context, _ string,
) ([]*model.ClientConnection, error) {
	management, err := c.management()
	if err != nil {
		return nil, err
	}

	clients, err := management.Clients(ctx, 0)
	if err != nil {
		return nil, err
	}
	connections := make([]*model.ClientConnection, 0, len(clients))
	for _, client := range clients {
		connections = append(connections, clientConnectionOf(client))
	}
	return connections, nil
}

// ListClientChannels is empty, always.
//
// A channel is AMQP's multiplexed session inside one connection, and MQTT has
// no such layer: one connection is one session. The method exists because
// ClientInspector pairs the two, and returning nothing is the honest answer
// rather than passing subscriptions off as channels.
func (c *Conn) ListClientChannels(
	_ context.Context, _ string,
) ([]*model.ClientChannel, error) {
	return nil, nil
}

// CloseClientConnection ends one client's session.
//
// The name is the client id, which is MQTT's identity for a session and what
// the broker's API takes. There is no "host:port -> host:port" here: a client
// that reconnects from a new port is the same session to the broker.
func (c *Conn) CloseClientConnection(ctx context.Context, name, _ string) error {
	management, err := c.management()
	if err != nil {
		return err
	}
	if name == "" {
		return fmt.Errorf("a client id is required")
	}
	// MQTT has no field for a reason. The broker sends DISCONNECT with a
	// reason code and no text, so a reason typed here would go nowhere - and
	// silently dropping it would have the operator believe the client was
	// told why.
	return management.Kick(ctx, name)
}

// CloseUserConnections ends every session a username holds.
func (c *Conn) CloseUserConnections(ctx context.Context, username, _ string) error {
	management, err := c.management()
	if err != nil {
		return err
	}
	if username == "" {
		return fmt.Errorf("a username is required")
	}

	clients, err := management.ClientsByUsername(ctx, username)
	if err != nil {
		return err
	}
	if len(clients) == 0 {
		return fmt.Errorf("no client is connected as %q", username)
	}
	for _, client := range clients {
		if err := management.Kick(ctx, client.ClientID); err != nil {
			return err
		}
	}
	return nil
}

// ClientSubscriptions is the filters one client holds.
func (c *Conn) ClientSubscriptions(ctx context.Context, clientID string) ([]*ClientSubscription, error) {
	management, err := c.management()
	if err != nil {
		return nil, err
	}
	if clientID == "" {
		return nil, fmt.Errorf("a client id is required")
	}

	subscriptions, err := management.ClientSubscriptions(ctx, clientID)
	if err != nil {
		return nil, err
	}
	return clientSubscriptionsOf(subscriptions), nil
}

// Subscriptions is every filter the broker is holding, across clients.
func (c *Conn) Subscriptions(ctx context.Context) ([]*ClientSubscription, error) {
	management, err := c.management()
	if err != nil {
		return nil, err
	}
	subscriptions, err := management.Subscriptions(ctx, 0)
	if err != nil {
		return nil, err
	}
	return clientSubscriptionsOf(subscriptions), nil
}

// management is the broker's API, or the reason there is none.
func (c *Conn) management() (*emqx.Client, error) {
	if c.emqx == nil {
		return nil, driver.Unsupported(c, model.CapClientInspect)
	}
	return c.emqx, nil
}

// probeManagement decides whether the management tier answers, and why not.
func (c *Conn) probeManagement(ctx context.Context) string {
	if c.config.ManagementURL == "" {
		return managementAbsent
	}
	client, err := emqx.New(
		c.config.ManagementURL,
		c.config.ManagementKey,
		c.config.ManagementSecret,
		c.config.DialTimeout,
	)
	if err != nil {
		return managementUnreachable
	}

	probeCtx, cancel := context.WithTimeout(ctx, c.config.DialTimeout)
	defer cancel()
	switch err := client.Status(probeCtx); {
	case err == nil:
		c.emqx = client
		return ""
	case errors.Is(err, emqx.ErrUnauthorised):
		return managementCredentials
	case errors.Is(err, emqx.ErrNotFound):
		// Something answered and it was not this API. A Mosquitto behind a
		// reverse proxy lands here, and so does an address off by a port.
		return managementUnknown
	default:
		return managementUnreachable
	}
}

func clientConnectionOf(client emqx.ClientInfo) *model.ClientConnection {
	connection := &model.ClientConnection{
		// The client id is both, because in MQTT they are one thing: it is
		// what the application called itself and what a close request names.
		Name:       client.ClientID,
		ClientName: client.ClientID,
		Node:       client.Node,
		PeerHost:   client.IPAddress,
		PeerPort:   client.Port,
		Protocol:   protocolName(client),
		State:      connectionState(client),
		// MQTT has no multiplexed sessions inside a connection.
		Channels:     0,
		HeartbeatSec: client.Keepalive,
		RecvBytes:    client.RecvOct,
		SendBytes:    client.SendOct,
		// EMQX reports totals rather than rates, and a rate derived from two
		// polls here would be this app's arithmetic presented as the broker's
		// figure.
		RecvByteRate:  0,
		SendByteRate:  0,
		ConnectedAtMs: millisOf(client.ConnectedAt),
		Attributes: map[string]string{
			AttrCleanStart:       strconv.FormatBool(client.CleanStart),
			AttrSessionExpiry:    strconv.FormatInt(client.ExpiryInterval, 10),
			AttrSubscriptionsCnt: strconv.Itoa(client.SubscriptionsCnt),
			AttrInflight:         strconv.Itoa(client.InflightCnt),
			AttrQueued:           strconv.Itoa(client.MqueueLen),
			AttrQueueDropped:     strconv.FormatInt(client.MqueueDropped, 10),
			AttrListener:         client.Listener,
			AttrDurable:          strconv.FormatBool(client.Durable || client.IsPersistent),
		},
	}
	if client.Username != nil {
		connection.User = *client.Username
	}
	if client.DisconnectedAt != "" {
		connection.Attributes[AttrDisconnectedAt] = client.DisconnectedAt
	}
	return connection
}

func clientSubscriptionsOf(subscriptions []emqx.Subscription) []*ClientSubscription {
	converted := make([]*ClientSubscription, 0, len(subscriptions))
	for _, subscription := range subscriptions {
		converted = append(converted, &ClientSubscription{
			ClientID:          subscription.ClientID,
			Node:              subscription.Node,
			Topic:             subscription.Topic,
			QoS:               subscription.QoS,
			NoLocal:           subscription.NoLocal == 1,
			RetainAsPublished: subscription.RetainAsPublished == 1,
			RetainHandling:    subscription.RetainHandling,
			Durable:           subscription.Durable,
		})
	}
	return converted
}

// protocolName spells the wire version, which EMQX reports as the number the
// CONNECT packet carries rather than as a name.
func protocolName(client emqx.ClientInfo) string {
	name := client.ProtoName
	if name == "" {
		name = "MQTT"
	}
	switch client.ProtoVer {
	case 3:
		return name + " 3.1"
	case 4:
		return name + " 3.1.1"
	case 5:
		return name + " 5.0"
	default:
		return name
	}
}

// connectionState distinguishes a live connection from a session that outlived
// one. A persistent session with the client gone is the case worth seeing: it
// is still holding queued messages and still counts against the broker.
func connectionState(client emqx.ClientInfo) string {
	if client.Connected {
		return "connected"
	}
	return "disconnected"
}

func millisOf(timestamp string) int64 {
	if timestamp == "" {
		return 0
	}
	parsed, err := time.Parse(time.RFC3339, timestamp)
	if err != nil {
		return 0
	}
	return parsed.UnixMilli()
}

// The reasons the management tier reports when it cannot be read.
const (
	// managementAbsent is a profile that names no management endpoint. It is
	// the common case rather than a fault: Mosquitto has no such API to name.
	managementAbsent = "mq.mqtt.degraded.managementAbsent"
	// managementUnreachable is an endpoint that was named and did not answer.
	managementUnreachable = "mq.mqtt.degraded.managementUnreachable"
	// managementCredentials is an API key the broker refused. Fixed on this
	// form, unlike the two above.
	managementCredentials = "mq.mqtt.degraded.managementCredentials"
	// managementUnknown is something answering that is not this API - an
	// address off by a port, or a proxy in front of a broker that has none.
	managementUnknown = "mq.mqtt.degraded.managementUnknown"
)
