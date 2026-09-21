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

/*
 * tools is every operation this server can perform, keyed by its catalogue id.
 *
 * What is NOT here is as deliberate as what is. The blast radius, and with it
 * whether a tool is offered at all and what its annotations say, comes from
 * the catalogue: two descriptions of how much damage one call can do would
 * eventually disagree, and the one a client reads would be this one.
 *
 * The catalogue has 124 operations and this has a fraction of them. An
 * operation with no tool is a fact about this server rather than about the
 * endpoint, which is why capabilities_describe reports the two differently.
 */
var tools = map[string]toolInfo{
	"destination.list": {
		name:        "destinations_list",
		title:       "List destinations",
		description: "List the topics, queues or streams a connection holds.",
	},
	"destination.detail": {
		name:  "destination_detail",
		title: "Read a destination",
		description: "Read one destination's configuration and figures, including the attributes " +
			"only its own family has.",
	},
	"subscription.list": {
		name:  "subscriptions_list",
		title: "List subscriptions",
		description: "List the consumer groups or subscriptions on a connection, with their " +
			"backlog where the family reports one.",
	},
	"message.query": {
		name:  "messages_browse",
		title: "Browse messages",
		description: "Browse stored messages on a destination. Whether reading takes a message " +
			"away is the family's doing: when it does, the result says so in its caveat.",
	},
	"cluster.nodes": {
		name:        "cluster_topology",
		title:       "Read the cluster",
		description: "Read the brokers a connection's cluster is made of, and their aggregate figures.",
	},

	"destination.create": {
		name:  "destination_create",
		title: "Create a destination",
		description: "Create a topic, queue or stream. The settings a family accepts differ, and " +
			"capabilities_describe lists them for this connection - send them in attributes.",
	},
	"message.send": {
		name:  "message_publish",
		title: "Publish a message",
		description: "Publish a message. What it costs is whatever the consumers do with it, " +
			"which is not something this application can see.",
	},
	"message.resend": {
		name:  "message_resend",
		title: "Resend a dead letter",
		description: "Put a dead-lettered message back on the retry path for whichever member of " +
			"the group picks it up.",
	},
	"subscription.resetOffset": {
		name:  "subscription_reset_offset",
		title: "Move a read position",
		description: "Move a subscription's read position to a moment in time. Nothing is deleted, " +
			"but a forward move skips everything between and a backward one redelivers it.",
	},

	"destination.purge": {
		name:  "destination_purge",
		title: "Empty a destination",
		description: "Discard everything a destination is holding, keeping the destination itself. " +
			"There is no undo and the messages are not somewhere else.",
	},
	"destination.delete": {
		name:        "destination_delete",
		title:       "Delete a destination",
		description: "Delete a destination and everything it holds. There is no undo.",
	},
}

// toolInfo is how one catalogue operation is presented.
type toolInfo struct {
	name        string
	title       string
	description string
}

// offer builds the tool for an operation, or reports that the allowance does
// not reach it.
func offer(operationID string, allow catalog.Blast) (*mcp.Tool, bool) {
	info, present := tools[operationID]
	if !present {
		return nil, false
	}
	operation, known := catalog.Find(operationID)
	if !known || !catalog.Permits(allow, operation.Blast) {
		return nil, false
	}
	return &mcp.Tool{
		Name:        info.name,
		Description: info.description,
		Annotations: annotate(info.title, operation.Blast),
	}, true
}

func (s *server) register(server *mcp.Server, allow catalog.Blast) {
	// The two that are about this installation rather than about a broker.
	// Neither reaches a driver, so neither has a catalogue operation, and both
	// are always offered: a caller that cannot list the connections cannot use
	// any of the rest.
	mcp.AddTool(server, &mcp.Tool{
		Name: "connections_list",
		Description: "List the broker connections this installation has stored, with the family " +
			"each speaks. Start here: every other tool takes one of these ids.",
		Annotations: annotate("List connections", catalog.BlastRead),
	}, s.listConnections)

	mcp.AddTool(server, &mcp.Tool{
		Name: "capabilities_describe",
		Description: "Describe what one connection can actually do: the operations available on " +
			"it, the ones its family has but this endpoint does not, the consequences attached " +
			"to the ones that work, and the settings this family accepts where an operation " +
			"takes them. Call this before working a connection you have not seen.",
		Annotations: annotate("Describe a connection", catalog.BlastRead),
	}, s.describeCapabilities)

	if tool, ok := offer("destination.list", allow); ok {
		mcp.AddTool(server, tool, s.listDestinations)
	}
	if tool, ok := offer("destination.detail", allow); ok {
		mcp.AddTool(server, tool, s.destinationDetail)
	}
	if tool, ok := offer("subscription.list", allow); ok {
		mcp.AddTool(server, tool, s.listSubscriptions)
	}
	if tool, ok := offer("message.query", allow); ok {
		mcp.AddTool(server, tool, s.browseMessages)
	}
	if tool, ok := offer("cluster.nodes", allow); ok {
		mcp.AddTool(server, tool, s.clusterTopology)
	}

	if tool, ok := offer("destination.create", allow); ok {
		mcp.AddTool(server, tool, s.createDestination)
	}
	if tool, ok := offer("message.send", allow); ok {
		mcp.AddTool(server, tool, s.publishMessage)
	}
	if tool, ok := offer("message.resend", allow); ok {
		mcp.AddTool(server, tool, s.resendMessage)
	}
	if tool, ok := offer("subscription.resetOffset", allow); ok {
		mcp.AddTool(server, tool, s.resetOffset)
	}

	if tool, ok := offer("destination.purge", allow); ok {
		mcp.AddTool(server, tool, s.purgeDestination)
	}
	if tool, ok := offer("destination.delete", allow); ok {
		mcp.AddTool(server, tool, s.deleteDestination)
	}
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
	// Tool names the tool that performs it, and is empty for an operation no
	// tool reaches - either because this server has none, or because the
	// allowance it was started with does not extend that far. Either way the
	// endpoint can do it and this caller cannot, which is not the same as the
	// endpoint being unable to.
	Tool string `json:"tool,omitempty"`
	// Attributes are the family settings this operation accepts here, for a
	// write that carries them. They are the one part of a request a caller
	// cannot discover from the tool's own schema.
	Attributes []attributeSummary `json:"attributes,omitempty"`
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
			ID:         operation.ID,
			Blast:      string(operation.Blast),
			Summary:    operation.Summary,
			Caveat:     operation.Caveat,
			Tool:       s.offered[operation.ID],
			Attributes: describeAttributes(conn.Kind(), operation.ID),
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
