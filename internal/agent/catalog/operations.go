package catalog

import (
	"reflect"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

// Operations is every operation a driver can carry, in the order the pages
// that use them appear in the sidebar.
//
// Each row's capability is the one the service layer already gates that call
// on, not a fresh judgement made here: internal/service resolves a port and a
// capability together before it calls in, and a row that disagreed with it
// would describe an operation the application would then refuse. The port and
// method name the signature in internal/driver/ports.go that actually runs.
//
// The blast radius is this file's own contribution, and it is the reason the
// file is written by hand rather than generated. Nothing in a signature says
// that purging a queue cannot be undone while updating one can, and that is
// the fact a caller composing the call most needs.
var Operations = []Operation{
	// Destinations.
	{
		ID: "destination.list", Capability: model.CapDestinationList,
		Port: "DestinationAdmin", Method: "ListDestinations",
		Blast: BlastRead, Summary: "List the topics, queues or streams this connection holds.",
		Request: reflect.TypeFor[model.DestinationFilter](),
		Result:  reflect.TypeFor[[]*model.Destination](),
	},
	{
		ID: "destination.detail", Capability: model.CapDestinationList,
		Port: "DestinationAdmin", Method: "DestinationDetail",
		Blast: BlastRead, Summary: "Read one destination's configuration and figures.",
		Request: reflect.TypeFor[model.DestinationRef](),
		Result:  reflect.TypeFor[*model.Destination](),
	},
	{
		ID: "destination.create", Capability: model.CapDestinationCreate,
		Port: "DestinationAdmin", Method: "CreateDestination",
		Blast: BlastMutate, Summary: "Create a destination.",
		Request:           reflect.TypeFor[model.DestinationSpec](),
		CarriesAttributes: true,
	},
	{
		ID: "destination.update", Capability: model.CapDestinationUpdate,
		Port: "DestinationAdmin", Method: "UpdateDestination",
		Blast: BlastMutate, Summary: "Change a destination's configuration.",
		Request:           reflect.TypeFor[model.DestinationSpec](),
		CarriesAttributes: true,
	},
	{
		ID: "destination.delete", Capability: model.CapDestinationDelete,
		Port: "DestinationAdmin", Method: "RemoveDestination",
		Blast: BlastDestructive, Summary: "Delete a destination and everything it is holding.",
		Request: reflect.TypeFor[model.DestinationRef](),
	},
	{
		ID: "destination.deleteGuarded", Capability: model.CapDestinationDelete,
		Port: "QueueGuardedRemover", Method: "RemoveQueueGuarded",
		Implemented: func(conn driver.Conn) bool { _, ok := conn.(driver.QueueGuardedRemover); return ok },
		Blast:       BlastDestructive,
		Summary: "Delete a destination only if the broker agrees it is unused or empty. " +
			"The guard is the broker's, so it is the only one that cannot race.",
		Params: []Param{
			{Name: "ref", Type: reflect.TypeFor[model.DestinationRef](), Required: true,
				Summary: "The destination to delete."},
			{Name: "ifUnused", Type: reflect.TypeFor[bool](), Required: true,
				Summary: "Refuse while anything is consuming from it."},
			{Name: "ifEmpty", Type: reflect.TypeFor[bool](), Required: true,
				Summary: "Refuse while it still holds a message."},
		},
	},
	{
		ID: "destination.purge", Capability: model.CapDestinationPurge,
		Port: "QueueActions", Method: "PurgeQueue",
		Blast: BlastDestructive, Summary: "Discard everything a destination holds, keeping the destination.",
		Request: reflect.TypeFor[model.DestinationRef](),
	},
	{
		ID: "destination.drop", Capability: model.CapDestinationPurge,
		Port: "QueueActions", Method: "DropMessages",
		Blast: BlastDestructive,
		Summary: "Discard a bounded batch from the head. Reports how many went, " +
			"which a purge cannot do because it empties the whole destination in one call.",
		Params: []Param{
			{Name: "ref", Type: reflect.TypeFor[model.DestinationRef](), Required: true,
				Summary: "The destination to drop from."},
			{Name: "limit", Type: reflect.TypeFor[int](), Required: true,
				Summary: "How many to discard, counting from the head."},
		},
		Result: reflect.TypeFor[int](),
	},
	{
		ID: "destination.move", Capability: model.CapDestinationMove,
		Port: "QueueActions", Method: "MoveMessages",
		Blast: BlastDestructive,
		Summary: "Drain one queue into an exchange. The count it returns is meaningful " +
			"on an error too: it is what already reached the target.",
		Request: reflect.TypeFor[model.MoveRequest](),
		Result:  reflect.TypeFor[int](),
	},
	{
		ID: "destination.rebalance", Capability: model.CapQueueRebalance,
		Port: "QueueActions", Method: "RebalanceQueues",
		Blast: BlastMutate, Summary: "Spread replicated destinations' leaders back across the cluster.",
	},
	{
		ID: "destination.trim", Capability: model.CapStreamTrim,
		Port: "StreamTrimmer", Method: "Trim",
		Blast: BlastDestructive,
		Summary: "Discard entries from the head of a log by naming the bound to keep. " +
			"An approximate trim may keep extras at a node boundary, so only the count " +
			"separates that from having matched nothing.",
		Request: reflect.TypeFor[model.TrimRequest](),
		Result:  reflect.TypeFor[*model.TrimResult](),
	},
	{
		ID: "destination.deleteEntries", Capability: model.CapStreamTrim,
		Port: "StreamTrimmer", Method: "DeleteEntries",
		Blast: BlastDestructive,
		Summary: "Delete named entries outright. The count is how many were there to " +
			"remove, so a successful delete is distinguishable from a no-op.",
		Params: []Param{
			{Name: "ref", Type: reflect.TypeFor[model.DestinationRef](), Required: true,
				Summary: "The log to delete from."},
			{Name: "ids", Type: reflect.TypeFor[[]string](), Required: true,
				Summary: "The entry ids to remove."},
		},
		Result: reflect.TypeFor[*model.TrimResult](),
	},
	{
		ID: "destination.partitions", Capability: model.CapPartitions,
		Port: "DestinationStats", Method: "DestinationStats",
		Blast: BlastRead, Summary: "Read the per-partition read range of one destination.",
		Request: reflect.TypeFor[model.DestinationRef](),
		Result:  reflect.TypeFor[map[string]interface{}](),
	},
	{
		ID: "destination.shards", Capability: model.CapShards,
		Port: "ShardInspector", Method: "ListShards",
		Blast: BlastRead,
		Summary: "List the shards a stream is divided into. A shard is an object, not an " +
			"index: it owns a slice of the hash space, and a closed parent still holds records.",
		Request: reflect.TypeFor[model.DestinationRef](),
		Result:  reflect.TypeFor[[]*model.Shard](),
	},
	{
		ID: "channel.list", Capability: model.CapChannels,
		Port: "ChannelInspector", Method: "ListChannels",
		Blast: BlastRead,
		Summary: "List the configured objects clients have to connect through. A channel " +
			"exists with nothing connected, which is exactly when somebody is asking why.",
		Result: reflect.TypeFor[[]*model.Channel](),
	},
	{
		ID: "destination.reassignments", Capability: model.CapReassign,
		Port: "PartitionReassigner", Method: "ListReassignments",
		Blast: BlastRead, Summary: "List the replica moves the cluster is currently running.",
		Result: reflect.TypeFor[[]*model.PartitionReassignment](),
	},
	{
		ID: "destination.reassign", Capability: model.CapReassign,
		Port: "PartitionReassigner", Method: "Reassign",
		Blast: BlastMutate,
		Summary: "Move a partition's replicas between nodes, which copies the log. The node " +
			"list is ordered - the first is the preferred leader - and there is no completion " +
			"to wait for: the move is done when the partition stops reporting one.",
		Params: []Param{
			{Name: "destination", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The destination whose partition moves."},
			{Name: "partition", Type: reflect.TypeFor[int32](), Required: true,
				Summary: "The partition number."},
			{Name: "nodes", Type: reflect.TypeFor[[]int32](), Required: true,
				Summary: "The nodes to hold it, preferred leader first."},
		},
	},
	{
		ID: "destination.cancelReassignment", Capability: model.CapReassign,
		Port: "PartitionReassigner", Method: "CancelReassignment",
		Blast: BlastMutate, Summary: "Stop a replica move that is still running.",
		Params: []Param{
			{Name: "destination", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The destination whose move is cancelled."},
			{Name: "partition", Type: reflect.TypeFor[int32](), Required: true,
				Summary: "The partition number."},
		},
	},

	// Subscriptions and read position.
	{
		ID: "subscription.list", Capability: model.CapSubscriptionList,
		Port: "SubscriptionAdmin", Method: "ListSubscriptions",
		Blast: BlastRead, Summary: "List the consumer groups or subscriptions on this connection.",
		Result: reflect.TypeFor[[]*model.Subscription](),
	},
	{
		ID: "subscription.detail", Capability: model.CapSubscriptionList,
		Port: "SubscriptionAdmin", Method: "SubscriptionDetail",
		Blast: BlastRead, Summary: "Read one subscription's configuration and members.",
		Request: reflect.TypeFor[model.SubscriptionRef](),
		Result:  reflect.TypeFor[*model.Subscription](),
	},
	{
		ID: "subscription.create", Capability: model.CapSubscriptionCreate,
		Port: "SubscriptionAdmin", Method: "CreateSubscription",
		Blast: BlastMutate, Summary: "Create a subscription.",
		Request:           reflect.TypeFor[model.SubscriptionSpec](),
		CarriesAttributes: true,
	},
	{
		// Update rides on the create capability rather than one of its own,
		// which is the service layer's decision and not this file's: a family
		// that can declare a subscription can redeclare one.
		ID: "subscription.update", Capability: model.CapSubscriptionCreate,
		Port: "SubscriptionAdmin", Method: "UpdateSubscription",
		Blast: BlastMutate, Summary: "Change a subscription's configuration.",
		Request:           reflect.TypeFor[model.SubscriptionSpec](),
		CarriesAttributes: true,
	},
	{
		ID: "subscription.delete", Capability: model.CapSubscriptionDelete,
		Port: "SubscriptionAdmin", Method: "RemoveSubscription",
		Blast:   BlastDestructive,
		Summary: "Delete a subscription, which discards the read position it was holding.",
		Request: reflect.TypeFor[model.SubscriptionRef](),
	},
	{
		ID: "subscription.lag", Capability: model.CapSubscriptionLag,
		Port: "SubscriptionStats", Method: "SubscriptionStats",
		Implemented: func(conn driver.Conn) bool { _, ok := conn.(driver.SubscriptionStats); return ok },
		Blast:       BlastRead, Summary: "Read one subscription's per-partition consume progress.",
		Request: reflect.TypeFor[model.SubscriptionRef](),
		Result:  reflect.TypeFor[map[string]interface{}](),
	},
	{
		ID: "subscription.clients", Capability: model.CapSubscriptionRuntime,
		Port: "SubscriptionRuntime", Method: "SubscriptionClients",
		Blast: BlastRead,
		Summary: "Ask the connected consumers what they are doing. A subscription with " +
			"nothing connected has no answer rather than an empty one.",
		Request: reflect.TypeFor[model.SubscriptionRef](),
		Result:  reflect.TypeFor[[]*model.SubscriptionClient](),
	},
	{
		ID: "subscription.resetOffset", Capability: model.CapOffsetReset,
		Port: "ProgressAdmin", Method: "ResetOffset",
		Blast: BlastMutate,
		Summary: "Move a subscription's read position by naming a moment and letting the " +
			"broker work out where that lands. Messages are not lost, but a forward reset " +
			"skips everything between.",
		Request: reflect.TypeFor[model.ResetOffsetRequest](),
	},
	{
		ID: "subscription.setPosition", Capability: model.CapSubscriptionPosition,
		Port: "StreamPositionAdmin", Method: "SetSubscriptionPosition",
		Blast: BlastMutate,
		Summary: "Move a subscription to a named place in the log. Unlike a reset this " +
			"names the position itself, because in a log the position is an id.",
		Request: reflect.TypeFor[model.PositionRequest](),
	},
	{
		ID: "subscription.setQueueOffset", Capability: model.CapQueueOffset,
		Port: "QueueProgressAdmin", Method: "SetQueueOffset",
		Blast: BlastMutate, Summary: "Write one queue's read position directly.",
		Request: reflect.TypeFor[model.QueueOffsetRequest](),
	},
	{
		ID: "subscription.cloneOffset", Capability: model.CapOffsetClone,
		Port: "OffsetCloner", Method: "CloneOffset",
		Blast: BlastMutate,
		Summary: "Write one subscription's read positions onto another, overwriting whatever " +
			"the target was holding.",
		Request: reflect.TypeFor[model.CloneOffsetRequest](),
	},
	{
		ID: "subscription.pendingSummary", Capability: model.CapPendingEntries,
		Port: "PendingEntryReader", Method: "PendingSummary",
		Blast: BlastRead, Summary: "Summarise what a subscription has been handed and not acknowledged.",
		Request: reflect.TypeFor[model.SubscriptionRef](),
		Result:  reflect.TypeFor[*model.PendingSummary](),
	},
	{
		ID: "subscription.pendingEntries", Capability: model.CapPendingEntries,
		Port: "PendingEntryReader", Method: "PendingEntries",
		Blast: BlastRead, Summary: "List unacknowledged deliveries, with who is holding each and for how long.",
		Request: reflect.TypeFor[model.PendingQuery](),
		Result:  reflect.TypeFor[[]*model.PendingEntry](),
	},
	{
		ID: "subscription.groupConsumers", Capability: model.CapPendingEntries,
		Port: "PendingEntryReader", Method: "GroupConsumers",
		Blast: BlastRead, Summary: "List a group's consumers and what each is owed.",
		Request: reflect.TypeFor[model.SubscriptionRef](),
		Result:  reflect.TypeFor[[]*model.GroupConsumer](),
	},
	{
		ID: "subscription.ackEntries", Capability: model.CapPendingAdmin,
		Port: "PendingEntryActions", Method: "AckEntries",
		Blast: BlastDestructive,
		Summary: "Acknowledge entries on the consumer's behalf, which discards them unprocessed. " +
			"The count is how many were actually owed, not how many were asked for.",
		Params: []Param{
			{Name: "ref", Type: reflect.TypeFor[model.SubscriptionRef](), Required: true,
				Summary: "The subscription that is owed them."},
			{Name: "ids", Type: reflect.TypeFor[[]string](), Required: true,
				Summary: "The entry ids to settle."},
		},
		Result: reflect.TypeFor[*model.AckResult](),
	},
	{
		ID: "subscription.claimEntries", Capability: model.CapPendingAdmin,
		Port: "PendingEntryActions", Method: "ClaimEntries",
		Blast: BlastMutate,
		Summary: "Move named entries to another consumer. Nothing is discarded, but a " +
			"consumer that was merely slow loses the work it was holding.",
		Request: reflect.TypeFor[model.ClaimRequest](),
		Result:  reflect.TypeFor[*model.ClaimResult](),
	},
	{
		ID: "subscription.autoClaim", Capability: model.CapPendingAdmin,
		Port: "PendingEntryActions", Method: "AutoClaim",
		Blast: BlastMutate,
		Summary: "Move whatever has been idle too long without naming ids, reporting what " +
			"it found already gone as well as what it moved.",
		Request: reflect.TypeFor[model.AutoClaimRequest](),
		Result:  reflect.TypeFor[*model.ClaimResult](),
	},

	// Messages.
	{
		ID: "message.query", Capability: model.CapMessageQuery,
		Port: "MessageReader", Method: "QueryMessages",
		Blast: BlastRead,
		Summary: "Browse stored messages. Whether this takes anything away is the family's " +
			"doing and is recorded as a caveat on the capability, not as a higher blast radius.",
		Request: reflect.TypeFor[model.MessageQueryParams](),
		Result:  reflect.TypeFor[[]*model.MessageItem](),
	},
	{
		ID: "message.byId", Capability: model.CapMessageByID,
		Port: "MessageReader", Method: "MessageByID",
		Blast: BlastRead, Summary: "Read one message by the id its family identifies messages with.",
		Params: []Param{
			{Name: "topic", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The destination holding it."},
			{Name: "messageID", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The message id."},
		},
		Result: reflect.TypeFor[*model.MessageItem](),
	},
	{
		ID: "message.tail", Capability: model.CapMessageLiveTail,
		Port: "MessageTailer", Method: "TailMessages",
		Blast: BlastRead,
		Summary: "Read what has arrived since a cursor. Nothing streams - no broker here " +
			"pushes admin data - so the caller owns the loop and hands back the cursor it was given.",
		Params: []Param{
			{Name: "ref", Type: reflect.TypeFor[model.DestinationRef](), Required: true,
				Summary: "The destination to follow."},
			{Name: "cursor", Type: reflect.TypeFor[model.TailCursor](), Required: true,
				Summary: "The cursor from the previous batch; the zero value starts at the end."},
			{Name: "limit", Type: reflect.TypeFor[int](), Required: true,
				Summary: "How many to return at most."},
		},
		Result: reflect.TypeFor[*model.TailBatch](),
	},
	{
		ID: "message.liveStart", Capability: model.CapLiveStream,
		Port: "LiveSubscriber", Method: "StartLiveSubscription",
		Blast: BlastMutate,
		Summary: "Subscribe to what the broker pushes. The subscription lives on the broker " +
			"until it is stopped, so stopping it is not optional cleanup.",
		Request: reflect.TypeFor[model.LiveSubscriptionSpec](),
		Result:  reflect.TypeFor[*model.LiveSubscription](),
	},
	{
		ID: "message.livePoll", Capability: model.CapLiveStream,
		Port: "LiveSubscriber", Method: "PollLiveSubscription",
		Blast: BlastRead,
		Summary: "Drain a live subscription's buffer by sequence. What is not collected is " +
			"gone: a pushed stream cannot be re-read.",
		Params: []Param{
			{Name: "id", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The live subscription to drain."},
			{Name: "after", Type: reflect.TypeFor[int64](), Required: true,
				Summary: "The sequence already seen."},
			{Name: "limit", Type: reflect.TypeFor[int](), Required: true,
				Summary: "How many to return at most."},
		},
		Result: reflect.TypeFor[*model.LiveBatch](),
	},
	{
		ID: "message.liveStop", Capability: model.CapLiveStream,
		Port: "LiveSubscriber", Method: "StopLiveSubscription",
		Blast: BlastMutate, Summary: "Stop a live subscription and release it on the broker.",
		Params: []Param{
			{Name: "id", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The live subscription to stop."},
		},
	},
	{
		ID: "message.liveList", Capability: model.CapLiveStream,
		Port: "LiveSubscriber", Method: "LiveSubscriptions",
		Blast: BlastRead,
		Summary: "List the live subscriptions already running, so a caller finds its own " +
			"instead of starting a second one.",
		Result: reflect.TypeFor[[]*model.LiveSubscription](),
	},
	{
		ID: "message.track", Capability: model.CapMessageTrack,
		Port: "MessageTracker", Method: "TrackMessage",
		Blast: BlastRead, Summary: "Read where a message got to, from the broker's own trace.",
		Params: []Param{
			{Name: "topic", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The destination holding it."},
			{Name: "messageID", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The message id."},
		},
		Result: reflect.TypeFor[[]*model.MessageTrackItem](),
	},
	{
		ID: "message.dlq", Capability: model.CapDLQ,
		Port: "DeadLetterReader", Method: "DLQMessages",
		Blast: BlastRead, Summary: "Browse a subscription's dead-letter backlog.",
		Params: []Param{
			{Name: "group", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The subscription whose dead letters to read."},
			{Name: "maxResults", Type: reflect.TypeFor[int](), Required: true,
				Summary: "How many to return at most."},
		},
		Result: reflect.TypeFor[[]*model.MessageItem](),
	},
	{
		ID: "message.retryQueue", Capability: model.CapDLQ,
		Port: "DeadLetterReader", Method: "RetryMessages",
		Blast: BlastRead, Summary: "Browse a subscription's retry backlog, which is not yet its dead letters.",
		Params: []Param{
			{Name: "group", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The subscription whose retries to read."},
			{Name: "maxResults", Type: reflect.TypeFor[int](), Required: true,
				Summary: "How many to return at most."},
		},
		Result: reflect.TypeFor[[]*model.MessageItem](),
	},
	{
		ID: "message.resend", Capability: model.CapMessageResend,
		Port: "DeadLetterReader", Method: "ResendMessage",
		Blast: BlastMutate,
		Summary: "Put a copy back on the retry path for whichever group member picks it up. " +
			"That is 'try again', not 'show me why this one fails'.",
		Params: []Param{
			{Name: "consumerGroup", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The group to resend for."},
			{Name: "clientID", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The client the broker attributes it to."},
			{Name: "topic", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The destination it came from."},
			{Name: "messageID", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The message id."},
		},
		Result: reflect.TypeFor[string](),
	},
	{
		ID: "message.deadLetterQueues", Capability: model.CapDeadLetterTopology,
		Port: "DeadLetterTopology", Method: "DeadLetterQueues",
		Blast: BlastRead,
		Summary: "Find the dead-letter queues by walking the topology, for a family where a " +
			"dead-letter queue is a convention rather than an object.",
		Params: []Param{
			{Name: "namespace", Type: reflect.TypeFor[string](), Required: false,
				Summary: "The namespace to search; empty is the connection's own scope."},
		},
		Result: reflect.TypeFor[[]*model.DeadLetterQueue](),
	},
	{
		ID: "message.replay", Capability: model.CapMessageReplay,
		Port: "MessageReplayer", Method: "ReplayMessage",
		Blast: BlastMutate,
		Summary: "Run one named client's listener against one message and report what it " +
			"returned. Nothing is requeued; the consumer's own side effects still happen.",
		Request: reflect.TypeFor[model.ReplayRequest](),
		Result:  reflect.TypeFor[*model.ReplayResult](),
	},
	{
		ID: "message.send", Capability: model.CapPublish,
		Port: "MessagePublisher", Method: "SendMessage",
		Blast: BlastMutate,
		Summary: "Publish a message. Consumers act on what is published, so the blast radius " +
			"is whatever they do, not what the broker stores.",
		Params: []Param{
			{Name: "topic", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The destination to publish to."},
			{Name: "tags", Type: reflect.TypeFor[string](), Required: false,
				Summary: "The family's subscription tag, where it has one."},
			{Name: "keys", Type: reflect.TypeFor[string](), Required: false,
				Summary: "The family's message keys, where it has them."},
			{Name: "body", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The payload."},
			{Name: "delayLevel", Type: reflect.TypeFor[int](), Required: false,
				Summary: "Zero unless the connection also declares delayed delivery."},
		},
		Result: reflect.TypeFor[string](),
	},
	{
		// The same call with delayLevel set. It is a row of its own because it
		// is gated separately: a family can publish and have nothing to
		// schedule with, and a caller that set the field anyway would have it
		// silently ignored.
		ID: "message.sendDelayed", Capability: model.CapDelayedDelivery,
		Port: "MessagePublisher", Method: "SendMessage",
		Blast: BlastMutate, Summary: "Publish a message the broker holds until its delay has passed.",
		Params: []Param{
			{Name: "topic", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The destination to publish to."},
			{Name: "body", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The payload."},
			{Name: "delayLevel", Type: reflect.TypeFor[int](), Required: true,
				Summary: "The family's delay level, which is an index into its own table, not a duration."},
		},
		Result: reflect.TypeFor[string](),
	},
	{
		ID: "message.publish", Capability: model.CapPublishRich,
		Port: "RichPublisher", Method: "Publish",
		Blast: BlastMutate,
		Summary: "Publish with everything the family's own protocol carries, and hear two " +
			"facts back rather than one: whether the broker kept it, and whether anything " +
			"was bound to receive it.",
		Request: reflect.TypeFor[model.PublishRequest](),
		Result:  reflect.TypeFor[*model.PublishResult](),
	},
	{
		ID: "message.addEntry", Capability: model.CapEntryPublish,
		Port: "EntryPublisher", Method: "AddEntry",
		Blast: BlastMutate,
		Summary: "Write a log entry of named fields. The ids it returns are the only handle " +
			"on the entry afterwards.",
		Request: reflect.TypeFor[model.StreamAddRequest](),
		Result:  reflect.TypeFor[*model.StreamAddResult](),
	},
	{
		ID: "producer.clients", Capability: model.CapProducerInspect,
		Port: "ProducerInspector", Method: "ProducerClients",
		Blast: BlastRead,
		Summary: "Report who is publishing, by producer group. There is no call that " +
			"enumerates the groups, so this answers whether a named service is still " +
			"connected rather than who is writing here.",
		Params: []Param{
			{Name: "group", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The producer group the broker indexes connections by."},
			{Name: "destination", Type: reflect.TypeFor[string](), Required: false,
				Summary: "Narrow to one destination."},
		},
		Result: reflect.TypeFor[[]*model.ProducerClient](),
	},

	// The cluster and the things it is made of.
	{
		ID: "cluster.nodes", Capability: model.CapClusterTopology,
		Port: "ClusterAdmin", Method: "ListNodes",
		Blast: BlastRead, Summary: "List the brokers this cluster is made of.",
		Result: reflect.TypeFor[[]*model.Node](),
	},
	{
		ID: "cluster.nodeDetail", Capability: model.CapClusterTopology,
		Port: "ClusterAdmin", Method: "NodeDetail",
		Blast: BlastRead, Summary: "Read one broker's own figures.",
		Params: []Param{
			{Name: "address", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The broker address, as the topology reports it."},
		},
		Result: reflect.TypeFor[*model.Node](),
	},
	{
		ID: "cluster.overview", Capability: model.CapClusterMetrics,
		Port: "ClusterAdmin", Method: "ClusterOverview",
		Blast: BlastRead, Summary: "Read the cluster's aggregate figures.",
		Result: reflect.TypeFor[*model.ClusterOverview](),
	},
	{
		ID: "cluster.directoryNodes", Capability: model.CapDirectory,
		Port: "DirectoryAdmin", Method: "ListDirectoryNodes",
		Blast: BlastRead,
		Summary: "List the discovery tier the cluster is reached through, where the family " +
			"has one of its own.",
		Result: reflect.TypeFor[[]*model.Node](),
	},
	{
		ID: "cluster.nodeConfig", Capability: model.CapNodeConfig,
		Port: "ConfigInspector", Method: "NodeConfig",
		Blast: BlastRead,
		Summary: "Read what one broker is actually running with, which is not always what " +
			"its config file says. A few hundred keys, one request per node.",
		Params: []Param{
			{Name: "address", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The broker address."},
		},
		Result: reflect.TypeFor[map[string]string](),
	},
	{
		ID: "cluster.directoryConfig", Capability: model.CapNodeConfig,
		Port: "ConfigInspector", Method: "DirectoryConfig",
		Blast: BlastRead,
		Summary: "Read the discovery tier's settings. A family with no separate tier answers " +
			"with an empty map rather than an error.",
		Result: reflect.TypeFor[map[string]string](),
	},
	{
		ID: "cluster.slowLog", Capability: model.CapSlowLog,
		Port: "SlowLogReader", Method: "SlowLog",
		Blast: BlastRead,
		Summary: "Read the record of a node's slowest commands. The only view here of a " +
			"single request rather than an aggregate, which is what to open when every " +
			"other figure looks healthy.",
		Params: []Param{
			{Name: "address", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The node to ask."},
			{Name: "limit", Type: reflect.TypeFor[int](), Required: true,
				Summary: "How many entries to return at most."},
		},
		Result: reflect.TypeFor[[]*model.SlowLogEntry](),
	},
	{
		ID: "cluster.transactions", Capability: model.CapTransactions,
		Port: "TransactionInspector", Method: "ListTransactions",
		Blast: BlastRead,
		Summary: "List the transactional producers the cluster is tracking. An unfinished " +
			"transaction is invisible everywhere else while it holds consumers back.",
		Result: reflect.TypeFor[[]*model.Transaction](),
	},
	{
		ID: "cluster.logDirs", Capability: model.CapLogDirs,
		Port: "LogDirInspector", Method: "LogDirs",
		Blast: BlastRead,
		Summary: "Read how much disk each broker's partitions occupy. Occupied bytes only - " +
			"there is no free space or percentage anywhere in the protocol.",
		Result: reflect.TypeFor[[]*model.LogDirSummary](),
	},
	{
		ID: "cluster.logDirPartitions", Capability: model.CapLogDirs,
		Port: "LogDirInspector", Method: "LogDirPartitions",
		Blast: BlastRead, Summary: "List what is inside those directories, largest first.",
		Params: []Param{
			{Name: "limit", Type: reflect.TypeFor[int](), Required: true,
				Summary: "How many partitions to return."},
		},
		Result: reflect.TypeFor[[]*model.LogDirPartition](),
	},
	{
		ID: "cluster.maintenance", Capability: model.CapNodeMaintenance,
		Port: "NodeMaintenance", Method: "RunMaintenance",
		Blast: BlastMutate,
		Summary: "Run one node's housekeeping now. It reclaims space the broker had already " +
			"decided it could reclaim, so it brings forward work rather than discarding " +
			"anything the broker meant to keep. Scoped to one node on purpose.",
		Params: []Param{
			{Name: "address", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The node to run it on."},
			{Name: "task", Type: reflect.TypeFor[model.MaintenanceTask](), Required: true,
				Summary: "Which housekeeping task."},
		},
	},
	{
		ID: "cluster.setNodeWritable", Capability: model.CapNodeWritePerm,
		Port: "WritePermissionAdmin", Method: "SetNodeWritable",
		Blast: BlastMutate,
		Summary: "Take a node out of the write path or put it back - how a broker is drained " +
			"before it stops. The count of destinations touched is best effort: the change " +
			"lands either way.",
		Params: []Param{
			{Name: "name", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The node name, as the discovery tier knows it."},
			{Name: "writable", Type: reflect.TypeFor[bool](), Required: true,
				Summary: "False drains it, true puts it back."},
		},
		Result: reflect.TypeFor[int](),
	},
	{
		ID: "cluster.census", Capability: model.CapClusterCensus,
		Port: "CensusReporter", Method: "Census",
		Blast: BlastRead,
		Summary: "Answer for the whole broker in one call: what it is collectively holding " +
			"and how fast that is moving.",
		Result: reflect.TypeFor[*model.BrokerCensus](),
	},
	{
		ID: "cluster.health", Capability: model.CapClusterHealth,
		Port: "HealthInspector", Method: "Health",
		Blast: BlastRead,
		Summary: "Run the broker's own health checks. This is its opinion of itself, and the " +
			"answers name what to do.",
		Result: reflect.TypeFor[*model.BrokerHealth](),
	},
	{
		ID: "client.connections", Capability: model.CapClientInspect,
		Port: "ClientInspector", Method: "ListClientConnections",
		Blast: BlastRead, Summary: "List the transport connections open against the broker right now.",
		Params: []Param{
			{Name: "namespace", Type: reflect.TypeFor[string](), Required: false,
				Summary: "Narrow to one namespace; empty is the connection's own scope."},
		},
		Result: reflect.TypeFor[[]*model.ClientConnection](),
	},
	{
		ID: "client.channels", Capability: model.CapClientInspect,
		Port: "ClientInspector", Method: "ListClientChannels",
		Blast: BlastRead, Summary: "List the channels multiplexed inside those connections.",
		Params: []Param{
			{Name: "namespace", Type: reflect.TypeFor[string](), Required: false,
				Summary: "Narrow to one namespace; empty is the connection's own scope."},
		},
		Result: reflect.TypeFor[[]*model.ClientChannel](),
	},
	{
		ID: "client.close", Capability: model.CapClientClose,
		Port: "ClientCloser", Method: "CloseClientConnection",
		Blast: BlastDestructive,
		Summary: "Disconnect one client. Whole connections only: a family that multiplexes " +
			"sessions inside one offers no way to close a single session, so this closes " +
			"more than a session.",
		Params: []Param{
			{Name: "name", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The connection, as the listing names it."},
			{Name: "reason", Type: reflect.TypeFor[string](), Required: false,
				Summary: "What the client is told."},
		},
	},
	{
		ID: "client.closeUser", Capability: model.CapClientClose,
		Port: "ClientCloser", Method: "CloseUserConnections",
		Blast: BlastDestructive,
		Summary: "Disconnect every connection one identity holds, which is how an application " +
			"with several instances is actually evicted.",
		Params: []Param{
			{Name: "username", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The identity to evict."},
			{Name: "reason", Type: reflect.TypeFor[string](), Required: false,
				Summary: "What the clients are told."},
		},
	},
	{
		ID: "quota.list", Capability: model.CapQuotaList,
		Port: "QuotaAdmin", Method: "ListQuotas",
		Blast: BlastRead,
		Summary: "List the limits attached to clients rather than to destinations. An entity " +
			"carries its own default flag: the quota on the client named \"\" and the one " +
			"every unnamed client inherits are different rows.",
		Result: reflect.TypeFor[[]*model.ClientQuota](),
	},
	{
		ID: "quota.alter", Capability: model.CapQuotaAdmin,
		Port: "QuotaAdmin", Method: "AlterQuota",
		Blast: BlastMutate,
		Summary: "Set and remove a client's limits in one call. A removal is not a set to " +
			"zero - zero throttles the client to nothing.",
		Params: []Param{
			{Name: "entity", Type: reflect.TypeFor[[]model.QuotaEntity](), Required: true,
				Summary: "What the quota is attached to."},
			{Name: "set", Type: reflect.TypeFor[map[string]float64](), Required: false,
				Summary: "Limits to write."},
			{Name: "remove", Type: reflect.TypeFor[[]string](), Required: false,
				Summary: "Limit keys to drop, restoring the inherited value."},
		},
	},
	{
		ID: "quota.remove", Capability: model.CapQuotaAdmin,
		Port: "QuotaAdmin", Method: "RemoveQuota",
		Blast: BlastMutate, Summary: "Drop named limits from a client, restoring what it inherits.",
		Params: []Param{
			{Name: "entity", Type: reflect.TypeFor[[]model.QuotaEntity](), Required: true,
				Summary: "What the quota is attached to."},
			{Name: "keys", Type: reflect.TypeFor[[]string](), Required: true,
				Summary: "The limit keys to drop."},
		},
	},
	{
		ID: "stream.clients", Capability: model.CapStreamClients,
		Port: "StreamInspector", Method: "StreamClients",
		Blast: BlastRead,
		Summary: "Read who is attached over the family's stream protocol. These do not appear " +
			"among the subscribers, so a stream three applications are reading can report " +
			"zero consumers everywhere else.",
		Request: reflect.TypeFor[model.DestinationRef](),
		Result:  reflect.TypeFor[*model.StreamClients](),
	},

	// Namespaces and the connection's own scope.
	{
		ID: "namespace.list", Capability: model.CapNamespaceList,
		Port: "NamespaceAdmin", Method: "ListNamespaces",
		Blast: BlastRead, Summary: "List the namespaces this broker's objects live in.",
		Result: reflect.TypeFor[[]*model.Namespace](),
	},
	{
		ID: "namespace.save", Capability: model.CapNamespaceAdmin,
		Port: "NamespaceAdmin", Method: "CreateNamespace",
		Blast: BlastMutate,
		Summary: "Create or update a namespace. The broker spells both as one idempotent " +
			"call, and unlike a queue a namespace's settings can genuinely change.",
		Request: reflect.TypeFor[model.NamespaceSpec](),
	},
	{
		ID: "namespace.delete", Capability: model.CapNamespaceAdmin,
		Port: "NamespaceAdmin", Method: "RemoveNamespace",
		Blast: BlastDestructive, Summary: "Delete a namespace and what it contains.",
		Params: []Param{
			{Name: "name", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The namespace to remove."},
		},
	},
	{
		ID: "namespace.setLimit", Capability: model.CapNamespaceLimits,
		Port: "NamespaceLimits", Method: "SetNamespaceLimit",
		Blast: BlastMutate,
		Summary: "Cap a namespace as a whole. A limit's absence means no cap at all, which " +
			"is not what a cap of zero means.",
		Params: []Param{
			{Name: "name", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The namespace to cap."},
			{Name: "limit", Type: reflect.TypeFor[string](), Required: true,
				Summary: "Which limit."},
			{Name: "value", Type: reflect.TypeFor[int](), Required: true,
				Summary: "The cap."},
		},
	},
	{
		ID: "namespace.removeLimit", Capability: model.CapNamespaceLimits,
		Port: "NamespaceLimits", Method: "RemoveNamespaceLimit",
		Blast: BlastMutate, Summary: "Remove a namespace cap, which is not the same as setting it to zero.",
		Params: []Param{
			{Name: "name", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The namespace."},
			{Name: "limit", Type: reflect.TypeFor[string](), Required: true,
				Summary: "Which limit to remove."},
		},
	},
	{
		ID: "scope.list", Capability: model.CapConnectionScope,
		Port: "ScopeInspector", Method: "ListScopes",
		Blast: BlastRead,
		Summary: "List the values this connection's scope can be pointed at. A scope is a " +
			"naming convention discovered from the resources that carry it, not an object.",
		Result: reflect.TypeFor[[]*model.Scope](),
	},
	{
		ID: "scope.validate", Capability: model.CapConnectionScope,
		Port: "ScopeInspector", Method: "ValidateScope",
		Blast: BlastRead,
		Summary: "Report whether a name the listing did not offer can be composed into a " +
			"resource name at all. A name nothing carries yet is still usable.",
		Params: []Param{
			{Name: "name", Type: reflect.TypeFor[string](), Required: false,
				Summary: "The scope to check; empty is the unscoped connection and always valid."},
		},
	},

	// Access control, in the three shapes the families actually have.
	{
		ID: "access.enabled", Capability: model.CapAccessControl,
		Port: "AccessAdmin", Method: "AccessEnabled",
		Blast: BlastRead, Summary: "Report whether the broker is enforcing credential-based access control.",
		Result: reflect.TypeFor[bool](),
	},
	{
		ID: "access.version", Capability: model.CapAccessControl,
		Port: "AccessAdmin", Method: "AccessVersion",
		Blast: BlastRead, Summary: "Read the version of the access configuration in force.",
		Result: reflect.TypeFor[*model.AclVersionInfo](),
	},
	{
		ID: "access.put", Capability: model.CapAccessControl,
		Port: "AccessAdmin", Method: "PutAccessConfig",
		Blast: BlastMutate,
		Summary: "Write one credential and its permissions. Write-only on the families that " +
			"have this: the broker offers no call that reads it back, so a caller cannot " +
			"confirm what it just wrote.",
		Request: reflect.TypeFor[model.AccessConfig](),
	},
	{
		ID: "access.remove", Capability: model.CapAccessControl,
		Port: "AccessAdmin", Method: "RemoveAccessConfig",
		Blast:   BlastDestructive,
		Summary: "Remove a credential, which stops every application using it.",
		Params: []Param{
			{Name: "accessKey", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The access key to remove."},
		},
	},
	{
		ID: "access.setWhitelist", Capability: model.CapAccessControl,
		Port: "AccessAdmin", Method: "SetGlobalWhiteAddrs",
		Blast: BlastMutate,
		Summary: "Replace the global address whitelist. An address on it is not signature " +
			"checked at all, so widening this is how access control stops applying.",
		Params: []Param{
			{Name: "addresses", Type: reflect.TypeFor[[]string](), Required: true,
				Summary: "The whole list; it replaces rather than adds."},
		},
	},
	{
		ID: "access.directoryEnabled", Capability: model.CapAccessDirectory,
		Port: "AccessDirectory", Method: "DirectoryEnabled",
		Blast: BlastRead,
		Summary: "Report whether the broker runs identity-based access control. Switched off " +
			"answers false rather than failing, so a caller can say which system is on.",
		Result: reflect.TypeFor[bool](),
	},
	{
		ID: "access.principals", Capability: model.CapAccessDirectory,
		Port: "AccessDirectory", Method: "ListPrincipals",
		Blast: BlastRead, Summary: "List the principals the broker authenticates.",
		Result: reflect.TypeFor[[]*model.AccessPrincipal](),
	},
	{
		ID: "access.putPrincipal", Capability: model.CapAccessDirectory,
		Port: "AccessDirectory", Method: "PutPrincipal",
		Blast: BlastMutate, Summary: "Create or update a principal.",
		Request: reflect.TypeFor[model.AccessPrincipalSpec](),
	},
	{
		ID: "access.removePrincipal", Capability: model.CapAccessDirectory,
		Port: "AccessDirectory", Method: "RemovePrincipal",
		Blast: BlastDestructive, Summary: "Remove a principal, which stops everything authenticating as it.",
		Params: []Param{
			{Name: "name", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The principal to remove."},
		},
	},
	{
		ID: "access.rules", Capability: model.CapAccessDirectory,
		Port: "AccessDirectory", Method: "ListAccessRules",
		Blast: BlastRead, Summary: "List the rules attached to subjects, which is what is actually in force.",
		Result: reflect.TypeFor[[]*model.AccessRule](),
	},
	{
		ID: "access.putRule", Capability: model.CapAccessDirectory,
		Port: "AccessDirectory", Method: "PutAccessRule",
		Blast: BlastMutate, Summary: "Write a rule for a subject.",
		Request: reflect.TypeFor[model.AccessRule](),
	},
	{
		ID: "access.removeRule", Capability: model.CapAccessDirectory,
		Port: "AccessDirectory", Method: "RemoveAccessRule",
		Blast: BlastMutate, Summary: "Remove a subject's rule, which falls back to whatever the broker does by default.",
		Params: []Param{
			{Name: "subject", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The subject whose rule goes."},
		},
	},
	{
		ID: "acl.users", Capability: model.CapAclUsers,
		Port: "AclUserAdmin", Method: "ListAclUsers",
		Blast: BlastRead,
		Summary: "List the users access control lives on, with their command rules, key " +
			"patterns and channel patterns read back.",
		Result: reflect.TypeFor[[]*model.AclUser](),
	},
	{
		ID: "acl.saveUser", Capability: model.CapAclUsers,
		Port: "AclUserAdmin", Method: "SaveAclUser",
		Blast: BlastMutate,
		Summary: "Replace a user's rules. It replaces rather than merges, deliberately: the " +
			"server's own call is additive, so an edit that removed a pattern would leave " +
			"it in place.",
		Request: reflect.TypeFor[model.AclUserSpec](),
	},
	{
		ID: "acl.removeUser", Capability: model.CapAclUsers,
		Port: "AclUserAdmin", Method: "RemoveAclUser",
		Blast: BlastDestructive, Summary: "Remove a user, which stops everything connecting as it.",
		Params: []Param{
			{Name: "name", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The user to remove."},
		},
	},
	{
		ID: "acl.categories", Capability: model.CapAclUsers,
		Port: "AclUserAdmin", Method: "AclCategories",
		Blast: BlastRead,
		Summary: "Read the command groups rules are written in terms of. They differ by " +
			"server version, so they are read rather than assumed.",
		Result: reflect.TypeFor[[]string](),
	},
	{
		ID: "identity.list", Capability: model.CapIdentityList,
		Port: "IdentityAdmin", Method: "ListIdentities",
		Blast: BlastRead,
		Summary: "List the identities the broker authenticates. Tags decide what the " +
			"management API allows; per-namespace permissions decide what connections may " +
			"touch, and they are separate questions.",
		Result: reflect.TypeFor[[]*model.Identity](),
	},
	{
		ID: "identity.save", Capability: model.CapIdentityAdmin,
		Port: "IdentityAdmin", Method: "SaveIdentity",
		Blast: BlastMutate,
		Summary: "Create or update an identity. An empty password keeps whatever is stored, " +
			"which the driver arranges: the broker's own endpoint replaces the whole user.",
		Request: reflect.TypeFor[model.IdentitySpec](),
	},
	{
		ID: "identity.remove", Capability: model.CapIdentityAdmin,
		Port: "IdentityAdmin", Method: "RemoveIdentity",
		Blast: BlastDestructive, Summary: "Remove an identity, which stops everything connecting as it.",
		Params: []Param{
			{Name: "name", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The identity to remove."},
		},
	},
	{
		ID: "identity.setPermission", Capability: model.CapIdentityPermissions,
		Port: "IdentityPermissions", Method: "SetPermission",
		Blast: BlastMutate, Summary: "Grant an identity access inside a namespace.",
		Request: reflect.TypeFor[model.NamespacePermission](),
	},
	{
		ID: "identity.removePermission", Capability: model.CapIdentityPermissions,
		Port: "IdentityPermissions", Method: "RemovePermission",
		Blast: BlastDestructive,
		Summary: "Revoke an identity's access to a namespace. Revoking is not granting " +
			"nothing: with no permission record the broker refuses the connection outright, " +
			"where empty patterns let it connect and do nothing.",
		Params: []Param{
			{Name: "namespace", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The namespace."},
			{Name: "identity", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The identity losing access."},
		},
	},
	{
		ID: "identity.topicPermissions", Capability: model.CapIdentityPermissions,
		Port: "IdentityPermissions", Method: "ListTopicPermissions",
		Blast: BlastRead, Summary: "List the per-destination permissions in force.",
		Result: reflect.TypeFor[[]*model.TopicPermission](),
	},
	{
		ID: "identity.setTopicPermission", Capability: model.CapIdentityPermissions,
		Port: "IdentityPermissions", Method: "SetTopicPermission",
		Blast: BlastMutate, Summary: "Grant an identity access to destinations by pattern.",
		Request: reflect.TypeFor[model.TopicPermission](),
	},
	{
		ID: "identity.removeTopicPermission", Capability: model.CapIdentityPermissions,
		Port: "IdentityPermissions", Method: "RemoveTopicPermission",
		Blast: BlastDestructive, Summary: "Revoke an identity's destination permissions in a namespace.",
		Params: []Param{
			{Name: "namespace", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The namespace."},
			{Name: "identity", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The identity losing them."},
		},
	},

	// Policies, stored configuration and the topology document.
	{
		ID: "policy.list", Capability: model.CapPolicyList,
		Port: "PolicyAdmin", Method: "ListPolicies",
		Blast: BlastRead,
		Summary: "List the settings applied to destinations by pattern. On a family whose " +
			"destinations are immutable once declared, a policy is the only way to change a " +
			"live one.",
		Result: reflect.TypeFor[[]*model.Policy](),
	},
	{
		ID: "policy.matching", Capability: model.CapPolicyList,
		Port: "PolicyAdmin", Method: "MatchingPolicies",
		Blast: BlastRead,
		Summary: "Ask the broker which policies actually apply to one destination. Not " +
			"workable by matching patterns yourself: only the highest-priority match " +
			"applies, and policies do not merge.",
		Params: []Param{
			{Name: "ref", Type: reflect.TypeFor[model.DestinationRef](), Required: true,
				Summary: "The destination to ask about."},
			{Name: "kind", Type: reflect.TypeFor[string](), Required: true,
				Summary: "Which kind of object it is, as the family names it."},
		},
		Result: reflect.TypeFor[[]*model.Policy](),
	},
	{
		ID: "policy.save", Capability: model.CapPolicyAdmin,
		Port: "PolicyAdmin", Method: "SavePolicy",
		Blast: BlastMutate,
		Summary: "Write a policy. It takes effect on every destination its pattern matches, " +
			"which is more than the one that prompted it.",
		Request: reflect.TypeFor[model.Policy](),
	},
	{
		ID: "policy.remove", Capability: model.CapPolicyAdmin,
		Port: "PolicyAdmin", Method: "RemovePolicy",
		Blast: BlastMutate,
		Summary: "Remove a policy, which drops its settings from every destination it was " +
			"matching.",
		Params: []Param{
			{Name: "namespace", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The namespace holding it."},
			{Name: "name", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The policy name."},
			{Name: "operator", Type: reflect.TypeFor[bool](), Required: false,
				Summary: "True for an operator policy, which is a separate set."},
		},
	},
	{
		ID: "parameter.list", Capability: model.CapParameterAdmin,
		Port: "ParameterAdmin", Method: "ListRuntimeParameters",
		Blast: BlastRead, Summary: "Read the component configuration the broker stores for its plugins.",
		Result: reflect.TypeFor[[]*model.RuntimeParameter](),
	},
	{
		ID: "parameter.remove", Capability: model.CapParameterAdmin,
		Port: "ParameterAdmin", Method: "RemoveRuntimeParameter",
		Blast: BlastMutate,
		Summary: "Remove one stored parameter. There is no setter, deliberately: a " +
			"parameter's shape belongs to the plugin that owns it, and a generic setter " +
			"would write configuration nothing validates.",
		Params: []Param{
			{Name: "component", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The component that owns it."},
			{Name: "namespace", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The namespace it is stored under."},
			{Name: "name", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The parameter name."},
		},
	},
	{
		ID: "definitions.export", Capability: model.CapDefinitionsExport,
		Port: "DefinitionsAdmin", Method: "ExportDefinitions",
		Blast: BlastRead, Summary: "Export the broker's whole topology as one document. Everything except the messages.",
		Params: []Param{
			{Name: "namespace", Type: reflect.TypeFor[string](), Required: false,
				Summary: "Narrow to one namespace; empty is the whole broker."},
		},
		Result: reflect.TypeFor[*model.Definitions](),
	},
	{
		ID: "definitions.import", Capability: model.CapDefinitionsImport,
		Port: "DefinitionsAdmin", Method: "ImportDefinitions",
		Blast: BlastMutate,
		Summary: "Apply a topology document. Additive, not a replace: anything the document " +
			"names is created or overwritten and anything it omits is left alone, so this " +
			"cannot make a cluster match a file.",
		Params: []Param{
			{Name: "namespace", Type: reflect.TypeFor[string](), Required: false,
				Summary: "The namespace to import into."},
			{Name: "document", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The definitions document."},
		},
	},
	{
		ID: "replication.shovels", Capability: model.CapReplication,
		Port: "ReplicationAdmin", Method: "ListShovels",
		Blast: BlastRead, Summary: "List the links moving messages to or from another broker.",
		Result: reflect.TypeFor[[]*model.Shovel](),
	},
	{
		ID: "replication.removeShovel", Capability: model.CapReplication,
		Port: "ReplicationAdmin", Method: "RemoveShovel",
		Blast: BlastDestructive,
		Summary: "Delete a shovel. Messages already moved stay where they went; nothing " +
			"moves after this. There is no create here, because defining one means storing " +
			"another broker's credentials in a URI this application cannot verify.",
		Params: []Param{
			{Name: "namespace", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The namespace holding it."},
			{Name: "name", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The shovel name."},
		},
	},
	{
		ID: "replication.upstreams", Capability: model.CapReplication,
		Port: "ReplicationAdmin", Method: "ListFederationUpstreams",
		Blast: BlastRead, Summary: "List the federation upstreams this broker pulls from.",
		Result: reflect.TypeFor[[]*model.FederationUpstream](),
	},
	{
		ID: "replication.removeUpstream", Capability: model.CapReplication,
		Port: "ReplicationAdmin", Method: "RemoveFederationUpstream",
		Blast: BlastDestructive, Summary: "Delete a federation upstream, which stops what it was feeding.",
		Params: []Param{
			{Name: "namespace", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The namespace holding it."},
			{Name: "name", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The upstream name."},
		},
	},

	// Routing, which only a family with exchanges and bindings has.
	{
		ID: "routing.exchanges", Capability: model.CapRouting,
		Port: "RoutingAdmin", Method: "ListExchanges",
		Blast: BlastRead, Summary: "List the exchanges in a namespace.",
		Params: []Param{
			{Name: "namespace", Type: reflect.TypeFor[string](), Required: false,
				Summary: "The namespace; empty is the connection's own scope."},
		},
		Result: reflect.TypeFor[[]*model.Destination](),
	},
	{
		ID: "routing.bindings", Capability: model.CapRouting,
		Port: "RoutingAdmin", Method: "ListBindings",
		Blast: BlastRead, Summary: "List the bindings in a namespace.",
		Params: []Param{
			{Name: "namespace", Type: reflect.TypeFor[string](), Required: false,
				Summary: "The namespace; empty is the connection's own scope."},
		},
		Result: reflect.TypeFor[[]*model.Binding](),
	},
	{
		ID: "routing.declareExchange", Capability: model.CapRoutingAdmin,
		Port: "RoutingMutator", Method: "DeclareExchange",
		Blast: BlastMutate, Summary: "Declare an exchange.",
		Request: reflect.TypeFor[model.ExchangeSpec](),
	},
	{
		ID: "routing.removeExchange", Capability: model.CapRoutingAdmin,
		Port: "RoutingMutator", Method: "RemoveExchange",
		Blast: BlastDestructive,
		Summary: "Delete an exchange. Publishers that were routing through it start failing " +
			"or start discarding, depending on how they publish.",
		Params: []Param{
			{Name: "namespace", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The namespace holding it."},
			{Name: "name", Type: reflect.TypeFor[string](), Required: true,
				Summary: "The exchange name."},
		},
	},
	{
		ID: "routing.declareBinding", Capability: model.CapRoutingAdmin,
		Port: "RoutingMutator", Method: "DeclareBinding",
		Blast: BlastMutate, Summary: "Bind a queue or exchange to an exchange.",
		Request: reflect.TypeFor[model.Binding](),
	},
	{
		ID: "routing.removeBinding", Capability: model.CapRoutingAdmin,
		Port: "RoutingMutator", Method: "RemoveBinding",
		Blast: BlastDestructive,
		Summary: "Remove a binding. Nothing reports an error afterwards: messages that used " +
			"to arrive simply stop, and the publisher is told nothing.",
		Request: reflect.TypeFor[model.Binding](),
	},
}
