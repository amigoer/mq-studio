package mcpserver

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

type namespacesOutput struct {
	Namespaces []*model.Namespace `json:"namespaces"`
	Caveat     string             `json:"caveat,omitempty"`
}

// listNamespaces goes to the port: the three families that list namespaces
// each do it on a service of their own, and there is no neutral one to call.
func (s *server) listNamespaces(
	ctx context.Context, _ *mcp.CallToolRequest, input connectionInput,
) (*mcp.CallToolResult, namespacesOutput, error) {
	api, caveat, err := port[driver.NamespaceAdmin](s, input.Connection, model.CapNamespaceList)
	if err != nil {
		return nil, namespacesOutput{}, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	namespaces, err := api.ListNamespaces(ctx)
	if err != nil {
		return nil, namespacesOutput{}, err
	}
	return nil, namespacesOutput{Namespaces: namespaces, Caveat: caveat}, nil
}

type routingInput struct {
	Connection int    `json:"connection" jsonschema:"the connection id"`
	Namespace  string `json:"namespace,omitempty" jsonschema:"the namespace to read, for a family that keeps routing apart by one"`
}

type exchangesOutput struct {
	Exchanges []*model.Destination `json:"exchanges"`
	Caveat    string               `json:"caveat,omitempty"`
}

func (s *server) listExchanges(
	ctx context.Context, _ *mcp.CallToolRequest, input routingInput,
) (*mcp.CallToolResult, exchangesOutput, error) {
	conn, caveat, err := s.capable(input.Connection, model.CapRouting)
	if err != nil {
		return nil, exchangesOutput{}, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	exchanges, err := s.services.Routing.Exchanges(ctx, input.Connection, input.Namespace)
	if err != nil {
		return nil, exchangesOutput{}, err
	}
	answered := make([]string, 0, len(exchanges))
	for _, exchange := range exchanges {
		answered = append(answered, exchange.Ref.Namespace)
	}
	if err := consulted(conn.Kind(), input.Namespace, answered...); err != nil {
		return nil, exchangesOutput{}, err
	}
	return nil, exchangesOutput{Exchanges: exchanges, Caveat: caveat}, nil
}

type bindingsOutput struct {
	Bindings []*model.Binding `json:"bindings"`
	Caveat   string           `json:"caveat,omitempty"`
}

func (s *server) listBindings(
	ctx context.Context, _ *mcp.CallToolRequest, input routingInput,
) (*mcp.CallToolResult, bindingsOutput, error) {
	conn, caveat, err := s.capable(input.Connection, model.CapRouting)
	if err != nil {
		return nil, bindingsOutput{}, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	bindings, err := s.services.Routing.Bindings(ctx, input.Connection, input.Namespace)
	if err != nil {
		return nil, bindingsOutput{}, err
	}
	answered := make([]string, 0, len(bindings))
	for _, binding := range bindings {
		answered = append(answered, binding.Namespace)
	}
	if err := consulted(conn.Kind(), input.Namespace, answered...); err != nil {
		return nil, bindingsOutput{}, err
	}
	return nil, bindingsOutput{Bindings: bindings, Caveat: caveat}, nil
}

type partitionsOutput struct {
	// Stats is the family's own shape, passed through for the reason lagOutput
	// passes its through: a Kafka partition, a RocketMQ queue and a NATS
	// subject report different figures, and a common shape would invent some.
	Stats  map[string]any `json:"stats"`
	Caveat string         `json:"caveat,omitempty"`
}

func (s *server) destinationPartitions(
	ctx context.Context, _ *mcp.CallToolRequest, input destinationDetailInput,
) (*mcp.CallToolResult, partitionsOutput, error) {
	conn, caveat, err := s.capable(input.Connection, model.CapPartitions)
	if err != nil {
		return nil, partitionsOutput{}, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	// The figures carry no ref to show where they were read from, so the
	// namespace is confirmed first, the way a destructive call confirms it.
	ref := model.DestinationRef{Namespace: input.Namespace, Name: input.Name}
	if err := s.resolvedIn(ctx, input.Connection, conn.Kind(), ref); err != nil {
		return nil, partitionsOutput{}, err
	}
	stats, err := s.services.Topics.Stats(ctx, input.Connection, ref)
	if err != nil {
		return nil, partitionsOutput{}, err
	}
	return nil, partitionsOutput{Stats: stats, Caveat: caveat}, nil
}
