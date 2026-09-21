package mcpserver

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/amigoer/mq-studio/internal/agent/catalog"
	"github.com/amigoer/mq-studio/internal/model"
)

// connectionInput is what every tool but the listing takes.
type connectionInput struct {
	Connection int `json:"connection" jsonschema:"the connection id, as connections_list reports it"`
}

func (s *server) register(server *mcp.Server) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "connections_list",
		Description: "List the broker connections this installation has stored, with the family each speaks. Start here: every other tool takes one of these ids.",
		Annotations: readOnly("List connections"),
	}, s.listConnections)

	mcp.AddTool(server, &mcp.Tool{
		Name: "capabilities_describe",
		Description: "Describe what one connection can actually do: the operations available on it, " +
			"the ones its family has but this endpoint does not, and the consequences attached to " +
			"the ones that work. Call this before working a connection you have not seen - two " +
			"endpoints of the same family can answer differently, and it is only knowable once connected.",
		Annotations: readOnly("Describe a connection"),
	}, s.describeCapabilities)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "destinations_list",
		Description: "List the topics, queues or streams a connection holds.",
		Annotations: readOnly("List destinations"),
	}, s.listDestinations)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "destination_detail",
		Description: "Read one destination's configuration and figures, including the attributes only its own family has.",
		Annotations: readOnly("Read a destination"),
	}, s.destinationDetail)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "subscriptions_list",
		Description: "List the consumer groups or subscriptions on a connection, with their backlog where the family reports one.",
		Annotations: readOnly("List subscriptions"),
	}, s.listSubscriptions)

	mcp.AddTool(server, &mcp.Tool{
		Name: "messages_browse",
		Description: "Browse stored messages on a destination. Whether reading takes a message away " +
			"is the family's doing: when it does, the result says so in its caveat.",
		Annotations: readOnly("Browse messages"),
	}, s.browseMessages)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "cluster_topology",
		Description: "Read the brokers a connection's cluster is made of, and their aggregate figures.",
		Annotations: readOnly("Read the cluster"),
	}, s.clusterTopology)
}

// connectionSummary is a stored profile as a caller needs it.
//
// It is built field by field rather than handed out whole. A profile carries
// its secrets in memory, and the one thing this server must never do is put
// them in an answer - so nothing is copied here that was not chosen.
type connectionSummary struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	Family    string `json:"family"`
	Endpoints string `json:"endpoints,omitempty"`
	Group     string `json:"group,omitempty"`
	Remark    string `json:"remark,omitempty"`
}

type connectionsOutput struct {
	Connections []connectionSummary `json:"connections"`
}

func (s *server) listConnections(
	_ context.Context, _ *mcp.CallToolRequest, _ struct{},
) (*mcp.CallToolResult, connectionsOutput, error) {
	profiles := s.services.Connections.GetConnections()
	summaries := make([]connectionSummary, 0, len(profiles))
	for _, profile := range profiles {
		if profile == nil {
			continue
		}
		summaries = append(summaries, connectionSummary{
			ID:        profile.ID,
			Name:      profile.Name,
			Family:    string(profile.Kind),
			Endpoints: profile.Endpoints,
			Group:     profile.Group,
			Remark:    profile.Remark,
		})
	}
	return nil, connectionsOutput{Connections: summaries}, nil
}

// operationSummary is one thing a connection can be asked to do.
type operationSummary struct {
	ID      string `json:"id"`
	Blast   string `json:"blast"`
	Summary string `json:"summary"`
	Caveat  string `json:"caveat,omitempty"`
	// Tool names the tool that performs it, and is empty for an operation
	// this server does not expose yet. An empty one is not a missing feature:
	// the application can do it and this server is read-only.
	Tool string `json:"tool,omitempty"`
}

// absence is a capability the family has and this endpoint does not.
type absence struct {
	Capability string `json:"capability"`
	Reason     string `json:"reason"`
}

type describeOutput struct {
	Family      string             `json:"family"`
	Operations  []operationSummary `json:"operations"`
	Unavailable []absence          `json:"unavailable,omitempty"`
}

func (s *server) describeCapabilities(
	_ context.Context, _ *mcp.CallToolRequest, input connectionInput,
) (*mcp.CallToolResult, describeOutput, error) {
	conn, err := s.conn(input.Connection)
	if err != nil {
		return nil, describeOutput{}, err
	}

	resolved := catalog.For(conn)
	operations := make([]operationSummary, 0, len(resolved))
	for _, operation := range resolved {
		operations = append(operations, operationSummary{
			ID:      operation.ID,
			Blast:   string(operation.Blast),
			Summary: operation.Summary,
			Caveat:  operation.Caveat,
			Tool:    toolFor[operation.ID],
		})
	}

	capabilities := conn.Capabilities()
	unavailable := make([]absence, 0, len(capabilities.Degraded))
	for capability, reason := range capabilities.Degraded {
		unavailable = append(unavailable, absence{Capability: string(capability), Reason: reason})
	}

	return nil, describeOutput{
		Family:      string(conn.Kind()),
		Operations:  operations,
		Unavailable: unavailable,
	}, nil
}

// toolFor maps a catalogue operation to the tool that performs it.
//
// Only the read-only ones are here, which is the whole of this server today.
// The map is what lets capabilities_describe tell a caller the difference
// between an operation this endpoint cannot do and one it can do that no tool
// reaches yet - two very different things to be told.
var toolFor = map[string]string{
	"destination.list":   "destinations_list",
	"destination.detail": "destination_detail",
	"subscription.list":  "subscriptions_list",
	"message.query":      "messages_browse",
	"cluster.nodes":      "cluster_topology",
	"cluster.overview":   "cluster_topology",
}

type destinationsInput struct {
	Connection      int    `json:"connection" jsonschema:"the connection id"`
	Namespace       string `json:"namespace,omitempty" jsonschema:"narrow to one namespace, for a family that has them"`
	IncludeInternal bool   `json:"includeInternal,omitempty" jsonschema:"include the objects the family hides by default, such as Kafka's __consumer_offsets"`
}

type destinationsOutput struct {
	Destinations []*model.Destination `json:"destinations"`
	Caveat       string               `json:"caveat,omitempty"`
}

func (s *server) listDestinations(
	ctx context.Context, _ *mcp.CallToolRequest, input destinationsInput,
) (*mcp.CallToolResult, destinationsOutput, error) {
	_, caveat, err := s.capable(input.Connection, model.CapDestinationList)
	if err != nil {
		return nil, destinationsOutput{}, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	destinations, err := s.services.Topics.List(ctx, input.Connection, model.DestinationFilter{
		Namespace:       input.Namespace,
		IncludeInternal: input.IncludeInternal,
	})
	if err != nil {
		return nil, destinationsOutput{}, err
	}
	return nil, destinationsOutput{Destinations: destinations, Caveat: caveat}, nil
}

type destinationDetailInput struct {
	Connection int    `json:"connection" jsonschema:"the connection id"`
	Name       string `json:"name" jsonschema:"the destination name"`
	Namespace  string `json:"namespace,omitempty" jsonschema:"the namespace holding it, for a family that has them"`
}

type destinationDetailOutput struct {
	Destination *model.Destination `json:"destination"`
	Caveat      string             `json:"caveat,omitempty"`
}

func (s *server) destinationDetail(
	ctx context.Context, _ *mcp.CallToolRequest, input destinationDetailInput,
) (*mcp.CallToolResult, destinationDetailOutput, error) {
	_, caveat, err := s.capable(input.Connection, model.CapDestinationList)
	if err != nil {
		return nil, destinationDetailOutput{}, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	destination, err := s.services.Topics.Detail(ctx, input.Connection, model.DestinationRef{
		Namespace: input.Namespace,
		Name:      input.Name,
	})
	if err != nil {
		return nil, destinationDetailOutput{}, err
	}
	return nil, destinationDetailOutput{Destination: destination, Caveat: caveat}, nil
}

type subscriptionsOutput struct {
	Subscriptions []*model.Subscription `json:"subscriptions"`
	Caveat        string                `json:"caveat,omitempty"`
}

func (s *server) listSubscriptions(
	ctx context.Context, _ *mcp.CallToolRequest, input connectionInput,
) (*mcp.CallToolResult, subscriptionsOutput, error) {
	_, caveat, err := s.capable(input.Connection, model.CapSubscriptionList)
	if err != nil {
		return nil, subscriptionsOutput{}, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	subscriptions, err := s.services.Consumers.List(ctx, input.Connection)
	if err != nil {
		return nil, subscriptionsOutput{}, err
	}
	return nil, subscriptionsOutput{Subscriptions: subscriptions, Caveat: caveat}, nil
}

type browseInput struct {
	Connection  int    `json:"connection" jsonschema:"the connection id"`
	Destination string `json:"destination" jsonschema:"the destination to read from"`
	MaxResults  int    `json:"maxResults,omitempty" jsonschema:"how many to return at most; the application's own page size when omitted"`
	MessageKey  string `json:"messageKey,omitempty" jsonschema:"narrow to one message key, for a family that indexes by one"`
	StartTime   int64  `json:"startTime,omitempty" jsonschema:"earliest message time, in milliseconds since the epoch"`
	EndTime     int64  `json:"endTime,omitempty" jsonschema:"latest message time, in milliseconds since the epoch"`
}

type browseOutput struct {
	Messages []*model.MessageItem `json:"messages"`
	Caveat   string               `json:"caveat,omitempty"`
}

func (s *server) browseMessages(
	ctx context.Context, _ *mcp.CallToolRequest, input browseInput,
) (*mcp.CallToolResult, browseOutput, error) {
	_, caveat, err := s.capable(input.Connection, model.CapMessageQuery)
	if err != nil {
		return nil, browseOutput{}, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	maxResults := input.MaxResults
	if maxResults <= 0 {
		maxResults = s.services.Messages.FetchLimit()
	}
	messages, err := s.services.Messages.Query(ctx, input.Connection, model.MessageQueryParams{
		Topic:      input.Destination,
		MessageKey: input.MessageKey,
		StartTime:  input.StartTime,
		EndTime:    input.EndTime,
		MaxResults: maxResults,
	})
	if err != nil {
		return nil, browseOutput{}, err
	}
	return nil, browseOutput{Messages: messages, Caveat: caveat}, nil
}

type clusterOutput struct {
	Nodes    []*model.Node          `json:"nodes"`
	Overview *model.ClusterOverview `json:"overview,omitempty"`
	Caveat   string                 `json:"caveat,omitempty"`
}

func (s *server) clusterTopology(
	ctx context.Context, _ *mcp.CallToolRequest, input connectionInput,
) (*mcp.CallToolResult, clusterOutput, error) {
	_, caveat, err := s.capable(input.Connection, model.CapClusterTopology)
	if err != nil {
		return nil, clusterOutput{}, err
	}
	ctx, cancel := s.withTimeout(ctx)
	defer cancel()

	nodes, err := s.services.Cluster.GetBrokers(ctx, input.Connection)
	if err != nil {
		return nil, clusterOutput{}, err
	}

	// The overview is a second capability. A cluster that reports its topology
	// and no aggregate figures answers with the nodes rather than failing.
	output := clusterOutput{Nodes: nodes, Caveat: caveat}
	if conn, _, err := s.capable(input.Connection, model.CapClusterMetrics); err == nil && conn != nil {
		if overview, _, err := s.services.Cluster.Overview(ctx, input.Connection); err == nil {
			output.Overview = overview
		}
	}
	return nil, output, nil
}
