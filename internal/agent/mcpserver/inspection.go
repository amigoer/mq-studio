package mcpserver

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * The broker's view of itself and of who is talking to it.
 *
 * The inventory tools say what exists; these answer the two questions that
 * come before any of it when something has stopped - is the broker itself
 * well, and is the application that should be connected connected at all.
 * Each family answers them on a service of its own, so these go to the ports
 * the catalogue names, as the dead-letter tools do.
 */

type healthOutput struct {
	Health *model.BrokerHealth `json:"health"`
	Caveat string              `json:"caveat,omitempty"`
}

func (s *server) clusterHealth(
	ctx context.Context, _ *mcp.CallToolRequest, input connectionInput,
) (*mcp.CallToolResult, healthOutput, error) {
	api, caveat, err := port[driver.HealthInspector](s, input.Connection, model.CapClusterHealth)
	if err != nil {
		return nil, healthOutput{}, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	health, err := api.Health(ctx)
	if err != nil {
		return nil, healthOutput{}, err
	}
	return nil, healthOutput{Health: health, Caveat: caveat}, nil
}

type clientConnectionsOutput struct {
	Connections []*model.ClientConnection `json:"connections"`
	Caveat      string                    `json:"caveat,omitempty"`
}

func (s *server) clientConnections(
	ctx context.Context, _ *mcp.CallToolRequest, input namespaceInput,
) (*mcp.CallToolResult, clientConnectionsOutput, error) {
	api, kind, caveat, err := portOf[driver.ClientInspector](s, input.Connection, model.CapClientInspect)
	if err != nil {
		return nil, clientConnectionsOutput{}, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	connections, err := api.ListClientConnections(ctx, input.Namespace)
	if err != nil {
		return nil, clientConnectionsOutput{}, err
	}
	answered := make([]string, 0, len(connections))
	for _, connection := range connections {
		answered = append(answered, connection.Namespace)
	}
	if err := consulted(kind, input.Namespace, answered...); err != nil {
		return nil, clientConnectionsOutput{}, err
	}
	return nil, clientConnectionsOutput{Connections: connections, Caveat: caveat}, nil
}

type clientChannelsOutput struct {
	Channels []*model.ClientChannel `json:"channels"`
	Caveat   string                 `json:"caveat,omitempty"`
}

func (s *server) clientChannels(
	ctx context.Context, _ *mcp.CallToolRequest, input namespaceInput,
) (*mcp.CallToolResult, clientChannelsOutput, error) {
	api, kind, caveat, err := portOf[driver.ClientInspector](s, input.Connection, model.CapClientInspect)
	if err != nil {
		return nil, clientChannelsOutput{}, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	channels, err := api.ListClientChannels(ctx, input.Namespace)
	if err != nil {
		return nil, clientChannelsOutput{}, err
	}
	answered := make([]string, 0, len(channels))
	for _, channel := range channels {
		answered = append(answered, channel.Namespace)
	}
	if err := consulted(kind, input.Namespace, answered...); err != nil {
		return nil, clientChannelsOutput{}, err
	}
	return nil, clientChannelsOutput{Channels: channels, Caveat: caveat}, nil
}
