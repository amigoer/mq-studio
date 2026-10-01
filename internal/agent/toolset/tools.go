package toolset

import (
	"context"

	"github.com/amigoer/mq-studio/internal/agent/catalog"
	"github.com/amigoer/mq-studio/internal/model"
)

// connectionInput is what every tool but the listing takes.
type connectionInput struct {
	Connection int `json:"connection" jsonschema:"the connection id, as connections_list reports it"`
}

/*
 * definitions is every tool, in the order they are offered.
 *
 * What is NOT here is as deliberate as what is. The blast radius, and with it
 * whether a tool is offered at all and what a transport says it can do, comes
 * from the catalogue: two descriptions of how much damage one call can do
 * would eventually disagree, and the one a caller reads would be this one.
 *
 * The catalogue has 124 operations and this has a fraction of them. An
 * operation with no tool is a fact about the tools rather than about the
 * endpoint, which is why capabilities_describe reports the two differently.
 */
func definitions() []Tool {
	return []Tool{
		// The two that are about this installation rather than about a broker.
		// Neither reaches a driver, so neither has a catalogue operation, and
		// both are always offered: a caller that cannot list the connections
		// cannot use any of the rest.
		define("connections_list", "List connections", "",
			"List the broker connections this installation has stored, with the family "+
				"each speaks and how far the tools may go on each. Start here: every other tool "+
				"takes one of these ids.",
			(*Env).listConnections),
		define("capabilities_describe", "Describe a connection", "",
			"Describe what one connection can actually do: the operations available on "+
				"it, the ones its family has but this endpoint does not, the consequences attached "+
				"to the ones that work, and the settings this family accepts where an operation "+
				"takes them. Call this before working a connection you have not seen.",
			(*Env).describeCapabilities),

		define("destinations_list", "List destinations", "destination.list",
			"List the topics, queues or streams a connection holds.",
			(*Env).listDestinations),
		define("destination_detail", "Read a destination", "destination.detail",
			"Read one destination's configuration and figures, including the attributes "+
				"only its own family has.",
			(*Env).destinationDetail),
		define("subscriptions_list", "List subscriptions", "subscription.list",
			"List the consumer groups or subscriptions on a connection, with their "+
				"backlog where the family reports one.",
			(*Env).listSubscriptions),
		define("messages_browse", "Browse messages", "message.query",
			"Browse stored messages on a destination. Whether reading takes a message "+
				"away is the family's doing: when it does, the result says so in its caveat.",
			(*Env).browseMessages),
		define("cluster_topology", "Read the cluster", "cluster.nodes",
			"Read the brokers a connection's cluster is made of, and their aggregate figures.",
			(*Env).clusterTopology),

		define("messages_dead_letters", "Read dead letters", "message.dlq",
			"Read what a consumer group gave up on. Start here when a message never "+
				"arrived and the destination looks healthy.",
			(*Env).deadLetters),
		define("messages_retry_queue", "Read the retry backlog", "message.retryQueue",
			"Read what is being retried but has not been given up on yet. A message "+
				"here is still going to be delivered; one in the dead letters is not.",
			(*Env).retryQueue),
		define("dead_letter_queues", "Find dead-letter queues", "message.deadLetterQueues",
			"Find the queues dead letters land in by following the topology, for a "+
				"family where a dead-letter queue is a convention rather than an object. Reading "+
				"one afterwards is an ordinary browse.",
			(*Env).deadLetterQueues),

		define("subscription_lag", "Read consume progress", "subscription.lag",
			"Read one subscription's progress per partition. The subscription listing "+
				"gives a total; this says whether the backlog is spread or sitting on one partition, "+
				"which are different problems.",
			(*Env).subscriptionLag),
		define("subscription_consumers", "Ask the consumers", "subscription.clients",
			"Ask the connected consumers what they are doing. A subscription with "+
				"nothing connected has no answer rather than an empty one, which is itself the "+
				"answer when a backlog is not moving.",
			(*Env).subscriptionConsumers),
		define("subscription_pending_summary", "Summarise unacknowledged work", "subscription.pendingSummary",
			"Summarise what a group has been handed and not acknowledged: how much is "+
				"owed, and for how long. For a family that moves nothing and gives up on nothing.",
			(*Env).pendingSummary),
		define("subscription_pending_entries", "List unacknowledged work", "subscription.pendingEntries",
			"List the unacknowledged deliveries themselves, with who is holding each "+
				"and how long they have had it. Narrow by idle time to find the ones worth acting on.",
			(*Env).pendingEntries),
		define("subscription_group_consumers", "List a group's consumers", "subscription.groupConsumers",
			"List a group's consumers and what each is owed - who is holding what, at "+
				"the grain the pending list uses.",
			(*Env).groupConsumers),

		define("message_by_id", "Read one message", "message.byId",
			"Read one message by the id its family identifies messages with, as "+
				"messages_browse reports it. Start here when someone can name the message in question.",
			(*Env).messageByID),
		define("namespaces_list", "List namespaces", "namespace.list",
			"List the namespaces a broker keeps as objects of their own - RabbitMQ virtual "+
				"hosts, Pulsar namespaces, NATS accounts - with what each holds. Where a family keeps "+
				"destinations apart by them, these are what the namespace argument of the other tools "+
				"takes; where it does not, that argument is refused rather than ignored.",
			(*Env).listNamespaces),
		define("routing_exchanges", "List exchanges", "routing.exchanges",
			"List what routes messages rather than holding them: RabbitMQ exchanges, "+
				"Service Bus topics, Solace topic endpoints. With routing_bindings, this is how to find "+
				"why a message went where it did, or nowhere.",
			(*Env).listExchanges),
		define("routing_bindings", "List bindings", "routing.bindings",
			"List the routes from what routes to what receives, with the key and arguments "+
				"that decide a match: RabbitMQ bindings, Service Bus subscription rules, Solace queue "+
				"subscriptions. A message nothing matches reaches no queue at all.",
			(*Env).listBindings),
		define("destination_partitions", "Read partitions", "destination.partitions",
			"Read how one destination is divided and what each part holds - Kafka and "+
				"Pulsar partitions, RocketMQ queues, NATS subjects. Totals hide a backlog piled on one "+
				"part, and on Kafka a partition whose replicas have fallen out of sync.",
			(*Env).destinationPartitions),
		define("message_track", "Trace one message", "message.track",
			"Read where one message got to: for each consumer group subscribed to its "+
				"destination, whether that group consumed it, has yet to, or filtered it out - the "+
				"broker's own trace. Start here when a consumer says a message never arrived and the "+
				"producer says it was sent; no groups at all means nothing was subscribed to receive it.",
			(*Env).trackMessage),
		define("cluster_health", "Ask the broker how it is", "cluster.health",
			"Run the broker's own health checks: the checks that fail, the resource alarms "+
				"holding publishers back, the feature flags, and the deprecated features still in use. "+
				"This is the broker's opinion of itself and its answers name what to do; "+
				"cluster_topology is the inventory.",
			(*Env).clusterHealth),
		define("client_connections", "List client connections", "client.connections",
			"List the transport connections open against the broker right now: from where, "+
				"as which user, over which protocol, since when, and whether the broker has blocked one "+
				"from publishing. This is how to find out whether an application is connected at all.",
			(*Env).clientConnections),
		define("client_channels", "List client channels", "client.channels",
			"List the channels multiplexed inside those connections, with each one's "+
				"prefetch and its unacknowledged and unconfirmed counts - a consumer that has stopped "+
				"acknowledging shows here long before the queue depth makes it obvious. A family whose "+
				"connections carry no channels (client_connections reports none on any of them) answers "+
				"with an empty list: there is nothing of the kind to list, which is not the same as "+
				"nothing being open.",
			(*Env).clientChannels),
		define("destination_shards", "List a stream's shards", "destination.shards",
			"List the shards a stream is divided into, open and closed, with the slice of "+
				"hash space each takes and the shard it was split or merged from. A closed shard still "+
				"holds its records until retention expires, so a stream that looks like it lost data "+
				"usually has a closed parent nobody drained.",
			(*Env).destinationShards),
		define("channels_list", "List channels", "channel.list",
			"List the channel definitions applications and other queue managers connect "+
				"through, with each one's state, what a running instance is waiting on, and how many "+
				"instances run. A channel exists with nothing connected, which is exactly when somebody "+
				"is asking why.",
			(*Env).listChannels),

		define("destination_create", "Create a destination", "destination.create",
			"Create a topic, queue or stream. The settings a family accepts differ, and "+
				"capabilities_describe lists them for this connection - send them in attributes.",
			(*Env).createDestination),
		define("message_publish", "Publish a message", "message.send",
			"Publish a message. What it costs is whatever the consumers do with it, "+
				"which is not something this application can see.",
			(*Env).publishMessage),
		define("message_add_entry", "Append a stream entry", "message.addEntry",
			"Append an entry to a stream: named values rather than a body, which is what a "+
				"stream holds. The stream has to exist - a mistyped name is refused rather than made "+
				"into a new stream. The server assigns the id unless one is given, and the ids come back "+
				"as the only handle on the entries afterwards. count writes the same entry several times, "+
				"for filling a stream to test a consumer.",
			(*Env).addEntry),
		define("message_resend", "Resend a dead letter", "message.resend",
			"Put a dead-lettered message back on the retry path for whichever member of "+
				"the group picks it up.",
			(*Env).resendMessage),
		define("subscription_reset_offset", "Move a read position", "subscription.resetOffset",
			"Move a subscription's read position to a moment in time. Nothing is deleted, "+
				"but a forward move skips everything between and a backward one redelivers it.",
			(*Env).resetOffset),

		define("destination_purge", "Empty a destination", "destination.purge",
			"Discard everything a destination is holding, keeping the destination itself. "+
				"There is no undo and the messages are not somewhere else.",
			(*Env).purgeDestination),
		define("destination_delete", "Delete a destination", "destination.delete",
			"Delete a destination and everything it holds. There is no undo.",
			(*Env).deleteDestination),
	}
}

// connectionSummary is a stored profile as a caller needs it.
//
// It is built field by field rather than handed out whole. A profile carries
// its secrets in memory, and the one thing a tool must never do is put them in
// an answer - so nothing is copied here that was not chosen.
type connectionSummary struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	Family    string `json:"family"`
	Status    string `json:"status,omitempty" jsonschema:"given when the tools can use only the connections the MQ Studio window has open: online if it has this one open, offline if not"`
	Endpoints string `json:"endpoints,omitempty"`
	Group     string `json:"group,omitempty"`
	Remark    string `json:"remark,omitempty"`
	Allow     string `json:"allow" jsonschema:"how far the tools may go on this connection: read, mutate or destructive"`
}

type connectionsOutput struct {
	Connections []connectionSummary `json:"connections"`
}

func (e *Env) listConnections(_ context.Context, _ struct{}) (connectionsOutput, error) {
	profiles := e.Services.Connections.GetConnections()
	summaries := make([]connectionSummary, 0, len(profiles))
	for _, profile := range profiles {
		if profile == nil {
			continue
		}
		summaries = append(summaries, connectionSummary{
			ID:        profile.ID,
			Name:      profile.Name,
			Family:    string(profile.Kind),
			Status:    e.status(profile.ID),
			Endpoints: profile.Endpoints,
			Group:     profile.Group,
			Remark:    profile.Remark,
			Allow:     string(e.allow(profile.ID)),
		})
	}
	return connectionsOutput{Connections: summaries}, nil
}

/*
 * status is whether a tool can reach a connection now, where that depends on
 * it being open: without a resolver of its own, the tools use only what this
 * process holds. A transport that dials on demand reaches every stored
 * connection, and says nothing - nor could it, since the status it loads from
 * the window's file is always offline.
 */
func (e *Env) status(id int) string {
	if e.Open != nil {
		return ""
	}
	if _, err := e.Services.Conns(id); err != nil {
		return string(model.StatusOffline)
	}
	return string(model.StatusOnline)
}

// operationSummary is one thing a connection can be asked to do.
type operationSummary struct {
	ID      string `json:"id"`
	Blast   string `json:"blast"`
	Summary string `json:"summary"`
	Caveat  string `json:"caveat,omitempty"`
	// Tool names the tool that performs it, and is empty for an operation no
	// tool reaches - because there is none, because the allowance does not
	// extend that far on this connection, or because it destroys and this
	// caller cannot ask a person to confirm it. Either way the endpoint can do
	// it and this caller cannot, which is not the same as the endpoint being
	// unable to.
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
	Allow       string             `json:"allow" jsonschema:"how far the tools may go on this connection: read, mutate or destructive"`
	Operations  []operationSummary `json:"operations"`
	Unavailable []absence          `json:"unavailable,omitempty"`
}

func (e *Env) describeCapabilities(ctx context.Context, input connectionInput) (describeOutput, error) {
	conn, err := e.conn(input.Connection)
	if err != nil {
		return describeOutput{}, err
	}

	allow := e.allow(input.Connection)
	confirms := callerOf(ctx).Confirms
	resolved := catalog.For(conn)
	operations := make([]operationSummary, 0, len(resolved))
	for _, operation := range resolved {
		tool := e.Offered[operation.ID]
		if !catalog.Permits(allow, operation.Blast) ||
			(operation.Blast == catalog.BlastDestructive && !confirms) {
			tool = ""
		}
		operations = append(operations, operationSummary{
			ID:         operation.ID,
			Blast:      string(operation.Blast),
			Summary:    operation.Summary,
			Caveat:     e.say(operation.Caveat),
			Tool:       tool,
			Attributes: describeAttributes(conn.Kind(), operation.ID),
		})
	}

	capabilities := conn.Capabilities()
	unavailable := make([]absence, 0, len(capabilities.Degraded))
	for capability, reason := range capabilities.Degraded {
		unavailable = append(unavailable, absence{
			Capability: string(capability), Reason: e.say(reason)})
	}

	return describeOutput{
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

func (e *Env) listDestinations(ctx context.Context, input destinationsInput) (destinationsOutput, error) {
	conn, caveat, err := e.capable(input.Connection, model.CapDestinationList)
	if err != nil {
		return destinationsOutput{}, err
	}
	ctx, cancel := e.withTimeout(ctx)
	defer cancel()

	destinations, err := e.Services.Topics.List(ctx, input.Connection, model.DestinationFilter{
		Namespace:       input.Namespace,
		IncludeInternal: input.IncludeInternal,
	})
	if err != nil {
		return destinationsOutput{}, err
	}
	answered := make([]string, 0, len(destinations))
	for _, destination := range destinations {
		answered = append(answered, destination.Ref.Namespace)
	}
	if err := consulted(conn.Kind(), input.Namespace, answered...); err != nil {
		return destinationsOutput{}, err
	}
	return destinationsOutput{Destinations: destinations, Caveat: caveat}, nil
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

func (e *Env) destinationDetail(ctx context.Context, input destinationDetailInput) (destinationDetailOutput, error) {
	conn, caveat, err := e.capable(input.Connection, model.CapDestinationList)
	if err != nil {
		return destinationDetailOutput{}, err
	}
	ctx, cancel := e.withTimeout(ctx)
	defer cancel()

	destination, err := e.Services.Topics.Detail(ctx, input.Connection, model.DestinationRef{
		Namespace: input.Namespace,
		Name:      input.Name,
	})
	if err != nil {
		return destinationDetailOutput{}, err
	}
	if destination != nil {
		if err := consulted(conn.Kind(), input.Namespace, destination.Ref.Namespace); err != nil {
			return destinationDetailOutput{}, err
		}
	}
	return destinationDetailOutput{Destination: destination, Caveat: caveat}, nil
}

type subscriptionsOutput struct {
	Subscriptions []*model.Subscription `json:"subscriptions"`
	Caveat        string                `json:"caveat,omitempty"`
}

func (e *Env) listSubscriptions(ctx context.Context, input connectionInput) (subscriptionsOutput, error) {
	_, caveat, err := e.capable(input.Connection, model.CapSubscriptionList)
	if err != nil {
		return subscriptionsOutput{}, err
	}
	ctx, cancel := e.withTimeout(ctx)
	defer cancel()

	subscriptions, err := e.Services.Consumers.List(ctx, input.Connection)
	if err != nil {
		return subscriptionsOutput{}, err
	}
	return subscriptionsOutput{Subscriptions: subscriptions, Caveat: caveat}, nil
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

func (e *Env) browseMessages(ctx context.Context, input browseInput) (browseOutput, error) {
	_, caveat, err := e.capable(input.Connection, model.CapMessageQuery)
	if err != nil {
		return browseOutput{}, err
	}
	ctx, cancel := e.withTimeout(ctx)
	defer cancel()

	messages, err := e.Services.Messages.Query(ctx, input.Connection, model.MessageQueryParams{
		Topic:      input.Destination,
		MessageKey: input.MessageKey,
		StartTime:  input.StartTime,
		EndTime:    input.EndTime,
		MaxResults: e.limit(input.MaxResults),
	})
	if err != nil {
		return browseOutput{}, err
	}
	return browseOutput{Messages: messages, Caveat: caveat}, nil
}

type clusterOutput struct {
	Nodes    []*model.Node          `json:"nodes"`
	Overview *model.ClusterOverview `json:"overview,omitempty"`
	Caveat   string                 `json:"caveat,omitempty"`
}

func (e *Env) clusterTopology(ctx context.Context, input connectionInput) (clusterOutput, error) {
	_, caveat, err := e.capable(input.Connection, model.CapClusterTopology)
	if err != nil {
		return clusterOutput{}, err
	}
	ctx, cancel := e.withTimeout(ctx)
	defer cancel()

	nodes, err := e.Services.Cluster.GetBrokers(ctx, input.Connection)
	if err != nil {
		return clusterOutput{}, err
	}

	// The overview is a second capability. A cluster that reports its topology
	// and no aggregate figures answers with the nodes rather than failing.
	output := clusterOutput{Nodes: nodes, Caveat: caveat}
	if conn, _, err := e.capable(input.Connection, model.CapClusterMetrics); err == nil && conn != nil {
		if overview, _, err := e.Services.Cluster.Overview(ctx, input.Connection); err == nil {
			output.Overview = overview
		}
	}
	return output, nil
}
