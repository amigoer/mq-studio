package kafka

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"

	"github.com/amigoer/mq-studio/internal/model"
)

// Acks is how many replicas must have the record before the broker answers.
//
// The one setting on this page that changes what a confirmation means, so it
// is a choice rather than a default: with none, the send console reports
// success for a record the cluster may never have kept.
type Acks string

const (
	// AcksNone does not wait at all. The fastest, and the only one where a
	// reported success is not evidence of anything.
	AcksNone Acks = "none"
	// AcksLeader waits for the partition leader only. A record confirmed this
	// way is lost if that leader fails before its followers catch up.
	AcksLeader Acks = "leader"
	// AcksAll waits for every in-sync replica, which is what min.insync.replicas
	// is measured against.
	AcksAll Acks = "all"
)

// RecordRequest is a Kafka publish as the send console collects it.
//
// Deliberately not model.PublishRequest. That one is AMQP's: an exchange, a
// routing key, mandatory, persistent, a per-message TTL and a priority, none
// of which Kafka has. What a Kafka record has instead is a partition it can be
// pinned to, a key that decides the partition when it is not, and an
// acknowledgement level that decides what a confirmation is worth.
type RecordRequest struct {
	Topic string
	// Partition pins the record. Nil lets the key decide, which is what
	// ordering by key depends on.
	Partition *int32
	// Key nil is not the same as empty: a record with no key is spread across
	// partitions, one with an empty key is pinned like any other.
	Key     *string
	Value   string
	Headers map[string]string
	// Timestamp in milliseconds. Zero lets the producer stamp it now, and a
	// topic configured for LogAppendTime overrides it either way.
	Timestamp int64

	Acks Acks
	// Count sends the same record more than once, for filling a topic to test
	// a consumer.
	Count int
}

// RecordResult is what the cluster did with the send.
type RecordResult struct {
	// Sent is how many the cluster acknowledged.
	Sent int `json:"sent"`
	// Partition and Offset are where the last one landed. They are the whole
	// reason to report anything: an operator who just sent a record can go and
	// read it back by those coordinates.
	Partition int32 `json:"partition"`
	Offset    int64 `json:"offset"`
	// Failed is how many the cluster refused, and Reason is its words for the
	// last refusal.
	Failed int    `json:"failed"`
	Reason string `json:"reason"`
}

// SendMessage is the canonical publish.
//
// Tags and a delay level are RocketMQ's and Kafka has neither. A delay is
// refused rather than ignored: a send console that quietly dropped it would
// report success for a record that was delivered immediately, which is the
// opposite of what was asked for. Tags are absent from the Kafka form, so
// nothing sends one.
func (c *Conn) SendMessage(
	ctx context.Context, topic, tags, keys, body string, delayLevel int,
) (string, error) {
	if delayLevel != 0 {
		return "", fmt.Errorf("kafka has no delayed delivery")
	}
	if tags != "" {
		return "", fmt.Errorf("kafka records have no tags; use a header instead")
	}

	request := RecordRequest{Topic: topic, Value: body, Acks: AcksAll, Count: 1}
	if keys != "" {
		key := keys
		request.Key = &key
	}
	result, err := c.SendRecord(ctx, request)
	if err != nil {
		return "", err
	}
	return messageID(topic, result.Partition, result.Offset), nil
}

/*
 * SendRecord publishes with everything Kafka carries and reports where it
 * landed.
 *
 * A producer of its own, built and closed per send, because the acknowledgement
 * level belongs to the client rather than to the request and this page lets it
 * be chosen. Idempotence is off for the same reason it has to be: it requires
 * acks=all, and a console that silently upgraded acks=1 to acks=all would be
 * reporting a durability the operator did not ask for.
 */
func (c *Conn) SendRecord(ctx context.Context, request RecordRequest) (*RecordResult, error) {
	if strings.TrimSpace(request.Topic) == "" {
		return nil, fmt.Errorf("a topic is required")
	}
	count := request.Count
	if count <= 0 {
		count = 1
	}

	options, err := dialOptions(c.config)
	if err != nil {
		return nil, err
	}
	options = append(options, acksOption(request.Acks)...)
	if request.Partition != nil {
		// Without this the producer picks a partition itself and the pin is
		// ignored, which would silently send the record somewhere else.
		options = append(options, manualPartitioner())
	}
	client, err := kgo.NewClient(options...)
	if err != nil {
		return nil, err
	}
	defer client.Close()

	records := make([]*kgo.Record, 0, count)
	for i := 0; i < count; i++ {
		records = append(records, recordFrom(request))
	}

	result := &RecordResult{Partition: model.UnknownMetric, Offset: model.UnknownMetric}
	produced := client.ProduceSync(ctx, records...)
	for _, one := range produced {
		if one.Err != nil {
			result.Failed++
			result.Reason = one.Err.Error()
			continue
		}
		result.Sent++
		result.Partition = one.Record.Partition
		result.Offset = one.Record.Offset
	}

	// acks=none means the cluster was never asked, so there is nothing to
	// report about where the record landed. Saying so beats printing the -1
	// the producer filled in.
	if request.Acks == AcksNone {
		result.Partition = model.UnknownMetric
		result.Offset = model.UnknownMetric
	}
	return result, nil
}

func recordFrom(request RecordRequest) *kgo.Record {
	record := &kgo.Record{Topic: request.Topic, Value: []byte(request.Value)}
	if request.Key != nil {
		record.Key = []byte(*request.Key)
	}
	if request.Partition != nil {
		record.Partition = *request.Partition
	}
	if request.Timestamp > 0 {
		record.Timestamp = time.UnixMilli(request.Timestamp)
	}
	for name, value := range request.Headers {
		record.Headers = append(record.Headers, kgo.RecordHeader{Key: name, Value: []byte(value)})
	}
	return record
}

// acksOption turns the choice into producer settings.
//
// Idempotence has to be disabled below acks=all: franz-go requires the two
// together, and forcing acks up to keep idempotence would give the operator a
// guarantee they did not ask for and a latency they did not expect.
func acksOption(acks Acks) []kgo.Opt {
	switch acks {
	case AcksNone:
		return []kgo.Opt{kgo.RequiredAcks(kgo.NoAck()), kgo.DisableIdempotentWrite()}
	case AcksLeader:
		return []kgo.Opt{kgo.RequiredAcks(kgo.LeaderAck()), kgo.DisableIdempotentWrite()}
	default:
		return []kgo.Opt{kgo.RequiredAcks(kgo.AllISRAcks())}
	}
}

// manualPartitioner tells the producer to honour the partition set on the
// record rather than choosing one. Only used when the console pinned a
// partition: applying it always would stop a key from deciding, which is what
// ordering by key depends on.
func manualPartitioner() kgo.Opt {
	return kgo.RecordPartitioner(kgo.ManualPartitioner())
}
