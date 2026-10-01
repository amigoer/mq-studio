package toolset

import (
	"context"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

type namespacesOutput struct {
	Namespaces []*model.Namespace `json:"namespaces"`
	Caveat     string             `json:"caveat,omitempty"`
}

// listNamespaces goes to the port: the three families that list namespaces
// each do it on a service of their own, and there is no neutral one to call.
func (e *Env) listNamespaces(ctx context.Context, input connectionInput) (namespacesOutput, error) {
	api, caveat, err := port[driver.NamespaceAdmin](e, input.Connection, model.CapNamespaceList)
	if err != nil {
		return namespacesOutput{}, err
	}
	ctx, cancel := e.withTimeout(ctx)
	defer cancel()

	namespaces, err := api.ListNamespaces(ctx)
	if err != nil {
		return namespacesOutput{}, err
	}
	return namespacesOutput{Namespaces: namespaces, Caveat: caveat}, nil
}

type routingInput struct {
	Connection int    `json:"connection" jsonschema:"the connection id"`
	Namespace  string `json:"namespace,omitempty" jsonschema:"the namespace to read, for a family that keeps routing apart by one"`
}

type exchangesOutput struct {
	Exchanges []*model.Destination `json:"exchanges"`
	Caveat    string               `json:"caveat,omitempty"`
}

func (e *Env) listExchanges(ctx context.Context, input routingInput) (exchangesOutput, error) {
	conn, caveat, err := e.capable(input.Connection, model.CapRouting)
	if err != nil {
		return exchangesOutput{}, err
	}
	ctx, cancel := e.withTimeout(ctx)
	defer cancel()

	exchanges, err := e.Services.Routing.Exchanges(ctx, input.Connection, input.Namespace)
	if err != nil {
		return exchangesOutput{}, err
	}
	answered := make([]string, 0, len(exchanges))
	for _, exchange := range exchanges {
		answered = append(answered, exchange.Ref.Namespace)
	}
	if err := consulted(conn.Kind(), input.Namespace, answered...); err != nil {
		return exchangesOutput{}, err
	}
	return exchangesOutput{Exchanges: exchanges, Caveat: caveat}, nil
}

type bindingsOutput struct {
	Bindings []*model.Binding `json:"bindings"`
	Caveat   string           `json:"caveat,omitempty"`
}

func (e *Env) listBindings(ctx context.Context, input routingInput) (bindingsOutput, error) {
	conn, caveat, err := e.capable(input.Connection, model.CapRouting)
	if err != nil {
		return bindingsOutput{}, err
	}
	ctx, cancel := e.withTimeout(ctx)
	defer cancel()

	bindings, err := e.Services.Routing.Bindings(ctx, input.Connection, input.Namespace)
	if err != nil {
		return bindingsOutput{}, err
	}
	answered := make([]string, 0, len(bindings))
	for _, binding := range bindings {
		answered = append(answered, binding.Namespace)
	}
	if err := consulted(conn.Kind(), input.Namespace, answered...); err != nil {
		return bindingsOutput{}, err
	}
	return bindingsOutput{Bindings: bindings, Caveat: caveat}, nil
}

type partitionsOutput struct {
	// Stats is the family's own shape, passed through for the reason lagOutput
	// passes its through: a Kafka partition, a RocketMQ queue and a NATS
	// subject report different figures, and a common shape would invent some.
	Stats  map[string]any `json:"stats"`
	Caveat string         `json:"caveat,omitempty"`
}

func (e *Env) destinationPartitions(ctx context.Context, input destinationDetailInput) (partitionsOutput, error) {
	conn, caveat, err := e.capable(input.Connection, model.CapPartitions)
	if err != nil {
		return partitionsOutput{}, err
	}
	ctx, cancel := e.withTimeout(ctx)
	defer cancel()

	// The figures carry no ref to show where they were read from, so the
	// namespace is confirmed first, the way a destructive call confirms it.
	ref := model.DestinationRef{Namespace: input.Namespace, Name: input.Name}
	if err := e.resolvedIn(ctx, input.Connection, conn.Kind(), ref); err != nil {
		return partitionsOutput{}, err
	}
	stats, err := e.Services.Topics.Stats(ctx, input.Connection, ref)
	if err != nil {
		return partitionsOutput{}, err
	}
	return partitionsOutput{Stats: stats, Caveat: caveat}, nil
}

/*
 * The two objects the canonical pages had no room for.
 *
 * A Kinesis shard is not a partition number and an IBM MQ channel is not a
 * destination, so each family got a port and a page of its own - and here a
 * tool of its own, offered only where the capability is. The tools that are
 * the same everywhere stay one tool across every family; these are what that
 * leaves over, not a second way to list the same thing.
 */

type shardsInput struct {
	Connection  int    `json:"connection" jsonschema:"the connection id"`
	Destination string `json:"destination" jsonschema:"the stream whose shards to list"`
}

type shardsOutput struct {
	Shards []*model.Shard `json:"shards"`
	Caveat string         `json:"caveat,omitempty"`
}

func (e *Env) destinationShards(ctx context.Context, input shardsInput) (shardsOutput, error) {
	api, caveat, err := port[driver.ShardInspector](e, input.Connection, model.CapShards)
	if err != nil {
		return shardsOutput{}, err
	}
	ctx, cancel := e.withTimeout(ctx)
	defer cancel()

	shards, err := api.ListShards(ctx, model.DestinationRef{Name: input.Destination})
	if err != nil {
		return shardsOutput{}, err
	}
	return shardsOutput{Shards: shards, Caveat: caveat}, nil
}

type channelsOutput struct {
	Channels []*model.Channel `json:"channels"`
	Caveat   string           `json:"caveat,omitempty"`
}

func (e *Env) listChannels(ctx context.Context, input connectionInput) (channelsOutput, error) {
	api, caveat, err := port[driver.ChannelInspector](e, input.Connection, model.CapChannels)
	if err != nil {
		return channelsOutput{}, err
	}
	ctx, cancel := e.withTimeout(ctx)
	defer cancel()

	channels, err := api.ListChannels(ctx)
	if err != nil {
		return channelsOutput{}, err
	}
	return channelsOutput{Channels: channels, Caveat: caveat}, nil
}
