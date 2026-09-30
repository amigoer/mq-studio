package catalog

import "github.com/amigoer/mq-studio/internal/model"

// ValueType is what a family attribute holds, as opposed to how it travels.
//
// Everything in an attribute map is a string on the wire, because the map is
// map[string]string and the drivers parse out of it. That is exactly why the
// type has to be written down: "5000" and "true" are indistinguishable to a
// caller reading the map, and a caller composing one has no way to find out
// that maxDepth is a number and durable is not.
type ValueType string

const (
	ValueString ValueType = "string"
	ValueInt    ValueType = "int"
	ValueBool   ValueType = "bool"
	// ValueEnum is a string from a closed set, which Values lists.
	ValueEnum ValueType = "enum"
	// ValueJSON is a string holding a JSON document, which a driver decodes.
	ValueJSON ValueType = "json"
)

// Attribute is one key a family accepts inside a write's attribute map.
type Attribute struct {
	Key      string
	Type     ValueType
	Required bool
	// Values is the closed set, for ValueEnum only.
	Values []string
	// Default is what the driver assumes when the key is absent. Empty when
	// absence means the broker's own default rather than one this application
	// applies.
	Default string
	Summary string
}

/*
 * attributes is what each family reads out of a write's attribute map.
 *
 * This is the part of a request that is not family-neutral, and the only part
 * of one this package declares itself. Everything else about a request is
 * already declared in internal/model, where the fields carry their own names
 * and types; inside the map there is nothing - the keys are string literals
 * the driver matches, and a caller cannot discover them by reading the type.
 *
 * Only the write side is here. A listing returns far more keys than these -
 * several hundred across the families - but a caller reading a result does not
 * have to know them in advance: they arrive with their values, named. A caller
 * composing a write has nothing to go on at all, which is the gap this closes.
 *
 * The keys are a contract with the drivers. Each block names the file that
 * reads them, and the driver tests are what keep the two in step.
 */
var attributes = map[model.MQKind]map[string][]Attribute{
	// internal/driver/rocketmq/destination.go and subscription.go
	model.KindRocketMQ: {
		"destination.create": rocketMQDestination,
		"destination.update": rocketMQDestination,
		"subscription.create": {
			{Key: "brokerAddr", Type: ValueString,
				Summary: "The broker to write the subscription to; empty means every broker in the cluster."},
			{Key: "consumeMode", Type: ValueEnum, Values: []string{"CLUSTERING", "BROADCASTING"},
				Summary: "Whether the group shares the queues or every member reads all of them."},
			{Key: "maxRetry", Type: ValueInt,
				Summary: "How many times a message is retried before it is dead-lettered."},
		},
	},

	// internal/driver/rabbitmq/destination.go
	model.KindRabbitMQ: {
		"destination.create": rabbitMQDestination,
		"destination.update": rabbitMQDestination,
	},

	// internal/driver/kafka/topic.go
	model.KindKafka: {
		"destination.create": {
			{Key: "replicationFactor", Type: ValueInt,
				Summary: "How many brokers hold each partition. It cannot be changed by an update: " +
					"moving replicas is a reassignment."},
		},
	},

	// internal/driver/redisstream/subscription.go
	model.KindRedisStream: {
		"subscription.create": {
			{Key: "startId", Type: ValueString, Default: "$",
				Summary: "Where the group starts reading. An entry id, 0 for the whole log, " +
					"or $ for entries added after it exists."},
		},
	},

	// internal/driver/pulsar/topic.go and subscription.go
	model.KindPulsar: {
		"destination.create": pulsarDestination,
		"destination.update": pulsarDestination,
		"subscription.create": {
			{Key: "pulsarSubscriptionStartAt", Type: ValueEnum, Values: []string{"earliest", "latest"},
				Default: "earliest",
				Summary: "Where the subscription's cursor starts."},
		},
	},

	// internal/driver/activemq/subscription.go
	model.KindActiveMQ: {
		"subscription.create": {
			{Key: "topic", Type: ValueString, Required: true,
				Summary: "The topic the durable subscription reads."},
			{Key: "selector", Type: ValueString,
				Summary: "A JMS selector narrowing what it receives."},
		},
	},

	// internal/driver/sqs/destination_admin.go
	model.KindSQS: {
		"destination.create": sqsDestination,
		"destination.update": sqsDestination,
	},

	// internal/driver/googlepubsub/subscription.go
	model.KindGooglePubSub: {
		"subscription.create": {
			{Key: "topic", Type: ValueString, Required: true,
				Summary: "The topic this subscription reads. A subscription is its own object here, " +
					"so the topic is a field rather than part of the name."},
			{Key: "filter", Type: ValueString,
				Summary: "A filter expression narrowing what is delivered."},
			{Key: "messageOrdering", Type: ValueBool,
				Summary: "Deliver messages sharing an ordering key in the order they were published."},
			{Key: "pushEndpoint", Type: ValueString,
				Summary: "An HTTPS endpoint to push to; empty makes it a pull subscription."},
		},
	},

	// internal/driver/kinesis/destination_admin.go
	model.KindKinesis: {
		"destination.create": kinesisDestination,
		"destination.update": kinesisDestination,
	},

	// internal/driver/ibmmq/destination_admin.go
	model.KindIBMMQ: {
		"destination.create": ibmMQDestination,
		"destination.update": ibmMQDestination,
	},

	// internal/driver/solace/destination_admin.go
	model.KindSolace: {
		"destination.create": solaceDestination,
		"destination.update": solaceDestination,
	},
}

var rocketMQDestination = []Attribute{
	{Key: "brokerAddr", Type: ValueString,
		Summary: "The broker to write the topic to; empty means every broker in the cluster."},
	{Key: "readQueue", Type: ValueInt,
		Summary: "How many queues consumers may read."},
	{Key: "writeQueue", Type: ValueInt,
		Summary: "How many queues producers may write."},
	{Key: "perm", Type: ValueString,
		Summary: "The permission bits, as the broker spells them."},
}

var rabbitMQDestination = []Attribute{
	{Key: "durable", Type: ValueBool, Default: "true",
		Summary: "Survive a broker restart."},
	{Key: "autoDelete", Type: ValueBool, Default: "false",
		Summary: "Delete the queue once its last consumer goes."},
	{Key: "queueType", Type: ValueEnum, Values: []string{"classic", "quorum", "stream"},
		Summary: "Which queue implementation. It is fixed at declaration: changing it means " +
			"deleting the queue and declaring it again."},
	{Key: "arguments", Type: ValueJSON,
		Summary: "The x-arguments as a JSON object. Fixed at declaration too, which is why a " +
			"live queue's TTL or dead-letter exchange is changed with a policy instead."},
}

var pulsarDestination = []Attribute{
	{Key: "pulsarPersistent", Type: ValueBool, Default: "true",
		Summary: "Whether the topic is persistent. It is part of the topic's address, not a " +
			"setting on it, so it cannot be changed afterwards."},
}

var sqsDestination = []Attribute{
	{Key: "fifo", Type: ValueBool,
		Summary: "Whether this is a FIFO queue. SQS decides from the name - the .fifo suffix is " +
			"required on one and refused on the other - so this is checked against the name " +
			"rather than sent, and a disagreement is refused."},
	{Key: "visibilityTimeoutSec", Type: ValueInt,
		Summary: "How long a received message stays invisible to other consumers."},
	{Key: "delaySec", Type: ValueInt,
		Summary: "How long the queue holds a new message before delivering it."},
	{Key: "retentionSec", Type: ValueInt,
		Summary: "How long a message is kept before the queue discards it."},
	{Key: "maxMessageBytes", Type: ValueInt,
		Summary: "The largest message the queue accepts."},
	{Key: "receiveWaitSec", Type: ValueInt,
		Summary: "How long a receive waits for a message before returning empty."},
	{Key: "contentBasedDeduplication", Type: ValueBool,
		Summary: "FIFO only: deduplicate on the body rather than on a supplied id."},
	{Key: "deduplicationScope", Type: ValueString,
		Summary: "FIFO only: whether deduplication is per message group or per queue."},
	{Key: "fifoThroughputLimit", Type: ValueString,
		Summary: "FIFO only: whether throughput is limited per queue or per message group."},
	{Key: "deadLetterQueue", Type: ValueString,
		Summary: "The queue name to dead-letter into. The name is resolved to its ARN here, " +
			"because that is what SQS wants and the name is what a person picks."},
	{Key: "maxReceiveCount", Type: ValueInt, Default: "5",
		Summary: "How many receives before a message is dead-lettered. Only read when a " +
			"dead-letter queue is named."},
}

var kinesisDestination = []Attribute{
	{Key: "streamMode", Type: ValueEnum, Values: []string{"ON_DEMAND", "PROVISIONED"},
		Summary: "On-demand streams have no shard count to set; provisioned ones take the " +
			"partition count as their shard count."},
}

var ibmMQDestination = []Attribute{
	{Key: "kind", Type: ValueEnum, Values: []string{"queue", "topic"},
		Default: "queue",
		Summary: "Which object to define. A topic takes a topic string instead of a queue type."},
	{Key: "queueType", Type: ValueString,
		Summary: "The queue type, for kind=queue."},
	{Key: "topicString", Type: ValueString,
		Summary: "The topic string, for kind=topic. Required there: it is what applications " +
			"actually publish to, and it is not the object's name."},
	{Key: "maxDepth", Type: ValueInt,
		Summary: "The most messages the queue will hold, for kind=queue."},
	{Key: "description", Type: ValueString,
		Summary: "The description the queue manager stores."},
}

var solaceDestination = []Attribute{
	{Key: "owner", Type: ValueString,
		Summary: "The client username that owns the queue."},
	{Key: "deadMsgQueue", Type: ValueString,
		Summary: "The dead message queue to route to."},
}

// Attributes returns the family keys a write carries, for one family and one
// operation. It is empty for every read, for every family-neutral write, and
// for a family that accepts no keys on that operation - all three mean the
// same thing to a caller: send the canonical request and nothing else.
func Attributes(kind model.MQKind, operationID string) []Attribute {
	return attributes[kind][operationID]
}
