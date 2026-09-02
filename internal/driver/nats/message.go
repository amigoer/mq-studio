package nats

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	natsclient "github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/timestamp"
)

// Filter keys the message query accepts beyond the canonical fields.
//
// A contract between this package and frontend/src/mq/nats, the same as the
// attribute keys: what "subject" means here is NATS's business.
const (
	FilterSubject     = "subject"
	FilterStartSeq    = "startSeq"
	FilterHeaderName  = "headerName"
	FilterHeaderValue = "headerValue"
)

// maxBrowse bounds one page of a browse.
//
// Each message is fetched in full, body and all, so the cap is about memory in
// this process rather than about what the server will do. The page asks for
// what it can draw.
const maxBrowse = 500

// browseTimeout is how long a browse waits for the messages it asked for.
//
// A short wait rather than the request deadline: an ordered consumer that has
// reached the end of the stream simply stops answering, and that is the
// ordinary end of a browse rather than a failure. Waiting the full timeout
// would make every browse of a short stream take as long as the timeout.
const browseTimeout = 2 * time.Second

// QueryMessages browses a stream.
//
// Through an ordered ephemeral consumer rather than a series of gets: a get
// addresses one sequence, and a browse that walked sequences one at a time
// would make a round trip per message and would skip nothing that had been
// deleted - so a page of fifty over a stream with gaps could cost hundreds of
// requests. An ordered consumer is created, drained and discarded by the
// library, and asks the server to do the walking.
func (c *Conn) QueryMessages(ctx context.Context, params model.MessageQueryParams) ([]*model.MessageItem, error) {
	if err := c.requireJetStream(); err != nil {
		return nil, err
	}
	streamName := strings.TrimSpace(params.Topic)
	if streamName == "" {
		return nil, errStreamRequired
	}

	// A message id names one message outright, and the rest of the query
	// cannot narrow that further - so it is answered as a lookup rather than
	// as a browse that happens to match one.
	if id := strings.TrimSpace(params.MessageID); id != "" {
		item, err := c.MessageByID(ctx, streamName, id)
		if err != nil {
			return nil, err
		}
		return []*model.MessageItem{item}, nil
	}

	stream, err := c.js.Stream(ctx, streamName)
	if err != nil {
		return nil, streamError(streamName, err)
	}
	// The stream's own last sequence is what ends the walk. Without it a
	// browse of a stream shorter than the page size would sit waiting for the
	// fetch timeout every time - correct, and two seconds slower than it needs
	// to be on every page of every short stream.
	info, err := stream.Info(ctx)
	if err != nil {
		return nil, streamError(streamName, err)
	}

	config, err := browseConfig(params)
	if err != nil {
		return nil, err
	}
	consumer, err := stream.OrderedConsumer(ctx, config)
	if err != nil {
		return nil, streamError(streamName, err)
	}

	limit := params.MaxResults
	if limit <= 0 || limit > maxBrowse {
		limit = maxBrowse
	}

	// Where the walk ends. With a subject filter the consumer will never
	// deliver the stream's last message unless it happens to match, so the
	// bound has to be the last *matching* one - otherwise every filtered
	// browse sits out the fetch timeout, and one that matches nothing sits out
	// the timeout to return an empty list.
	last, err := lastMatching(ctx, stream, info, config.FilterSubjects)
	if err != nil {
		return nil, streamError(streamName, err)
	}
	if last == 0 {
		return []*model.MessageItem{}, nil
	}

	// One message at a time rather than a batch.
	//
	// Fetch(n) waits until n messages have arrived or its deadline passes, so
	// a page of fifty over a stream holding three would wait out the deadline
	// every single time - two seconds on every browse of every short stream,
	// and on every filtered browse, because the filter is what makes a stream
	// short from the consumer's point of view. An iterator returns each
	// message as it arrives, and the last matching sequence above is what
	// tells the loop when to stop instead of a timeout.
	iterator, err := consumer.Messages()
	if err != nil {
		return nil, streamError(streamName, err)
	}
	defer iterator.Stop()

	// Next has no context of its own, so the request deadline is applied by
	// stopping the iterator when it passes - which makes Next return.
	done := make(chan struct{})
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			iterator.Stop()
		case <-done:
		}
	}()

	items := make([]*model.MessageItem, 0, limit)
	end := endBefore(params)
	for len(items) < limit {
		message, err := iterator.Next()
		if err != nil {
			// The iterator was stopped, which here means the deadline passed.
			// What has been collected is still worth showing.
			return items, nil
		}
		meta, err := message.Metadata()
		if err != nil {
			continue
		}
		// The end of the window stops the walk rather than filtering: the
		// stream is in order, so everything after this is later too.
		if !end.IsZero() && meta.Timestamp.After(end) {
			return items, nil
		}
		if matchesHeader(message, params.Filters) {
			items = append(items, messageItem(streamName, message.Subject(), message.Headers(),
				message.Data(), meta.Sequence.Stream, meta.Timestamp))
		}
		// The last message this browse could be delivered. Stopping here is
		// what keeps a short or heavily filtered stream fast.
		if meta.Sequence.Stream >= last {
			break
		}
	}
	return items, nil
}

// browseConfig turns the query into where the walk starts and what it takes.
func browseConfig(params model.MessageQueryParams) (jetstream.OrderedConsumerConfig, error) {
	config := jetstream.OrderedConsumerConfig{DeliverPolicy: jetstream.DeliverAllPolicy}

	if subjects := splitSubjects(params.Filters[FilterSubject]); len(subjects) > 0 {
		for _, subject := range subjects {
			if err := validateSubject(subject); err != nil {
				return config, err
			}
		}
		config.FilterSubjects = subjects
	}

	// A sequence is exact where a time is approximate, so it wins where both
	// were given: somebody who typed a sequence knows which message they mean.
	if raw := strings.TrimSpace(params.Filters[FilterStartSeq]); raw != "" {
		sequence, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			return config, fmt.Errorf(
				"%q is not a jetstream sequence; a message is addressed by one number for the whole stream", raw)
		}
		config.DeliverPolicy = jetstream.DeliverByStartSequencePolicy
		config.OptStartSeq = sequence
		return config, nil
	}

	if params.StartTime > 0 {
		start := time.UnixMilli(params.StartTime)
		config.DeliverPolicy = jetstream.DeliverByStartTimePolicy
		config.OptStartTime = &start
	}
	return config, nil
}

// endBefore is the far edge of the window, or the zero time when there is none.
func endBefore(params model.MessageQueryParams) time.Time {
	if params.EndTime <= 0 {
		return time.Time{}
	}
	return time.UnixMilli(params.EndTime)
}

// matchesHeader narrows by a header, which the server cannot do.
//
// JetStream filters by subject and by nothing else, so this is applied here
// after the message has arrived. It is honest about the cost: the messages are
// fetched either way, and what the filter saves is the reader's attention
// rather than the network.
func matchesHeader(message jetstream.Msg, filters map[string]string) bool {
	name := strings.TrimSpace(filters[FilterHeaderName])
	if name == "" {
		return true
	}
	values := message.Headers().Values(name)
	wanted := filters[FilterHeaderValue]
	if wanted == "" {
		return len(values) > 0
	}
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}

// MessageByID reads one message by its sequence.
//
// A sequence, because that is the only handle JetStream gives a message: there
// is no broker-assigned identifier, and the Nats-Msg-Id header a publisher may
// set is for deduplication rather than lookup - the server keeps it only for
// the duplicate window and indexes nothing by it.
func (c *Conn) MessageByID(ctx context.Context, topic, messageID string) (*model.MessageItem, error) {
	if err := c.requireJetStream(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(topic) == "" {
		return nil, errStreamRequired
	}
	sequence, err := strconv.ParseUint(strings.TrimSpace(messageID), 10, 64)
	if err != nil {
		return nil, fmt.Errorf(
			"%q is not a jetstream sequence; a message is addressed by one number for the whole stream",
			messageID)
	}

	stream, err := c.js.Stream(ctx, topic)
	if err != nil {
		return nil, streamError(topic, err)
	}
	raw, err := stream.GetMsg(ctx, sequence)
	if err != nil {
		if errors.Is(err, jetstream.ErrMsgNotFound) {
			// Deleted or trimmed, and the two are indistinguishable from here.
			// Saying which sequence is what lets the reader tell whether they
			// are past the start of the stream.
			return nil, fmt.Errorf("stream %q holds no message at sequence %d", topic, sequence)
		}
		return nil, streamError(topic, err)
	}
	return messageItem(topic, raw.Subject, raw.Header, raw.Data, raw.Sequence, raw.Time), nil
}

// TailMessages returns what has arrived since the cursor.
//
// The cursor is one position, not one per partition: a stream has a single
// sequence and a single order, so there is nothing to track separately. The
// canonical shape carries a list and this fills in one entry, which is the
// honest reading rather than a shortcut - a second entry would imply a
// parallelism the family does not have.
func (c *Conn) TailMessages(ctx context.Context, ref model.DestinationRef, cursor model.TailCursor, limit int) (*model.TailBatch, error) {
	if err := c.requireJetStream(); err != nil {
		return nil, err
	}
	stream, err := c.js.Stream(ctx, ref.Name)
	if err != nil {
		return nil, streamError(ref.Name, err)
	}
	info, err := stream.Info(ctx)
	if err != nil {
		return nil, streamError(ref.Name, err)
	}

	if limit <= 0 || limit > maxBrowse {
		limit = maxBrowse
	}

	// A first poll starts at the end. A tail is for watching what arrives, and
	// one that began by replaying a million messages would be a browse wearing
	// the wrong name.
	after := tailPosition(cursor)
	first := after == 0
	next := after + 1
	if first {
		next = info.State.LastSeq + 1
	}

	// What aged out between polls: the tail asked to resume below the oldest
	// message the stream still holds. Reporting it is the difference between a
	// quiet tail and one that is silently losing.
	var dropped int64
	if !first && next < info.State.FirstSeq {
		dropped = int64(info.State.FirstSeq - next)
		next = info.State.FirstSeq
	}

	batchCursor := model.TailCursor{Positions: []model.QueuePosition{{
		Node: streamLeader(info), QueueID: 0, Offset: int64(next) - 1,
	}}}

	// Nothing new. Returning early rather than opening a consumer that would
	// wait for the fetch timeout on every idle poll.
	if next > info.State.LastSeq {
		return &model.TailBatch{Messages: nil, Cursor: batchCursor, Dropped: dropped}, nil
	}

	consumer, err := stream.OrderedConsumer(ctx, jetstream.OrderedConsumerConfig{
		DeliverPolicy: jetstream.DeliverByStartSequencePolicy,
		OptStartSeq:   next,
	})
	if err != nil {
		return nil, streamError(ref.Name, err)
	}

	messages := make([]*model.MessageItem, 0, limit)
	highest := next - 1
	// Ask for no more than the stream actually holds past the cursor, so a
	// poll that can be answered in full never waits for the fetch timeout.
	available := int(info.State.LastSeq - next + 1)
	if available < limit {
		limit = available
	}
	batch, err := consumer.Fetch(limit, jetstream.FetchMaxWait(browseTimeout))
	if err != nil {
		return nil, err
	}
	for message := range batch.Messages() {
		meta, err := message.Metadata()
		if err != nil {
			continue
		}
		messages = append(messages, messageItem(ref.Name, message.Subject(), message.Headers(),
			message.Data(), meta.Sequence.Stream, meta.Timestamp))
		highest = meta.Sequence.Stream
	}
	if err := batch.Error(); err != nil {
		return nil, err
	}

	batchCursor.Positions[0].Offset = int64(highest)
	return &model.TailBatch{Messages: messages, Cursor: batchCursor, Dropped: dropped}, nil
}

// tailPosition reads the one sequence the cursor carries. Zero means a tail
// that has not started.
func tailPosition(cursor model.TailCursor) uint64 {
	if len(cursor.Positions) == 0 || cursor.Positions[0].Offset < 0 {
		return 0
	}
	return uint64(cursor.Positions[0].Offset)
}

// messageItem maps one message onto the canonical model.
//
// The canonical shape is RocketMQ's, and two of its fields are borrowed
// deliberately rather than left empty. Tags carries the subject, because a
// RocketMQ tag and a NATS subject are the same idea - the routing label inside
// a destination - and leaving the column blank would hide the single most
// important thing about a NATS message. QueueOffset carries the sequence,
// because that is what addresses it.
//
// QueueID is UnknownMetric. A stream has no partitions, and a zero there would
// read as partition zero of several.
func messageItem(stream, subject string, header natsclient.Header, body []byte, sequence uint64, at time.Time) *model.MessageItem {
	properties := make(map[string]string, len(header))
	for name, values := range header {
		properties[name] = strings.Join(values, ", ")
	}

	return &model.MessageItem{
		ID:        int(sequence),
		Topic:     stream,
		MessageID: strconv.FormatUint(sequence, 10),
		// The subject, under the canonical model's routing-label field.
		Tags:    subject,
		QueueID: model.UnknownMetric,
		// Nats-Msg-Id is what a publisher sets for deduplication. It is not an
		// address - the server keeps it only for the duplicate window - so it
		// travels as a key rather than as the id.
		Keys:           header.Get(natsclient.MsgIdHdr),
		QueueOffset:    int64(sequence),
		StoreTime:      timestamp.FromTime(at),
		StoreTimestamp: at.UnixMilli(),
		// NATS has no retry or dead-letter state. A message is stored or it is
		// not, and reporting anything else would invent a lifecycle.
		Status:     model.MsgNormal,
		RetryTimes: model.UnknownMetric,
		Body:       string(body),
		Properties: properties,
	}
}

// streamLeader names the server the stream's state lives on, or nothing on a
// single server - which reports no cluster at all rather than a cluster of one.
func streamLeader(info *jetstream.StreamInfo) string {
	if info.Cluster == nil {
		return ""
	}
	return info.Cluster.Leader
}

// lastMatching is the highest sequence a browse can expect to be delivered.
//
// Without a filter that is the stream's own last sequence. With one it is the
// last message on any of the filtered subjects, which the server can answer
// per subject - a few extra requests, against a two-second wait per page
// otherwise. Zero means nothing matches, and the caller can stop before it
// opens a consumer at all.
func lastMatching(ctx context.Context, stream jetstream.Stream, info *jetstream.StreamInfo, filters []string) (uint64, error) {
	if len(filters) == 0 {
		return info.State.LastSeq, nil
	}
	var last uint64
	for _, subject := range filters {
		raw, err := stream.GetLastMsgForSubject(ctx, subject)
		if err != nil {
			// No message on that subject yet. Not a failure: the other
			// filters may still match, and if none do the caller returns an
			// empty page rather than an error.
			if errors.Is(err, jetstream.ErrMsgNotFound) {
				continue
			}
			return 0, err
		}
		if raw.Sequence > last {
			last = raw.Sequence
		}
	}
	return last, nil
}
