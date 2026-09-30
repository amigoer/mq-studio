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

	"message.dlq": {
		name:  "messages_dead_letters",
		title: "Read dead letters",
		description: "Read what a consumer group gave up on. Start here when a message never " +
			"arrived and the destination looks healthy.",
	},
	"message.retryQueue": {
		name:  "messages_retry_queue",
		title: "Read the retry backlog",
		description: "Read what is being retried but has not been given up on yet. A message " +
			"here is still going to be delivered; one in the dead letters is not.",
	},
	"message.deadLetterQueues": {
		name:  "dead_letter_queues",
		title: "Find dead-letter queues",
		description: "Find the queues dead letters land in by following the topology, for a " +
			"family where a dead-letter queue is a convention rather than an object. Reading " +
			"one afterwards is an ordinary browse.",
	},

	"subscription.lag": {
		name:  "subscription_lag",
		title: "Read consume progress",
		description: "Read one subscription's progress per partition. The subscription listing " +
			"gives a total; this says whether the backlog is spread or sitting on one partition, " +
			"which are different problems.",
	},
	"subscription.clients": {
		name:  "subscription_consumers",
		title: "Ask the consumers",
		description: "Ask the connected consumers what they are doing. A subscription with " +
			"nothing connected has no answer rather than an empty one, which is itself the " +
			"answer when a backlog is not moving.",
	},
	"subscription.pendingSummary": {
		name:  "subscription_pending_summary",
		title: "Summarise unacknowledged work",
		description: "Summarise what a group has been handed and not acknowledged: how much is " +
			"owed, and for how long. For a family that moves nothing and gives up on nothing.",
	},
	"subscription.pendingEntries": {
		name:  "subscription_pending_entries",
		title: "List unacknowledged work",
		description: "List the unacknowledged deliveries themselves, with who is holding each " +
			"and how long they have had it. Narrow by idle time to find the ones worth acting on.",
	},
	"subscription.groupConsumers": {
		name:  "subscription_group_consumers",
		title: "List a group's consumers",
		description: "List a group's consumers and what each is owed - who is holding what, at " +
			"the grain the pending list uses.",
	},

	"message.byId": {
		name:  "message_by_id",
		title: "Read one message",
		description: "Read one message by the id its family identifies messages with, as " +
			"messages_browse reports it. Start here when someone can name the message in question.",
	},
	"namespace.list": {
		name:  "namespaces_list",
		title: "List namespaces",
		description: "List the namespaces a broker keeps as objects of their own - RabbitMQ virtual " +
			"hosts, Pulsar namespaces, NATS accounts - with what each holds. Where a family keeps " +
			"destinations apart by them, these are what the namespace argument of the other tools " +
			"takes; where it does not, that argument is refused rather than ignored.",
	},
	"routing.exchanges": {
		name:  "routing_exchanges",
		title: "List exchanges",
		description: "List what routes messages rather than holding them: RabbitMQ exchanges, " +
			"Service Bus topics, Solace topic endpoints. With routing_bindings, this is how to find " +
			"why a message went where it did, or nowhere.",
	},
	"routing.bindings": {
		name:  "routing_bindings",
		title: "List bindings",
		description: "List the routes from what routes to what receives, with the key and arguments " +
			"that decide a match: RabbitMQ bindings, Service Bus subscription rules, Solace queue " +
			"subscriptions. A message nothing matches reaches no queue at all.",
	},
	"destination.partitions": {
		name:  "destination_partitions",
		title: "Read partitions",
		description: "Read how one destination is divided and what each part holds - Kafka and " +
			"Pulsar partitions, RocketMQ queues, NATS subjects. Totals hide a backlog piled on one " +
			"part, and on Kafka a partition whose replicas have fallen out of sync.",
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

func (s *server) register(server *mcp.Server) {
	// The two that are about this installation rather than about a broker.
	// Neither reaches a driver, so neither has a catalogue operation, and both
	// are always offered: a caller that cannot list the connections cannot use
	// any of the rest.
	addTool(server, &mcp.Tool{
		Name: "connections_list",
		Description: "List the broker connections this installation has stored, with the family " +
			"each speaks and how far this server may go on each. Start here: every other tool " +
			"takes one of these ids.",
		Annotations: annotate("List connections", catalog.BlastRead),
	}, s.listConnections)

	addTool(server, &mcp.Tool{
		Name: "capabilities_describe",
		Description: "Describe what one connection can actually do: the operations available on " +
			"it, the ones its family has but this endpoint does not, the consequences attached " +
			"to the ones that work, and the settings this family accepts where an operation " +
			"takes them. Call this before working a connection you have not seen.",
		Annotations: annotate("Describe a connection", catalog.BlastRead),
	}, s.describeCapabilities)

	provide(s, server, "destination.list", s.listDestinations)
	provide(s, server, "destination.detail", s.destinationDetail)
	provide(s, server, "subscription.list", s.listSubscriptions)
	provide(s, server, "message.query", s.browseMessages)
	provide(s, server, "cluster.nodes", s.clusterTopology)
	provide(s, server, "message.dlq", s.deadLetters)
	provide(s, server, "message.retryQueue", s.retryQueue)
	provide(s, server, "message.deadLetterQueues", s.deadLetterQueues)
	provide(s, server, "subscription.lag", s.subscriptionLag)
	provide(s, server, "subscription.clients", s.subscriptionConsumers)
	provide(s, server, "subscription.pendingSummary", s.pendingSummary)
	provide(s, server, "subscription.pendingEntries", s.pendingEntries)
	provide(s, server, "subscription.groupConsumers", s.groupConsumers)
	provide(s, server, "message.byId", s.messageByID)
	provide(s, server, "namespace.list", s.listNamespaces)
	provide(s, server, "routing.exchanges", s.listExchanges)
	provide(s, server, "routing.bindings", s.listBindings)
	provide(s, server, "destination.partitions", s.destinationPartitions)

	provide(s, server, "destination.create", s.createDestination)
	provide(s, server, "message.send", s.publishMessage)
	provide(s, server, "message.resend", s.resendMessage)
	provide(s, server, "subscription.resetOffset", s.resetOffset)

	provide(s, server, "destination.purge", s.purgeDestination)
	provide(s, server, "destination.delete", s.deleteDestination)
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
	Allow     string `json:"allow" jsonschema:"how far this server may go on this connection: read, mutate or destructive"`
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
		allow, _ := s.ceiling(profile.ID)
		summaries = append(summaries, connectionSummary{
			ID:        profile.ID,
			Name:      profile.Name,
			Family:    string(profile.Kind),
			Endpoints: profile.Endpoints,
			Group:     profile.Group,
			Remark:    profile.Remark,
			Allow:     string(allow),
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
	// tool reaches - because this server has none, because the allowance it
	// was started with does not extend that far on this connection, or
	// because it destroys and this client cannot ask a person to confirm it.
	// Either way the endpoint can do it and this caller cannot, which is not
	// the same as the endpoint being unable to.
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
	Allow       string             `json:"allow" jsonschema:"how far this server may go on this connection: read, mutate or destructive"`
	Operations  []operationSummary `json:"operations"`
	Unavailable []absence          `json:"unavailable,omitempty"`
}

func (s *server) describeCapabilities(
	_ context.Context, request *mcp.CallToolRequest, input connectionInput,
) (*mcp.CallToolResult, describeOutput, error) {
	conn, err := s.conn(input.Connection)
	if err != nil {
		return nil, describeOutput{}, err
	}

	allow, _ := s.ceiling(input.Connection)
	confirms := canConfirm(request)
	resolved := catalog.For(conn)
	operations := make([]operationSummary, 0, len(resolved))
	for _, operation := range resolved {
		tool := s.offered[operation.ID]
		if !catalog.Permits(allow, operation.Blast) ||
			(operation.Blast == catalog.BlastDestructive && !confirms) {
			tool = ""
		}
		operations = append(operations, operationSummary{
			ID:         operation.ID,
			Blast:      string(operation.Blast),
			Summary:    operation.Summary,
			Caveat:     s.say(operation.Caveat),
			Tool:       tool,
			Attributes: describeAttributes(conn.Kind(), operation.ID),
		})
	}

	capabilities := conn.Capabilities()
	unavailable := make([]absence, 0, len(capabilities.Degraded))
	for capability, reason := range capabilities.Degraded {
		unavailable = append(unavailable, absence{
			Capability: string(capability), Reason: s.say(reason)})
	}

	return nil, describeOutput{
		Family:      string(conn.Kind()),
		Allow:       string(allow),
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
	conn, caveat, err := s.capable(input.Connection, model.CapDestinationList)
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
	answered := make([]string, 0, len(destinations))
	for _, destination := range destinations {
		answered = append(answered, destination.Ref.Namespace)
	}
	if err := consulted(conn.Kind(), input.Namespace, answered...); err != nil {
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
	conn, caveat, err := s.capable(input.Connection, model.CapDestinationList)
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
	if destination != nil {
		if err := consulted(conn.Kind(), input.Namespace, destination.Ref.Namespace); err != nil {
			return nil, destinationDetailOutput{}, err
		}
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
