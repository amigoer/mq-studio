package nats

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/nats-io/nats.go/jetstream"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/timestamp"
)

// Attribute keys a consumer carries beyond the canonical fields.
const (
	AttrStream        = "stream"
	AttrDurable       = "durable"
	AttrDeliverPolicy = "deliverPolicy"
	AttrAckPolicy     = "ackPolicy"
	AttrAckWait       = "ackWait"
	AttrMaxDeliver    = "maxDeliver"
	AttrFilterSubject = "filterSubject"
	AttrReplayPolicy  = "replayPolicy"
	AttrMaxAckPending = "maxAckPending"
	AttrMaxWaiting    = "maxWaiting"
	AttrMaxBatch      = "maxRequestBatch"
	AttrDeliverGroup  = "deliverGroup"
	AttrDeliverTo     = "deliverSubject"
	AttrAckPending    = "ackPending"
	AttrRedelivered   = "redelivered"
	AttrDeliveredSeq  = "deliveredSeq"
	AttrAckFloorSeq   = "ackFloorSeq"
	AttrConsumerKind  = "consumerKind"
	AttrWaiting       = "waitingRequests"
	AttrCreatedAt     = "consumerCreated"
)

/*
 * A JetStream consumer is a subscription, and it is named inside its stream.
 *
 * Two consumers on two streams may both be called "worker" and they are not
 * the same object, so the reference carries both: the stream in Namespace, the
 * consumer in Name. This is the same shape Redis Stream uses for a consumer
 * group, and for the same reason.
 */

// ListSubscriptions enumerates every consumer on every stream in the account.
//
// Every stream, because a consumer only exists on one and there is no
// account-wide listing in the API - so this walks the streams and asks each.
// The cost is one request per stream, which is why the streams board does not
// do the same thing for its consumer counts: those come free with the stream
// listing.
func (c *Conn) ListSubscriptions(ctx context.Context) ([]*model.Subscription, error) {
	if err := c.requireJetStream(); err != nil {
		return nil, err
	}

	streams := make([]string, 0, 32)
	names := c.js.StreamNames(ctx)
	for name := range names.Name() {
		if isInternalStream(name) {
			continue
		}
		streams = append(streams, name)
		if len(streams) >= maxStreams {
			break
		}
	}
	if err := names.Err(); err != nil {
		return nil, err
	}
	sort.Strings(streams)

	subscriptions := make([]*model.Subscription, 0, len(streams))
	for _, name := range streams {
		stream, err := c.js.Stream(ctx, name)
		if err != nil {
			// A stream deleted between the listing and this call is not a
			// failure of the page: it is one row that no longer exists, and
			// failing the whole board over it would be worse than omitting it.
			if isNotFound(err) {
				continue
			}
			return nil, streamError(name, err)
		}
		lister := stream.ListConsumers(ctx)
		for info := range lister.Info() {
			subscriptions = append(subscriptions, subscriptionOf(name, info))
		}
		if err := lister.Err(); err != nil {
			return nil, streamError(name, err)
		}
	}

	sort.Slice(subscriptions, func(i, j int) bool {
		if subscriptions[i].Ref.Namespace != subscriptions[j].Ref.Namespace {
			return subscriptions[i].Ref.Namespace < subscriptions[j].Ref.Namespace
		}
		return subscriptions[i].Ref.Name < subscriptions[j].Ref.Name
	})
	for index, subscription := range subscriptions {
		subscription.ID = index + 1
	}
	return subscriptions, nil
}

// SubscriptionDetail reads one consumer.
func (c *Conn) SubscriptionDetail(ctx context.Context, ref model.SubscriptionRef) (*model.Subscription, error) {
	if err := c.requireJetStream(); err != nil {
		return nil, err
	}
	stream := strings.TrimSpace(ref.Namespace)
	if stream == "" {
		return nil, errStreamRequired
	}
	consumer, err := c.js.Consumer(ctx, stream, ref.Name)
	if err != nil {
		return nil, consumerError(stream, ref.Name, err)
	}
	info, err := consumer.Info(ctx)
	if err != nil {
		return nil, consumerError(stream, ref.Name, err)
	}
	return subscriptionOf(stream, info), nil
}

// CreateSubscription declares a consumer on a stream.
func (c *Conn) CreateSubscription(ctx context.Context, spec model.SubscriptionSpec) error {
	if err := c.requireJetStream(); err != nil {
		return err
	}
	stream := strings.TrimSpace(spec.Ref.Namespace)
	if stream == "" {
		return errStreamRequired
	}
	config, err := consumerConfigOf(spec)
	if err != nil {
		return err
	}
	// CreateConsumer rather than CreateOrUpdate: a create that quietly
	// rewrote an existing consumer would move another application's position.
	if _, err := c.js.CreateConsumer(ctx, stream, config); err != nil {
		return consumerError(stream, spec.Ref.Name, err)
	}
	return nil
}

// UpdateSubscription changes a consumer's configuration.
//
// Not its position. A consumer's start policy is fixed when it is created and
// the server refuses to change it afterwards, which is why this driver
// declares no offset reset: the only way to move one is to delete it and make
// another, and that changes its identity and drops what it had acknowledged.
func (c *Conn) UpdateSubscription(ctx context.Context, spec model.SubscriptionSpec) error {
	if err := c.requireJetStream(); err != nil {
		return err
	}
	stream := strings.TrimSpace(spec.Ref.Namespace)
	if stream == "" {
		return errStreamRequired
	}
	config, err := consumerConfigOf(spec)
	if err != nil {
		return err
	}
	if _, err := c.js.UpdateConsumer(ctx, stream, config); err != nil {
		return consumerError(stream, spec.Ref.Name, err)
	}
	return nil
}

// RemoveSubscription deletes a consumer and the position it held.
func (c *Conn) RemoveSubscription(ctx context.Context, ref model.SubscriptionRef) error {
	if err := c.requireJetStream(); err != nil {
		return err
	}
	stream := strings.TrimSpace(ref.Namespace)
	if stream == "" {
		return errStreamRequired
	}
	if err := c.js.DeleteConsumer(ctx, stream, ref.Name); err != nil {
		return consumerError(stream, ref.Name, err)
	}
	return nil
}

// errStreamRequired is a reference that named a consumer and not the stream it
// lives on. Two streams may both have a "worker", so the name alone is not an
// address.
var errStreamRequired = errors.New("a jetstream consumer is named inside its stream; the stream is missing")

// subscriptionOf maps one consumer onto the canonical model.
func subscriptionOf(stream string, info *jetstream.ConsumerInfo) *model.Subscription {
	config := info.Config

	subscription := &model.Subscription{
		Ref: model.SubscriptionRef{Namespace: stream, Name: info.Name},
		// A consumer reads one stream. Not a count that might vary: it is
		// structurally one, and the column says so rather than being blank.
		Destinations: 1,
		Members:      boundMembers(info),
		Backlog:      int64(info.NumPending),
		// JetStream counts deliveries and acknowledgements; a per-second
		// figure would be two samples divided by the time between them, and
		// inventing one would put a derived number beside real ones.
		RateOut:     model.UnknownMetric,
		Status:      consumerStatus(info),
		LastUpdated: timestamp.Now(),
		Attributes:  map[string]string{},
	}

	set := func(key, value string) {
		if value != "" {
			subscription.Attributes[key] = value
		}
	}

	set(AttrStream, stream)
	set(AttrDurable, config.Durable)
	set(AttrDeliverPolicy, deliverPolicyName(config.DeliverPolicy))
	set(AttrAckPolicy, ackPolicyName(config.AckPolicy))
	set(AttrReplayPolicy, replayPolicyName(config.ReplayPolicy))
	set(AttrAckWait, config.AckWait.String())
	set(AttrMaxDeliver, strconv.Itoa(config.MaxDeliver))
	set(AttrFilterSubject, filterSubjects(config))
	set(AttrMaxAckPending, strconv.Itoa(config.MaxAckPending))
	set(AttrConsumerKind, consumerKind(config))
	set(AttrCreatedAt, timestamp.FromTime(info.Created))

	// Push-only settings. Absent on a pull consumer rather than zero, because
	// a queue group of "" and a consumer that has no queue group are the same
	// on screen and different in fact.
	set(AttrDeliverTo, config.DeliverSubject)
	set(AttrDeliverGroup, config.DeliverGroup)

	// Pull-only settings, for the same reason in reverse.
	if config.DeliverSubject == "" {
		set(AttrMaxWaiting, strconv.Itoa(config.MaxWaiting))
		set(AttrMaxBatch, strconv.Itoa(config.MaxRequestBatch))
	}

	// How many pull requests are parked, waiting for something to arrive. It
	// is not a client count - one client may hold several - but it is the only
	// figure a pull consumer offers about who is asking.
	if config.DeliverSubject == "" {
		set(AttrWaiting, strconv.Itoa(info.NumWaiting))
	}
	set(AttrAckPending, strconv.Itoa(info.NumAckPending))
	set(AttrRedelivered, strconv.Itoa(info.NumRedelivered))
	set(AttrDeliveredSeq, strconv.FormatUint(info.Delivered.Stream, 10))
	set(AttrAckFloorSeq, strconv.FormatUint(info.AckFloor.Stream, 10))

	if info.Cluster != nil {
		set(AttrClusterName, info.Cluster.Name)
		set(AttrLeader, info.Cluster.Leader)
	}
	return subscription
}

// consumerStatus is the three-state health the list column shows.
//
// A pull consumer with nothing connected is not offline: nothing is bound to
// it because that is how pull works, and the position it holds is as real as
// it was a second ago. What is worth flagging is work it has been handed and
// not acknowledged, and redeliveries - both mean something is running and not
// finishing.
func consumerStatus(info *jetstream.ConsumerInfo) model.SubscriptionStatus {
	switch {
	case info.NumRedelivered > 0:
		return model.SubscriptionWarning
	case info.NumAckPending > 0:
		return model.SubscriptionWarning
	case info.Config.DeliverSubject != "" && !info.PushBound:
		// A push consumer with nothing bound really is idle: the server has a
		// subject to deliver to and nobody listening on it.
		return model.SubscriptionOffline
	default:
		return model.SubscriptionOnline
	}
}

// boundMembers is how many clients the server says are attached.
//
// It can only answer for a push consumer, and then only yes or no: PushBound
// is a boolean, because a push consumer delivers to one subject and either
// something is listening on it or nothing is.
//
// A pull consumer has no answer at all. Clients ask for messages when they
// want them and hold nothing open in between, so there is nobody to count -
// and reporting zero would say a working consumer is unattended. What the
// server does report is how many pull requests are parked, and that goes in an
// attribute where it can be labelled for what it is.
func boundMembers(info *jetstream.ConsumerInfo) int {
	if info.Config.DeliverSubject == "" {
		return model.UnknownMetric
	}
	if info.PushBound {
		return 1
	}
	return 0
}

// consumerKind is push or pull, which decides half of what the rest means.
func consumerKind(config jetstream.ConsumerConfig) string {
	if config.DeliverSubject != "" {
		return "push"
	}
	return "pull"
}

// filterSubjects is what the consumer takes from the stream.
//
// The API has two fields for this - one subject, or a list - and only one may
// be set. Reading both into one string keeps that a detail of this file rather
// than something every reader has to know.
func filterSubjects(config jetstream.ConsumerConfig) string {
	if len(config.FilterSubjects) > 0 {
		return strings.Join(config.FilterSubjects, ", ")
	}
	return config.FilterSubject
}

// consumerConfigOf builds a consumer configuration from what the form
// collected.
func consumerConfigOf(spec model.SubscriptionSpec) (jetstream.ConsumerConfig, error) {
	name := strings.TrimSpace(spec.Ref.Name)
	if name == "" {
		return jetstream.ConsumerConfig{}, fmt.Errorf("a consumer needs a name")
	}
	if strings.ContainsAny(name, ".*> \t/\\") {
		return jetstream.ConsumerConfig{}, fmt.Errorf(
			"%q is not a valid consumer name: it cannot contain a dot, a wildcard, a space or a slash", name)
	}

	attributes := spec.Attributes
	if attributes == nil {
		attributes = map[string]string{}
	}

	config := jetstream.ConsumerConfig{
		Name:          name,
		AckPolicy:     ackPolicy(attributes[AttrAckPolicy]),
		DeliverPolicy: deliverPolicy(attributes[AttrDeliverPolicy]),
		ReplayPolicy:  replayPolicy(attributes[AttrReplayPolicy]),
		MaxDeliver:    intAttr(attributes, AttrMaxDeliver, -1),
		MaxAckPending: intAttr(attributes, AttrMaxAckPending, 1000),
	}
	// A durable consumer survives a restart and keeps its position; an
	// ephemeral one is cleaned up when nothing is using it. Naming it durable
	// is what makes the difference, so a form that always set it would offer
	// no way to make the other kind.
	if attributes[AttrDurable] != "false" {
		config.Durable = name
	}

	wait, err := durationAttr(attributes, AttrAckWait)
	if err != nil {
		return jetstream.ConsumerConfig{}, fmt.Errorf("ack wait: %w", err)
	}
	if wait > 0 {
		config.AckWait = wait
	}

	// A filter narrows what the consumer takes from the stream. Several are
	// allowed, and the API wants them in the list field rather than the single
	// one - setting both is refused by the server.
	if filters := splitSubjects(attributes[AttrFilterSubject]); len(filters) == 1 {
		if err := validateSubject(filters[0]); err != nil {
			return jetstream.ConsumerConfig{}, err
		}
		config.FilterSubject = filters[0]
	} else if len(filters) > 1 {
		for _, filter := range filters {
			if err := validateSubject(filter); err != nil {
				return jetstream.ConsumerConfig{}, err
			}
		}
		config.FilterSubjects = filters
	}

	// Push and pull are the same object with one field set differently, and
	// the pull-only limits are refused by the server on a push consumer.
	if subject := strings.TrimSpace(attributes[AttrDeliverTo]); subject != "" {
		if err := validateSubject(subject); err != nil {
			return jetstream.ConsumerConfig{}, err
		}
		config.DeliverSubject = subject
		config.DeliverGroup = strings.TrimSpace(attributes[AttrDeliverGroup])
	} else {
		config.MaxWaiting = intAttr(attributes, AttrMaxWaiting, 512)
		config.MaxRequestBatch = intAttr(attributes, AttrMaxBatch, 0)
	}
	return config, nil
}

func consumerError(stream, consumer string, err error) error {
	if errors.Is(err, jetstream.ErrConsumerNotFound) {
		return fmt.Errorf("consumer %q does not exist on stream %q", consumer, stream)
	}
	if errors.Is(err, jetstream.ErrStreamNotFound) {
		return fmt.Errorf("stream %q does not exist", stream)
	}
	return err
}

func isNotFound(err error) bool {
	return errors.Is(err, jetstream.ErrStreamNotFound) || errors.Is(err, jetstream.ErrConsumerNotFound)
}

func deliverPolicyName(policy jetstream.DeliverPolicy) string {
	switch policy {
	case jetstream.DeliverLastPolicy:
		return "last"
	case jetstream.DeliverNewPolicy:
		return "new"
	case jetstream.DeliverByStartSequencePolicy:
		return "bySequence"
	case jetstream.DeliverByStartTimePolicy:
		return "byTime"
	case jetstream.DeliverLastPerSubjectPolicy:
		return "lastPerSubject"
	default:
		return "all"
	}
}

func deliverPolicy(name string) jetstream.DeliverPolicy {
	switch name {
	case "last":
		return jetstream.DeliverLastPolicy
	case "new":
		return jetstream.DeliverNewPolicy
	case "lastPerSubject":
		return jetstream.DeliverLastPerSubjectPolicy
	default:
		return jetstream.DeliverAllPolicy
	}
}

func ackPolicyName(policy jetstream.AckPolicy) string {
	switch policy {
	case jetstream.AckNonePolicy:
		return "none"
	case jetstream.AckAllPolicy:
		return "all"
	default:
		return "explicit"
	}
}

func ackPolicy(name string) jetstream.AckPolicy {
	switch name {
	case "none":
		return jetstream.AckNonePolicy
	case "all":
		return jetstream.AckAllPolicy
	default:
		return jetstream.AckExplicitPolicy
	}
}

func replayPolicyName(policy jetstream.ReplayPolicy) string {
	if policy == jetstream.ReplayOriginalPolicy {
		return "original"
	}
	return "instant"
}

func replayPolicy(name string) jetstream.ReplayPolicy {
	if name == "original" {
		return jetstream.ReplayOriginalPolicy
	}
	return jetstream.ReplayInstantPolicy
}
