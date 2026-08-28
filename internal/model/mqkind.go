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
