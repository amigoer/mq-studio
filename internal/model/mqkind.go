package model

// MQKind identifies a broker family.
//
// The values are the key for the driver registry, the per-kind settings
// defaults and the `kind` field in connections.json, so they are part of the
// on-disk format and must not be renamed.
type MQKind string

const (
	KindRocketMQ    MQKind = "rocketmq"
	KindKafka       MQKind = "kafka"
	KindRabbitMQ    MQKind = "rabbitmq"
	KindPulsar      MQKind = "pulsar"
	KindActiveMQ    MQKind = "activemq"
	KindRedisStream MQKind = "redis-stream"
	KindNATS        MQKind = "nats"
	KindNSQ         MQKind = "nsq"
	KindMQTT        MQKind = "mqtt"

	// Hosted families authenticate through Options and Secrets rather than
	// Endpoints: there is no broker address to dial, only a region and a
	// credential.
	KindSQS             MQKind = "sqs"
	KindGooglePubSub    MQKind = "google-pubsub"
	KindAzureServiceBus MQKind = "azure-servicebus"
	KindKinesis         MQKind = "kinesis"
	KindIBMMQ           MQKind = "ibmmq"
	KindSolace          MQKind = "solace"
)

// KnownKinds lists every family the vocabulary covers, in the order the UI
// offers them. A kind being listed here does not mean a driver is registered
// for it; the driver registry is the authority on what can actually connect.
func KnownKinds() []MQKind {
	return []MQKind{
		KindRocketMQ, KindKafka, KindRabbitMQ, KindPulsar, KindActiveMQ,
		KindRedisStream, KindNATS, KindNSQ, KindMQTT,
		KindSQS, KindGooglePubSub, KindAzureServiceBus, KindKinesis,
		KindIBMMQ, KindSolace,
	}
}

// displayNames are the families' own brand spellings. They are proper nouns
// rather than UI copy, so they are not translated and the Go side may own
// them; frontend/src/design/data/protocols.ts spells the six it draws boards
// for the same way.
var displayNames = map[MQKind]string{
	KindRocketMQ:        "RocketMQ",
	KindKafka:           "Kafka",
	KindRabbitMQ:        "RabbitMQ",
	KindPulsar:          "Pulsar",
	KindActiveMQ:        "ActiveMQ",
	KindRedisStream:     "Redis Stream",
	KindNATS:            "NATS",
	KindNSQ:             "NSQ",
	KindMQTT:            "MQTT",
	KindSQS:             "Amazon SQS",
	KindGooglePubSub:    "Google Pub/Sub",
	KindAzureServiceBus: "Azure Service Bus",
	KindKinesis:         "Amazon Kinesis",
	KindIBMMQ:           "IBM MQ",
	KindSolace:          "Solace",
}

// DisplayName spells the family for a reader. An unknown kind is its own name:
// a profile stored by a newer build should still be nameable by an older one.
func (k MQKind) DisplayName() string {
	if name, known := displayNames[k]; known {
		return name
	}
	return string(k)
}
