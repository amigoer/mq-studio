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
)

// maxPublishCount bounds one press of the send button. The console offers a
// repeat count so a board can be given something to show; it is not a load
// generator, and a mistyped count should not fill a stream.
const maxPublishCount = 1000

// PublishRequest is one NATS publish.
//
// This package's own type rather than model.PublishRequest, which is
// AMQP-shaped: an exchange, a routing key, a mandatory flag and a priority
// have no NATS counterpart, and a subject with headers and JetStream's publish
// preconditions have no AMQP one. Reaching for the shared struct would mean a
// form of fields that do nothing beside fields that cannot be set. MQTT's
// PublishRequest and Kafka's RecordRequest are here for the same reason.
type PublishRequest struct {
	Subject string `json:"subject"`
	Payload string `json:"payload"`
	// Headers travel with the message. NATS carries them natively, so unlike
	// a RocketMQ tag they need no encoding into the body.
	Headers map[string]string `json:"headers"`
	// Count sends the same message more than once, for filling a board.
	Count int `json:"count"`

	// Persist waits for JetStream to acknowledge that a stream stored the
	// message. Without it the publish is core NATS: it reaches whoever is
	// listening and nothing else, and the server says nothing back.
	Persist bool `json:"persist"`

	// ExpectStream refuses the publish unless that stream is the one that
	// captures the subject. It is the guard against a subject typo that
	// silently lands somewhere else - or nowhere.
	ExpectStream string `json:"expectStream"`
	// DeduplicationID is Nats-Msg-Id. A second message carrying the same one
	// inside the stream's duplicate window is accepted and not stored.
	DeduplicationID string `json:"deduplicationId"`

	// ReplyTimeoutMs turns the publish into a request and waits that long for
	// an answer. Zero is an ordinary publish.
	ReplyTimeoutMs int `json:"replyTimeoutMs"`
}

// PublishResult is what the server said, which depends on how much was asked.
type PublishResult struct {
	// Sent is how many of Count went out.
	Sent int `json:"sent"`

	// Acknowledged is whether a stream confirmed storing them.
	//
	// False on a core publish is not a failure: core NATS acknowledges
	// nothing, by design. The board says which kind of send this was rather
	// than showing an unticked box.
	Acknowledged bool `json:"acknowledged"`

	// Stream and Sequence name where the last message landed, when a stream
	// stored it. Empty on a core publish, which lands nowhere in particular.
	Stream   string `json:"stream"`
	Sequence uint64 `json:"sequence"`

	// Duplicate is the server reporting that it recognised the deduplication
	// id and did not store the message again. It is a success rather than an
	// error, and the difference is worth showing: the message is not there
	// twice, and it is also not there once more.
	Duplicate bool `json:"duplicate"`

	// Reply is what answered a request, when one was asked for.
	Reply string `json:"reply"`
	// Answered separates "nobody replied" from "somebody replied with
	// nothing", which are different diagnoses of the same blank box.
	Answered bool `json:"answered"`
}

// Publish sends a message on a subject.
//
// Two quite different operations behind one form, and the difference is the
// Persist flag rather than a mode selector, because from the sender's side it
// is one act: put this on this subject. What changes is whether anything is
// waiting - a core publish reaches whoever is listening at that instant and is
// forgotten, and a JetStream publish is stored by whichever stream captures
// the subject and acknowledged.
func (c *Conn) Publish(ctx context.Context, request PublishRequest) (*PublishResult, error) {
	if c.nc == nil {
		return nil, errConnectionDown
	}
	subject := strings.TrimSpace(request.Subject)
	if subject == "" {
		return nil, fmt.Errorf("a message needs a subject")
	}
	if err := validatePublishSubject(subject); err != nil {
		return nil, err
	}

	count := request.Count
	if count <= 0 {
		count = 1
	}
	if count > maxPublishCount {
		return nil, fmt.Errorf("cannot send more than %d messages at once", maxPublishCount)
	}

	if request.ReplyTimeoutMs > 0 {
		if count > 1 {
			return nil, fmt.Errorf("a request expects one answer, so it cannot be sent %d times", count)
		}
		return c.request(ctx, subject, request)
	}
	if request.Persist {
		return c.publishToStream(ctx, subject, request, count)
	}
	return c.publishCore(ctx, subject, request, count)
}

// publishCore sends without JetStream, which acknowledges nothing.
//
// The flush is what makes the result mean anything. A core publish is written
// to a buffer and returns immediately, so without it "sent" would report that
// the bytes reached this process's socket - and a message to a server that had
// gone away would look identical to one that arrived.
func (c *Conn) publishCore(ctx context.Context, subject string, request PublishRequest, count int) (*PublishResult, error) {
	result := &PublishResult{}
	for range count {
		if err := c.nc.PublishMsg(messageOf(subject, request)); err != nil {
			return result, err
		}
		result.Sent++
	}
	if err := c.nc.FlushWithContext(ctx); err != nil {
		return result, err
	}
	// Acknowledged stays false, and that is the fact rather than a failure:
	// core NATS has no acknowledgement to give.
	return result, nil
}

// publishToStream waits for a stream to confirm each message.
func (c *Conn) publishToStream(ctx context.Context, subject string, request PublishRequest, count int) (*PublishResult, error) {
	if err := c.requireJetStream(); err != nil {
		return nil, err
	}

	options := make([]jetstream.PublishOpt, 0, 2)
	if stream := strings.TrimSpace(request.ExpectStream); stream != "" {
		options = append(options, jetstream.WithExpectStream(stream))
	}
	if id := strings.TrimSpace(request.DeduplicationID); id != "" {
		options = append(options, jetstream.WithMsgID(id))
	}

	result := &PublishResult{}
	for range count {
		ack, err := c.js.PublishMsg(ctx, messageOf(subject, request), options...)
		if err != nil {
			// No stream captures the subject. The library's message says "no
			// responders", which reads as a network problem rather than as
			// the configuration one it is.
			if errors.Is(err, jetstream.ErrNoStreamResponse) {
				return result, fmt.Errorf(
					"no stream captures %q, so nothing would store this message", subject)
			}
			return result, err
		}
		result.Sent++
		result.Acknowledged = true
		result.Stream = ack.Stream
		result.Sequence = ack.Sequence
		// A duplicate is a success: the id was recognised and the message was
		// not stored again. Reporting it is what stops somebody pressing send
		// three more times.
		if ack.Duplicate {
			result.Duplicate = true
		}
	}
	return result, nil
}

// request sends and waits for an answer.
//
// Its own path rather than a flag on the publish, because what "sent" means
// changes completely: a request that nobody answers is a failure of the thing
// being asked, not of the sending, and the board has to be able to say which.
func (c *Conn) request(ctx context.Context, subject string, request PublishRequest) (*PublishResult, error) {
	timeout := time.Duration(request.ReplyTimeoutMs) * time.Millisecond
	deadline, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	reply, err := c.nc.RequestMsgWithContext(deadline, messageOf(subject, request))
	if err != nil {
		result := &PublishResult{Sent: 1}
		switch {
		case errors.Is(err, natsclient.ErrNoResponders):
			// Nothing is subscribed. A distinct outcome from a timeout: one
			// means nobody is there, the other means somebody is and did not
			// answer in time, and they are fixed in different places.
			return result, fmt.Errorf("nothing is listening on %q", subject)
		case errors.Is(err, context.DeadlineExceeded):
			return result, fmt.Errorf(
				"nothing answered on %q within %v", subject, timeout)
		default:
			return result, err
		}
	}
	return &PublishResult{
		Sent:     1,
		Reply:    string(reply.Data),
		Answered: true,
	}, nil
}

// messageOf builds the message each send puts on the wire.
func messageOf(subject string, request PublishRequest) *natsclient.Msg {
	message := natsclient.NewMsg(subject)
	message.Data = []byte(request.Payload)
	for name, value := range request.Headers {
		if strings.TrimSpace(name) == "" {
			continue
		}
		message.Header.Set(name, value)
	}
	return message
}

// validatePublishSubject refuses a wildcard.
//
// A subject with a wildcard is a pattern to subscribe to, not an address to
// publish on. The server accepts one and it matches nothing, so the message is
// delivered to nobody and stored by no stream - and the send reports success,
// because nothing went wrong from the protocol's point of view.
func validatePublishSubject(subject string) error {
	if err := validateSubject(subject); err != nil {
		return err
	}
	if strings.ContainsAny(subject, "*>") {
		return fmt.Errorf(
			"%q is a pattern rather than an address: a wildcard subscribes, it does not publish", subject)
	}
	return nil
}

// SendMessage is the canonical publish, which every family answers so the
// shared send path has something to call.
//
// Three of its five arguments are RocketMQ's vocabulary and are refused rather
// than mapped. NATS has no tag and no message key, and quietly dropping either
// would report success for a message that arrived without it; a delay level is
// a broker-side scheduler NATS does not have at all.
//
// It publishes through JetStream where a stream captures the subject and falls
// back to core, because the caller has not said which they meant and the
// difference matters more than the choice: a message stored is a message
// somebody can still look at afterwards.
func (c *Conn) SendMessage(
	ctx context.Context, topic, tags, keys, body string, delayLevel int,
) (string, error) {
	if delayLevel != 0 {
		return "", fmt.Errorf("nats has no delayed delivery; the server schedules nothing")
	}
	if tags != "" {
		return "", fmt.Errorf("nats messages have no tags; the subject is the routing label")
	}
	if keys != "" {
		return "", fmt.Errorf("nats messages have no keys; set Nats-Msg-Id for deduplication instead")
	}

	request := PublishRequest{Subject: topic, Payload: body, Persist: c.tiers.jetStream}
	result, err := c.Publish(ctx, request)
	if err != nil && request.Persist {
		// No stream captures it, so a persisted send was never going to work.
		// Falling back to core is the honest answer: the message reaches
		// whoever is listening, which is what a subject with no stream means.
		result, err = c.Publish(ctx, PublishRequest{Subject: topic, Payload: body})
	}
	if err != nil {
		return "", err
	}
	// The sequence where there is one, and the subject where there is not - a
	// core publish has no identifier at all, and the subject is the only thing
	// worth handing back.
	if result.Acknowledged {
		return strconv.FormatUint(result.Sequence, 10), nil
	}
	return topic, nil
}
