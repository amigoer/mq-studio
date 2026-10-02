package toolset

import (
	"context"

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

func (e *Env) clusterHealth(ctx context.Context, input connectionInput) (healthOutput, error) {
	api, caveat, err := port[driver.HealthInspector](e, input.Connection, model.CapClusterHealth)
	if err != nil {
		return healthOutput{}, err
	}
	ctx, cancel := e.withTimeout(ctx)
	defer cancel()

	health, err := api.Health(ctx)
	if err != nil {
		return healthOutput{}, err
	}
	return healthOutput{Health: health, Caveat: caveat}, nil
}

type clientConnectionsOutput struct {
	Connections []*model.ClientConnection `json:"connections"`
	Caveat      string                    `json:"caveat,omitempty"`
}

func (e *Env) clientConnections(ctx context.Context, input namespaceInput) (clientConnectionsOutput, error) {
	api, kind, caveat, err := portOf[driver.ClientInspector](e, input.Connection, model.CapClientInspect)
	if err != nil {
		return clientConnectionsOutput{}, err
	}
	ctx, cancel := e.withTimeout(ctx)
	defer cancel()

	connections, err := api.ListClientConnections(ctx, input.Namespace)
	if err != nil {
		return clientConnectionsOutput{}, err
	}
	answered := make([]string, 0, len(connections))
	for _, connection := range connections {
		answered = append(answered, connection.Namespace)
	}
	if err := consulted(kind, input.Namespace, answered...); err != nil {
		return clientConnectionsOutput{}, err
	}
	return clientConnectionsOutput{Connections: connections, Caveat: caveat}, nil
}

type clientChannelsOutput struct {
	Channels []*model.ClientChannel `json:"channels"`
	Caveat   string                 `json:"caveat,omitempty"`
}

func (e *Env) clientChannels(ctx context.Context, input namespaceInput) (clientChannelsOutput, error) {
	api, kind, caveat, err := portOf[driver.ClientInspector](e, input.Connection, model.CapClientInspect)
	if err != nil {
		return clientChannelsOutput{}, err
	}
	ctx, cancel := e.withTimeout(ctx)
	defer cancel()

	channels, err := api.ListClientChannels(ctx, input.Namespace)
	if err != nil {
		return clientChannelsOutput{}, err
	}
	answered := make([]string, 0, len(channels))
	for _, channel := range channels {
		answered = append(answered, channel.Namespace)
	}
	if err := consulted(kind, input.Namespace, answered...); err != nil {
		return clientChannelsOutput{}, err
	}
	return clientChannelsOutput{Channels: channels, Caveat: caveat}, nil
}
