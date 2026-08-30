package rabbitmq

import (
	"context"
	"fmt"

	rabbithole "github.com/michaelklishin/rabbit-hole/v3"

	"github.com/amigoer/mq-studio/internal/model"
)

// Census reads the broker's own running totals.
//
// One request answers the whole overview header, which is the point: walking
// every queue to add up what /api/overview already knows would be slower and
// would produce a figure that was never true at any single moment.
func (c *Conn) Census(ctx context.Context) (*model.BrokerCensus, error) {
	overview, err := c.overview(ctx)
	if err != nil {
		return nil, fmt.Errorf("overview: %w", err)
	}

	// The cluster name is its own endpoint. Overview carries the node that
	// answered, which is not the same thing on a cluster of three.
	name, err := call(ctx, c.mgmt, func(client *rabbithole.Client) (*rabbithole.ClusterName, error) {
		return client.GetClusterName()
	})
	if err != nil {
		return nil, fmt.Errorf("cluster name: %w", err)
	}

	stats := overview.MessageStats
	return &model.BrokerCensus{
		ClusterName:    name.Name,
		Version:        overview.RabbitMQVersion,
		RuntimeVersion: overview.ErlangVersion,

		Queues:      overview.ObjectTotals.Queues,
		Exchanges:   overview.ObjectTotals.Exchanges,
		Connections: overview.ObjectTotals.Connections,
		Channels:    overview.ObjectTotals.Channels,
		Consumers:   overview.ObjectTotals.Consumers,

		Ready:          int64(overview.QueueTotals.MessagesReady),
		Unacknowledged: int64(overview.QueueTotals.MessagesUnacknowledged),
		Total:          int64(overview.QueueTotals.Messages),

		Rates: model.BrokerRates{
			Publish: float64(stats.PublishDetails.Rate),
			// deliver_get, not deliver: it counts what consumers took by
			// either route, and a queue read with basic.get is still a
			// message leaving the broker.
			Deliver:    float64(stats.DeliverGetDetails.Rate),
			Ack:        float64(stats.AckDetails.Rate),
			Redeliver:  float64(stats.RedeliverDetails.Rate),
			Unroutable: float64(stats.ReturnUnroutableDetails.Rate + stats.DropUnroutableDetails.Rate),
		},
	}, nil
}
