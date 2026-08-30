package rabbitmq

import (
	"context"
	"fmt"

	rabbithole "github.com/michaelklishin/rabbit-hole/v3"

	"github.com/amigoer/mq-studio/internal/model"
)

// ListClientConnections returns the transport connections open against the
// broker.
//
// Scoped to one virtual host, because that is how an operator thinks about it:
// a broker shared between teams has connections from all of them, and the
// question is nearly always about one application's own.
func (c *Conn) ListClientConnections(ctx context.Context, namespace string) ([]*model.ClientConnection, error) {
	vhost := c.vhostOr(namespace)
	found, err := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.ConnectionInfo, error) {
		return client.ListVhostConnections(vhost)
	})
	if err != nil {
		return nil, fmt.Errorf("list connections in %q: %w", vhost, err)
	}

	connections := make([]*model.ClientConnection, 0, len(found))
	for i := range found {
		connections = append(connections, connectionFrom(&found[i]))
	}
	return connections, nil
}

// ListClientChannels returns the channels multiplexed inside those
// connections.
func (c *Conn) ListClientChannels(ctx context.Context, namespace string) ([]*model.ClientChannel, error) {
	vhost := c.vhostOr(namespace)
	found, err := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.ChannelInfo, error) {
		return client.ListChannels()
	})
	if err != nil {
		return nil, fmt.Errorf("list channels: %w", err)
	}

	channels := make([]*model.ClientChannel, 0, len(found))
	for i := range found {
		// The broker has no per-vhost channel endpoint, so the filter is here.
		if found[i].Vhost != vhost {
			continue
		}
		channels = append(channels, channelFrom(&found[i]))
	}
	return channels, nil
}

func connectionFrom(connection *rabbithole.ConnectionInfo) *model.ClientConnection {
	// Most client libraries send no connection_name at all, which is why the
	// peer address stays the primary identifier and this is only a label.
	clientName := ""
	if raw, ok := connection.ClientProperties["connection_name"]; ok {
		clientName = fmt.Sprint(raw)
	}

	return &model.ClientConnection{
		Name:       connection.Name,
		ClientName: clientName,
		Namespace:  connection.Vhost,
		User:       connection.User,
		Node:       connection.Node,
		PeerHost:   connection.PeerHost,
		PeerPort:   int(connection.PeerPort),
		Protocol:   connection.Protocol,
		State:      connection.State,
		Channels:   connection.Channels,
		TLS:        connection.UsesTLS,
		Cipher:     connection.SSLCipher,
		// The broker reports the negotiated heartbeat as "timeout". Zero means
		// heartbeats are off, which is worth showing: a connection with none
		// can sit half-open through a partition and look healthy from both
		// ends.
		HeartbeatSec:  connection.Timeout,
		RecvBytes:     int64(connection.RecvOct),
		SendBytes:     int64(connection.SendOct),
		RecvByteRate:  float64(connection.RecvOctDetails.Rate),
		SendByteRate:  float64(connection.SendOctDetails.Rate),
		ConnectedAtMs: int64(connection.ConnectedAt),
		BlockedBy:     connection.LastBlockedBy,
	}
}

func channelFrom(channel *rabbithole.ChannelInfo) *model.ClientChannel {
	return &model.ClientChannel{
		Name:           channel.Name,
		Number:         channel.Number,
		Connection:     channel.ConnectionDetails.Name,
		Namespace:      channel.Vhost,
		User:           channel.User,
		Node:           channel.Node,
		Consumers:      channel.ConsumerCount,
		PrefetchCount:  channel.PrefetchCount,
		Unacknowledged: channel.UnacknowledgedMessageCount,
		Unconfirmed:    channel.UnconfirmedMessageCount,
		Confirms:       channel.UsesPublisherConfirms,
		Transactional:  channel.Transactional,
		FlowBlocked:    channel.ClientFlowBlocked,
		IdleSince:      channel.IdleSince,
	}
}
