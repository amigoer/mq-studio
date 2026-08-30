package rabbitmq

import (
	"context"
	"fmt"
	"strconv"

	"github.com/amigoer/mq-studio/internal/model"
)

// Attribute keys this driver puts on an exchange, which travels as a
// Destination because an exchange is something messages are published to.
const (
	AttrExchangeType = "exchangeType"
	AttrInternal     = "internal"
)

// ListExchanges returns the exchanges in a vhost.
//
// An exchange is a Destination rather than a type of its own: it is named,
// it is published to, and it has a rate. What it does not have is a depth,
// which is why that field carries the unknown sentinel instead of zero.
func (c *Conn) ListExchanges(ctx context.Context, namespace string) ([]*model.Destination, error) {
	exchanges, err := c.client.ListExchangesIn(c.vhostOr(namespace))
	if err != nil {
		return nil, fmt.Errorf("list exchanges: %w", err)
	}

	destinations := make([]*model.Destination, 0, len(exchanges))
	for i := range exchanges {
		exchange := exchanges[i]
		rateIn := 0
		if exchange.MessageStats != nil {
			rateIn = int(exchange.MessageStats.PublishIn)
		}
		destinations = append(destinations, &model.Destination{
			Ref:         model.DestinationRef{Namespace: exchange.Vhost, Name: exchange.Name},
			Partitions:  model.UnknownMetric,
			Subscribers: model.UnknownMetric,
			// An exchange holds nothing; it routes. Zero would read as an
			// empty queue rather than as "not a thing that has a depth".
			Depth:  model.UnknownMetric,
			RateIn: rateIn,
			Attributes: map[string]string{
				AttrExchangeType: exchange.Type,
				AttrDurable:      strconv.FormatBool(exchange.Durable),
				AttrAutoDelete:   strconv.FormatBool(bool(exchange.AutoDelete)),
				AttrInternal:     strconv.FormatBool(exchange.Internal),
			},
		})
	}
	return destinations, nil
}

// ListBindings returns the routes in a vhost.
func (c *Conn) ListBindings(ctx context.Context, namespace string) ([]*model.Binding, error) {
	found, err := c.client.ListBindingsIn(c.vhostOr(namespace))
	if err != nil {
		return nil, fmt.Errorf("list bindings: %w", err)
	}

	bindings := make([]*model.Binding, 0, len(found))
	for i, binding := range found {
		arguments := make(map[string]string, len(binding.Arguments))
		for key, value := range binding.Arguments {
			arguments[key] = fmt.Sprint(value)
		}
		bindings = append(bindings, &model.Binding{
			ID:              i + 1,
			Namespace:       binding.Vhost,
			Source:          binding.Source,
			Destination:     binding.Destination,
			DestinationKind: binding.DestinationType,
			RoutingKey:      binding.RoutingKey,
			Arguments:       arguments,
		})
	}
	return bindings, nil
}
