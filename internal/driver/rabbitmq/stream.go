package rabbitmq

import (
	"context"
	"fmt"

	rabbithole "github.com/michaelklishin/rabbit-hole/v3"

	"github.com/amigoer/mq-studio/internal/model"
)

// StreamClients returns who is reading and writing a stream.
//
// The stream protocol is not AMQP, and its clients appear on their own
// endpoints: a stream read by three applications over port 5552 reports zero
// consumers in /api/consumers. Without this the queue detail would say nobody
// is reading a stream that is being read constantly.
//
// The connection listing is read alongside, because a publisher record names
// its connection and nothing else about it - and which host and user is behind
// a client is the part an operator needs.
func (c *Conn) StreamClients(ctx context.Context, ref model.DestinationRef) (*model.StreamClients, error) {
	publishers, err := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.StreamPublisherInfo, error) {
		return client.ListStreamPublishersToStream(ref.Namespace, ref.Name)
	})
	if err != nil {
		return nil, fmt.Errorf("list stream publishers: %w", err)
	}

	// There is no per-stream endpoint for consumers, so the vhost's are read
	// and filtered here.
	consumers, err := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.StreamConsumerInfo, error) {
		return client.ListStreamConsumersIn(ref.Namespace)
	})
	if err != nil {
		return nil, fmt.Errorf("list stream consumers: %w", err)
	}

	peers := streamPeers(ctx, c)

	clients := &model.StreamClients{
		Publishers: make([]*model.StreamPublisher, 0, len(publishers)),
		Consumers:  make([]*model.StreamConsumer, 0),
	}
	for i := range publishers {
		publisher := &publishers[i]
		peer := peers[publisher.ConnectionName]
		clients.Publishers = append(clients.Publishers, &model.StreamPublisher{
			Reference:  publisher.Reference,
			Connection: publisher.ConnectionName,
			PeerHost:   peer.host,
			User:       peer.user,
			Node:       publisher.Node,
			Published:  int64(publisher.MessagesPublished),
			Confirmed:  int64(publisher.MessagesConfirmed),
			Errored:    int64(publisher.MessagesErrored),
		})
	}
	for i := range consumers {
		consumer := &consumers[i]
		if consumer.Stream != ref.Name {
			continue
		}
		peer := peers[consumer.ConnectionName]
		clients.Consumers = append(clients.Consumers, &model.StreamConsumer{
			Connection: consumer.ConnectionName,
			PeerHost:   peer.host,
			User:       peer.user,
			Node:       consumer.Node,
			Offset:     int64(consumer.Offset),
			Lag:        int64(consumer.OffsetLag),
			Consumed:   int64(consumer.MessagesConsumed),
			Credits:    consumer.Credits,
			Active:     consumer.Active,
		})
	}
	return clients, nil
}

type streamPeer struct{ host, user string }

// streamPeers maps a stream connection's name to the host and user behind it.
//
// Best effort: a failure here costs the peer column, not the page, so a broker
// that answers about publishers but not connections still reports who is
// publishing.
func streamPeers(ctx context.Context, c *Conn) map[string]streamPeer {
	peers := map[string]streamPeer{}
	connections, err := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.StreamConnectionInfo, error) {
		return client.ListStreamConnections()
	})
	if err != nil {
		return peers
	}
	for i := range connections {
		connection := &connections[i]
		peers[connection.Name] = streamPeer{
			host: fmt.Sprintf("%s:%d", connection.PeerHost, connection.PeerPort),
			user: connection.User,
		}
	}
	return peers
}

// hasStreamPlugin reports whether the broker can answer about stream clients.
//
// The stream protocol and its management endpoints are two separate plugins,
// and a broker with neither answers 404 - a deployment choice rather than a
// failure, so it degrades the capability instead of failing the connection.
func (c *Conn) hasStreamPlugin(ctx context.Context) error {
	_, err := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.StreamConnectionInfo, error) {
		return client.ListStreamConnections()
	})
	return err
}
