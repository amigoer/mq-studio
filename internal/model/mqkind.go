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
	KindRedisStream MQKind = "redis-stream"
	KindMQTT        MQKind = "mqtt"
)

// KnownKinds lists every family the vocabulary covers, in the order the UI
// offers them. A kind being listed here does not mean a driver is registered
// for it; the driver registry is the authority on what can actually connect.
func KnownKinds() []MQKind {
	return []MQKind{KindRocketMQ, KindKafka, KindRabbitMQ, KindPulsar, KindRedisStream, KindMQTT}
}
