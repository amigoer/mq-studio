package rabbitmq

import (
	"context"
	"fmt"
	"strconv"

	rabbithole "github.com/michaelklishin/rabbit-hole/v3"

	"github.com/amigoer/mq-studio/internal/model"
)

// Attribute keys this driver puts on an exchange, which travels as a
// Destination because an exchange is something messages are published to.
const (
	AttrExchangeType = "exchangeType"
	AttrInternal     = "internal"
)

// ArgAlternateExchange is where an exchange sends what it could not route.
// It is the difference between a message being dropped and being kept.
const ArgAlternateExchange = "alternate-exchange"

// ListExchanges returns the exchanges in a vhost.
//
// An exchange is a Destination rather than a type of its own: it is named,
// it is published to, and it has a rate. What it does not have is a depth,
// which is why that field carries the unknown sentinel instead of zero.
func (c *Conn) ListExchanges(ctx context.Context, namespace string) ([]*model.Destination, error) {
	exchanges, err := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.ExchangeInfo, error) {
		return client.ListExchangesIn(c.vhostOr(namespace))
	})
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
		rateOut := 0
		if exchange.MessageStats != nil {
			rateOut = int(exchange.MessageStats.PublishOut)
		}
		destinations = append(destinations, &model.Destination{
			Ref:         model.DestinationRef{Namespace: exchange.Vhost, Name: exchange.Name},
			Partitions:  model.UnknownMetric,
			Subscribers: model.UnknownMetric,
			// An exchange holds nothing; it routes. Zero would read as an
			// empty queue rather than as "not a thing that has a depth".
			Depth: model.UnknownMetric,
			// In is what was published to it, out is what it managed to route
			// on. The gap between them is messages that matched no binding,
			// which is the whole reason both are worth showing.
			RateIn:  rateIn,
			RateOut: rateOut,
			Attributes: map[string]string{
				AttrExchangeType: exchange.Type,
				AttrDurable:      strconv.FormatBool(exchange.Durable),
				AttrAutoDelete:   strconv.FormatBool(bool(exchange.AutoDelete)),
				AttrInternal:     strconv.FormatBool(exchange.Internal),
				AttrArguments:    encodeArguments(exchange.Arguments),
			},
		})
	}
	return destinations, nil
}

// ListBindings returns the routes in a vhost.
func (c *Conn) ListBindings(ctx context.Context, namespace string) ([]*model.Binding, error) {
	found, err := call(ctx, c.mgmt, func(client *rabbithole.Client) ([]rabbithole.BindingInfo, error) {
		return client.ListBindingsIn(c.vhostOr(namespace))
	})
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

// The default exchange has no name, and every queue is bound to it implicitly
// by its own name. It is worth naming rather than rendering as a blank cell,
// because a reader seeing an empty source has no way to know that is the
// answer rather than a bug.
const DefaultExchangeName = "amq.default"
