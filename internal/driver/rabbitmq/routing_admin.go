package rabbitmq

import (
	"context"
	"fmt"
	"net/http"

	rabbithole "github.com/michaelklishin/rabbit-hole/v3"

	"github.com/amigoer/mq-studio/internal/model"
)

// DeclareExchange creates an exchange.
//
// Like a queue, an exchange is immutable once declared: re-declaring with a
// different type is an error rather than a change. There is no edit form for
// the same reason there is none for queues.
func (c *Conn) DeclareExchange(ctx context.Context, spec model.ExchangeSpec) error {
	settings := rabbithole.ExchangeSettings{
		Type: spec.Type,
		// Durable unless it was explicitly turned off, matching queues: a
		// transient exchange disappears on a restart and takes its bindings
		// with it, which is the unusual choice.
		Durable:    !spec.Transient,
		AutoDelete: spec.AutoDelete,
		Arguments:  decodeArguments(spec.Arguments),
	}
	// Internal is not offered. An internal exchange refuses publishes from
	// clients and exists only as a hop between exchanges, which is a topology
	// decision that belongs in whatever declares the rest of that topology.
	err := exec(ctx, c.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.DeclareExchange(c.vhostOr(spec.Namespace), spec.Name, settings)
	})
	if err != nil {
		return fmt.Errorf("declare exchange %q: %w", spec.Name, err)
	}
	return nil
}

// RemoveExchange deletes an exchange.
//
// Its bindings go with it, and anything still publishing to it starts getting
// errors. The broker does not warn about either, so the page has to.
func (c *Conn) RemoveExchange(ctx context.Context, namespace, name string) error {
	err := exec(ctx, c.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.DeleteExchange(c.vhostOr(namespace), name)
	})
	if err != nil {
		return fmt.Errorf("delete exchange %q: %w", name, err)
	}
	return nil
}

// DeclareBinding routes an exchange to a queue or to another exchange.
func (c *Conn) DeclareBinding(ctx context.Context, binding model.Binding) error {
	info := rabbithole.BindingInfo{
		Source:          binding.Source,
		Destination:     binding.Destination,
		DestinationType: binding.DestinationKind,
		RoutingKey:      binding.RoutingKey,
		Arguments:       bindingArguments(binding.Arguments),
	}
	err := exec(ctx, c.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.DeclareBinding(c.vhostOr(binding.Namespace), info)
	})
	if err != nil {
		return fmt.Errorf("bind %q to %q: %w", binding.Source, binding.Destination, err)
	}
	return nil
}

// RemoveBinding deletes one binding.
//
// It needs the broker's own properties key rather than the routing key,
// because a binding has no name and the same source, destination and key can
// exist more than once with different arguments. The key comes back with the
// listing; a caller that made one up would delete a different binding or none.
func (c *Conn) RemoveBinding(ctx context.Context, binding model.Binding) error {
	if binding.PropertiesKey == "" {
		return fmt.Errorf("removing a binding needs the properties key the broker listed it under")
	}
	info := rabbithole.BindingInfo{
		Source:          binding.Source,
		Destination:     binding.Destination,
		DestinationType: binding.DestinationKind,
		PropertiesKey:   binding.PropertiesKey,
	}
	err := exec(ctx, c.mgmt, func(client *rabbithole.Client) (*http.Response, error) {
		return client.DeleteBinding(c.vhostOr(binding.Namespace), info)
	})
	if err != nil {
		return fmt.Errorf("unbind %q from %q: %w", binding.Destination, binding.Source, err)
	}
	return nil
}

// bindingArguments turns the string map the bridge carries back into AMQP
// values.
//
// Header matching is the only thing that uses them, and x-match in particular
// has to arrive as the string "all" or "any" - which it already is, so this is
// a widening rather than a conversion.
func bindingArguments(arguments map[string]string) map[string]interface{} {
	if len(arguments) == 0 {
		return nil
	}
	widened := make(map[string]interface{}, len(arguments))
	for key, value := range arguments {
		widened[key] = value
	}
	return widened
}
