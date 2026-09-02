package bridge

import (
	"context"
	"strconv"

	natsdriver "github.com/amigoer/mq-studio/internal/driver/nats"
	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/service/nats"
)

// NATSService exposes what only NATS has.
//
// It is one service rather than several because it is one family's surface,
// the same reason MQTTService and KafkaService are one each.
//
// Reading streams is not here. A stream is a destination and TopicService
// already answers the whole read side; a second read path would be two sources
// for one number. What is here is the writing, which the canonical service
// cannot express: its create collects a broker address, a read queue, a write
// queue and a permission mask, and a JetStream stream has none of those.
type NATSService struct {
	service *nats.Service
}

// StreamInput is a stream as the dialog collects it.
//
// Deliberately not TopicService.Create's shape. Every field there is
// RocketMQ's vocabulary and none of it has a JetStream meaning, and there is
// nowhere in it to put a subject list, a retention policy, or a limit - which
// is most of what declaring a stream is.
//
// The limits are strings rather than numbers so that "not set" and "set to
// zero" stay different. -1 is how the server spells no limit, 0 means a stream
// that can hold nothing, and a numeric field that arrived empty would have to
// pick one of those for the user.
type StreamInput struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	// Subjects is the list the stream captures, however the form separated it.
	// A mirror has none.
	Subjects string `json:"subjects"`
	// Retention is limits, interest or workqueue. Work queue is the one where
	// reading the stream changes what it holds.
	Retention string `json:"retention"`
	Storage   string `json:"storage"`
	Discard   string `json:"discard"`
	Replicas  int    `json:"replicas"`

	MaxMsgs           string `json:"maxMsgs"`
	MaxBytes          string `json:"maxBytes"`
	MaxMsgsPerSubject string `json:"maxMsgsPerSubject"`
	MaxMsgSize        string `json:"maxMsgSize"`
	// MaxAge and DuplicateWindow are Go durations - "24h", "2m" - because that
	// is what the server reports and what an operator writes.
	MaxAge          string `json:"maxAge"`
	DuplicateWindow string `json:"duplicateWindow"`

	Compression string `json:"compression"`
	DenyDelete  bool   `json:"denyDelete"`
	DenyPurge   bool   `json:"denyPurge"`
	AllowRollup bool   `json:"allowRollup"`
}

func (input StreamInput) spec() model.DestinationSpec {
	attributes := map[string]string{
		natsdriver.AttrSubjects:    input.Subjects,
		natsdriver.AttrDescription: input.Description,
		natsdriver.AttrRetention:   input.Retention,
		natsdriver.AttrStorage:     input.Storage,
		natsdriver.AttrDiscard:     input.Discard,
		natsdriver.AttrMaxMsgs:     input.MaxMsgs,
		natsdriver.AttrMaxBytes:    input.MaxBytes,
		natsdriver.AttrMaxMsgsPer:  input.MaxMsgsPerSubject,
		natsdriver.AttrMaxMsgSize:  input.MaxMsgSize,
		natsdriver.AttrMaxAge:      input.MaxAge,
		natsdriver.AttrDuplicates:  input.DuplicateWindow,
		natsdriver.AttrCompression: input.Compression,
	}
	// Written only when true, because the driver reads a missing attribute as
	// false and writing "false" for every unset switch would fill the map with
	// noise that means nothing.
	if input.DenyDelete {
		attributes[natsdriver.AttrDenyDelete] = "true"
	}
	if input.DenyPurge {
		attributes[natsdriver.AttrDenyPurge] = "true"
	}
	if input.AllowRollup {
		attributes[natsdriver.AttrAllowRollup] = "true"
	}
	if input.Replicas > 0 {
		attributes[natsdriver.AttrReplicas] = strconv.Itoa(input.Replicas)
	}

	return model.DestinationSpec{
		Ref:        model.DestinationRef{Name: input.Name},
		Attributes: attributes,
	}
}

// CreateStream declares a stream that does not exist yet.
//
// Separate from UpdateStream rather than one idempotent call, because the two
// mistakes they prevent are different: a create that quietly became an update
// would rewrite another application's subjects, and an update that quietly
// became a create would hide a stream somebody had deleted underneath the
// page.
func (s *NATSService) CreateStream(connID int, input StreamInput) error {
	return s.service.SaveStream(context.Background(), connID, input.spec(), false)
}

// UpdateStream rewrites an existing stream's configuration.
//
// Some fields cannot change - storage, and the retention policy of a stream
// that already holds messages. The server refuses those itself and says which,
// which is why nothing here pre-empts it: a rule copied into the client is a
// rule that goes stale a release later.
func (s *NATSService) UpdateStream(connID int, input StreamInput) error {
	return s.service.SaveStream(context.Background(), connID, input.spec(), true)
}

// DeleteStream removes a stream and every message in it.
func (s *NATSService) DeleteStream(connID int, name string) error {
	return s.service.DeleteStream(context.Background(), connID, name)
}

// PurgeInput is a trim as the dialog collects it.
//
// The strategy is a string rather than two methods because it is one command
// with two ways of naming a bound, and a page that had to pick an endpoint
// before the user picked a strategy would be the wrong shape.
type PurgeInput struct {
	Stream   string `json:"stream"`
	Strategy string `json:"strategy"`
	// Keep is how many of the newest messages to leave, for the keep strategy.
	// Zero empties the stream, which is the only purge JetStream has - there
	// is no separate command, and offering one under another name would be two
	// controls for one thing.
	Keep int64 `json:"keep"`
	// Sequence is the lowest sequence to keep, for the sequence strategy.
	// Everything below it goes, and the message at it survives.
	Sequence string `json:"sequence"`
}

func (input PurgeInput) request() model.TrimRequest {
	return model.TrimRequest{
		Ref:      model.DestinationRef{Name: input.Stream},
		Strategy: model.TrimStrategy(input.Strategy),
		MaxLen:   input.Keep,
		MinID:    input.Sequence,
	}
}

// PurgeStream discards messages from a stream and reports how many went.
//
// The count is the report rather than a formality: it is the only way to tell
// a bound that already held from one that matched nothing at all, and those
// look identical on the page.
func (s *NATSService) PurgeStream(connID int, input PurgeInput) (*model.TrimResult, error) {
	return s.service.Trim(context.Background(), connID, input.request())
}

// DeleteMessages removes messages by sequence.
func (s *NATSService) DeleteMessages(connID int, stream string, sequences []string) (*model.TrimResult, error) {
	return s.service.DeleteMessages(context.Background(), connID, stream, sequences)
}

// NATSConsumerInput is a consumer as the NATS dialog collects it.
//
// The name carries the family because every bridge type shares one Go package
// and ConsumerService already has a ConsumerInput of its own - which is the
// RocketMQ-shaped one this exists instead of.
//
// Deliberately not ConsumerService.Create's shape. That collects a group name,
// a broker address, a consume mode and a retry count - RocketMQ's vocabulary -
// and has nowhere for the stream a JetStream consumer lives on, which is half
// of its address.
type NATSConsumerInput struct {
	// Stream is not optional. Two streams may both have a consumer called
	// "worker", so a name alone does not identify one.
	Stream string `json:"stream"`
	Name   string `json:"name"`
	// Durable keeps the consumer and its position when nothing is using it.
	// An ephemeral one is cleaned up, which is what makes this a choice rather
	// than a default.
	Durable bool `json:"durable"`

	// DeliverPolicy is where a new consumer starts. It cannot be changed
	// afterwards - the server refuses - which is why this driver offers no
	// offset reset.
	DeliverPolicy string `json:"deliverPolicy"`
	AckPolicy     string `json:"ackPolicy"`
	AckWait       string `json:"ackWait"`
	MaxDeliver    string `json:"maxDeliver"`
	MaxAckPending string `json:"maxAckPending"`
	// FilterSubject narrows what this consumer takes from the stream. Several
	// may be given, separated however the form separated them.
	FilterSubject string `json:"filterSubject"`
	ReplayPolicy  string `json:"replayPolicy"`

	// DeliverSubject makes it a push consumer: the server sends to that
	// subject instead of waiting to be asked. Empty is a pull consumer, which
	// is the ordinary case.
	DeliverSubject string `json:"deliverSubject"`
	DeliverGroup   string `json:"deliverGroup"`
}

func (input NATSConsumerInput) spec() model.SubscriptionSpec {
	attributes := map[string]string{
		natsdriver.AttrDeliverPolicy: input.DeliverPolicy,
		natsdriver.AttrAckPolicy:     input.AckPolicy,
		natsdriver.AttrAckWait:       input.AckWait,
		natsdriver.AttrMaxDeliver:    input.MaxDeliver,
		natsdriver.AttrMaxAckPending: input.MaxAckPending,
		natsdriver.AttrFilterSubject: input.FilterSubject,
		natsdriver.AttrReplayPolicy:  input.ReplayPolicy,
		natsdriver.AttrDeliverTo:     input.DeliverSubject,
		natsdriver.AttrDeliverGroup:  input.DeliverGroup,
	}
	// Written only when the answer is no. The driver reads a missing attribute
	// as durable, which is the safer default: an ephemeral consumer somebody
	// meant to keep disappears the moment nothing is using it.
	if !input.Durable {
		attributes[natsdriver.AttrDurable] = "false"
	}
	return model.SubscriptionSpec{
		Ref:        model.SubscriptionRef{Namespace: input.Stream, Name: input.Name},
		Attributes: attributes,
	}
}

// CreateConsumer declares a consumer that does not exist yet.
func (s *NATSService) CreateConsumer(connID int, input NATSConsumerInput) error {
	return s.service.SaveConsumer(context.Background(), connID, input.spec(), false)
}

// UpdateConsumer rewrites an existing consumer's configuration.
//
// Not its position: the server refuses to change where a consumer starts once
// it exists, and the only way to move one is to delete it and make another -
// which changes its identity and drops what it had acknowledged.
func (s *NATSService) UpdateConsumer(connID int, input NATSConsumerInput) error {
	return s.service.SaveConsumer(context.Background(), connID, input.spec(), true)
}

// DeleteConsumer removes a consumer and the position it held.
func (s *NATSService) DeleteConsumer(connID int, stream, name string) error {
	return s.service.DeleteConsumer(context.Background(), connID, stream, name)
}

// NATSPublishInput is a publish as the NATS send console collects it.
//
// Deliberately not MessageService.Publish's shape. That one carries an
// exchange, a routing key, a mandatory flag and a priority - AMQP's vocabulary
// - and has nowhere for a subject's headers, for the choice between a core
// send and a stored one, or for a reply timeout, which are most of what a NATS
// publish is.
type NATSPublishInput struct {
	Subject string            `json:"subject"`
	Payload string            `json:"payload"`
	Headers map[string]string `json:"headers"`
	// Count sends the same message more than once, for filling a board.
	Count int `json:"count"`

	// Persist waits for a stream to say it stored the message. Without it the
	// send is core NATS: it reaches whoever is listening at that instant and
	// the server says nothing back.
	Persist bool `json:"persist"`
	// ExpectStream refuses the send unless that stream is the one capturing
	// the subject, which is the guard against a typo landing somewhere else.
	ExpectStream string `json:"expectStream"`
	// DeduplicationID is Nats-Msg-Id, honoured inside the stream's duplicate
	// window.
	DeduplicationID string `json:"deduplicationId"`
	// ReplyTimeoutMs turns the send into a request and waits that long.
	ReplyTimeoutMs int `json:"replyTimeoutMs"`
}

func (input NATSPublishInput) request() natsdriver.PublishRequest {
	return natsdriver.PublishRequest{
		Subject:         input.Subject,
		Payload:         input.Payload,
		Headers:         input.Headers,
		Count:           input.Count,
		Persist:         input.Persist,
		ExpectStream:    input.ExpectStream,
		DeduplicationID: input.DeduplicationID,
		ReplyTimeoutMs:  input.ReplyTimeoutMs,
	}
}

// Publish sends a message and reports what the server said, which depends on
// how much was asked of it.
func (s *NATSService) Publish(connID int, input NATSPublishInput) (*natsdriver.PublishResult, error) {
	return s.service.Publish(context.Background(), connID, input.request())
}

// NATSSubscribeInput is a live subscription as the workbench asks for one.
type NATSSubscribeInput struct {
	// Subjects are patterns, so wildcards are the point here rather than the
	// mistake they are on a publish.
	Subjects []string `json:"subjects"`
	// QueueGroup shares the messages between everything subscribed under that
	// name instead of each receiving all of them. It is offered because
	// watching a subject a service is already consuming is otherwise a way to
	// take its traffic.
	QueueGroup string `json:"queueGroup"`
	// Buffer is how many messages to hold between polls. Zero takes the
	// driver's default.
	Buffer int `json:"buffer"`
}

func (input NATSSubscribeInput) spec() model.LiveSubscriptionSpec {
	filters := make([]model.LiveFilter, 0, len(input.Subjects))
	for _, subject := range input.Subjects {
		filter := model.LiveFilter{Pattern: subject}
		if input.QueueGroup != "" {
			filter.Options = map[string]string{natsdriver.LiveOptionQueueGroup: input.QueueGroup}
		}
		filters = append(filters, filter)
	}
	return model.LiveSubscriptionSpec{Filters: filters, Buffer: input.Buffer}
}

// StartSubscription begins following one or more subjects.
func (s *NATSService) StartSubscription(connID int, input NATSSubscribeInput) (*model.LiveSubscription, error) {
	return s.service.StartSubscription(context.Background(), connID, input.spec())
}

// PollSubscription drains what has arrived since the caller's cursor.
func (s *NATSService) PollSubscription(connID int, id string, after int64, limit int) (*model.LiveBatch, error) {
	return s.service.PollSubscription(context.Background(), connID, id, after, limit)
}

// StopSubscription ends one. Not optional: it lives on the server until it is
// stopped.
func (s *NATSService) StopSubscription(connID int, id string) error {
	return s.service.StopSubscription(context.Background(), connID, id)
}

// Subscriptions is what is running.
func (s *NATSService) Subscriptions(connID int) ([]*model.LiveSubscription, error) {
	return s.service.Subscriptions(context.Background(), connID)
}

// Census counts what the account holds.
func (s *NATSService) Census(connID int) (*model.BrokerCensus, error) {
	return s.service.Census(context.Background(), connID)
}

// Health runs the server's own checks.
//
// Three of them rather than one, because /healthz answers a different question
// per set of parameters: a server can be up and serving core NATS perfectly
// while its JetStream assets are still being recovered, and an operator needs
// to know which part is unhealthy.
func (s *NATSService) Health(connID int) (*model.BrokerHealth, error) {
	return s.service.Health(context.Background(), connID)
}

// Usage reads the account's JetStream meters, limits included.
//
// The limits travel with the usage because a meter needs both, and -1 is how
// the server spells "no cap" - a bar drawn against -1 can never move, so the
// page has to be able to tell that from a limit of zero.
func (s *NATSService) Usage(connID int) (*natsdriver.AccountUsage, error) {
	return s.service.Usage(context.Background(), connID)
}
