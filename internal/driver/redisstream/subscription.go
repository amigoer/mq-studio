package redisstream

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/redis/go-redis/v9"

	"github.com/amigoer/mq-studio/internal/model"
)

// Attribute keys a consumer group carries beyond the canonical fields.
const (
	AttrGroupStream     = "stream"
	AttrPending         = "pending"
	AttrLastDeliveredID = "lastDeliveredId"
	AttrEntriesRead     = "entriesRead"
)

// AttrStartID is where a new group begins reading, as the create form sends
// it: "0" for everything the stream still holds, "$" for only what arrives
// next. It is a spec attribute rather than a field on the canonical shape
// because no other family asks the question this way.
const AttrStartID = "startId"

/*
 * ListSubscriptions enumerates every consumer group on every stream.
 *
 * A Redis group belongs to one stream and its name is unique only within that
 * stream, so the reference carries both: the stream in Namespace, the group in
 * Name. Two streams may each have a "settle-group" and they are unrelated
 * objects - flattening them onto the name alone would merge two groups in the
 * list and send an operation to whichever came first.
 *
 * The cost is the stream scan plus one XINFO GROUPS per stream, pipelined into
 * a single exchange per node.
 */
func (c *Conn) ListSubscriptions(ctx context.Context) ([]*model.Subscription, error) {
	keys, err := c.scanStreams(ctx)
	if err != nil {
		return nil, err
	}
	sort.Strings(keys)
	if len(keys) == 0 {
		return []*model.Subscription{}, nil
	}

	pipeline := c.client.Pipeline()
	commands := make(map[string]*redis.XInfoGroupsCmd, len(keys))
	for _, key := range keys {
		commands[key] = pipeline.XInfoGroups(ctx, key)
	}
	// A key deleted between the scan and here fails its own command and must
	// not take the listing with it, so the error is read per command below.
	_, _ = pipeline.Exec(ctx)

	subscriptions := make([]*model.Subscription, 0, len(keys))
	for _, key := range keys {
		groups, err := commands[key].Result()
		if err != nil {
			continue
		}
		for _, group := range groups {
			subscriptions = append(subscriptions, subscriptionOf(key, group))
		}
	}
	sort.Slice(subscriptions, func(left, right int) bool {
		if subscriptions[left].Ref.Namespace != subscriptions[right].Ref.Namespace {
			return subscriptions[left].Ref.Namespace < subscriptions[right].Ref.Namespace
		}
		return subscriptions[left].Ref.Name < subscriptions[right].Ref.Name
	})
	for index, subscription := range subscriptions {
		subscription.ID = index + 1
	}
	return subscriptions, nil
}

// SubscriptionDetail describes one group. It costs one call because the stream
// it belongs to is already named in the reference.
func (c *Conn) SubscriptionDetail(ctx context.Context, ref model.SubscriptionRef) (*model.Subscription, error) {
	stream, group, err := groupRef(ref)
	if err != nil {
		return nil, err
	}
	groups, err := c.client.XInfoGroups(ctx, stream).Result()
	if err != nil {
		return nil, fmt.Errorf("list groups of %q: %w", stream, err)
	}
	for _, candidate := range groups {
		if candidate.Name == group {
			return subscriptionOf(stream, candidate), nil
		}
	}
	return nil, fmt.Errorf("consumer group %q does not exist on %q", group, stream)
}

/*
 * CreateSubscription declares a consumer group on a stream.
 *
 * Where it starts is the whole decision and there is no safe default, so the
 * form asks: "0" replays everything the stream still holds, "$" begins with
 * what arrives next. Getting it wrong is not a small mistake - a group created
 * at "$" on a stream with a million entries will never see any of them, and
 * one created at "0" replays all of them into a live consumer.
 *
 * MKSTREAM is deliberately not used. A group asked for on a stream that does
 * not exist is a typo far more often than it is an intention, and creating
 * both leaves a stream nobody meant to make.
 */
func (c *Conn) CreateSubscription(ctx context.Context, spec model.SubscriptionSpec) error {
	stream, group, err := groupRef(spec.Ref)
	if err != nil {
		return err
	}
	start := strings.TrimSpace(spec.Attributes[AttrStartID])
	if start == "" {
		// The safer of the two: a group that starts at the end cannot flood a
		// consumer with history it was not expecting.
		start = "$"
	}
	if err := c.client.XGroupCreate(ctx, stream, group, start).Err(); err != nil {
		return fmt.Errorf("create consumer group %q on %q: %w", group, stream, err)
	}
	return nil
}

// UpdateSubscription is not something a group has.
//
// Moving where a group reads is a reposition rather than an edit, and it has
// its own capability and its own confirmation because the blast radius is
// completely different: it changes what every consumer in the group sees next.
func (c *Conn) UpdateSubscription(context.Context, model.SubscriptionSpec) error {
	return fmt.Errorf("a consumer group has no settings to change; reposition it instead")
}

// RemoveSubscription destroys the group, and with it every pending entry it
// holds. The entries themselves stay in the stream - they are simply no longer
// owed to anyone.
func (c *Conn) RemoveSubscription(ctx context.Context, ref model.SubscriptionRef) error {
	stream, group, err := groupRef(ref)
	if err != nil {
		return err
	}
	destroyed, err := c.client.XGroupDestroy(ctx, stream, group).Result()
	if err != nil {
		return fmt.Errorf("delete consumer group %q on %q: %w", group, stream, err)
	}
	if destroyed == 0 {
		return fmt.Errorf("consumer group %q does not exist on %q", group, stream)
	}
	return nil
}

// groupRef splits the reference a group is addressed by, and says which half
// is missing rather than failing on the server.
func groupRef(ref model.SubscriptionRef) (stream, group string, err error) {
	stream = strings.TrimSpace(ref.Namespace)
	group = strings.TrimSpace(ref.Name)
	if stream == "" {
		return "", "", fmt.Errorf("a consumer group is addressed by the stream it reads")
	}
	if group == "" {
		return "", "", fmt.Errorf("a consumer group needs a name")
	}
	return stream, group, nil
}

// subscriptionOf turns one XINFO GROUPS row into the canonical shape.
func subscriptionOf(stream string, group redis.XInfoGroup) *model.Subscription {
	attributes := map[string]string{
		AttrGroupStream:     stream,
		AttrPending:         strconv.FormatInt(group.Pending, 10),
		AttrLastDeliveredID: group.LastDeliveredID,
	}

	// Redis reports lag and entries-read together, and reports both as nil
	// when it cannot work them out - which happens after entries the group had
	// not read were deleted. go-redis passes the first through as -1, and that
	// is already UnknownMetric; the second would arrive as a 0 that reads as
	// "has read nothing", so it only travels when the pair is known.
	backlog := group.Lag
	if backlog < 0 {
		backlog = model.UnknownMetric
	} else {
		attributes[AttrEntriesRead] = strconv.FormatInt(group.EntriesRead, 10)
	}

	return &model.Subscription{
		Ref:     model.SubscriptionRef{Namespace: stream, Name: group.Name},
		Status:  groupStatus(group),
		Members: int(group.Consumers),
		// One. A Redis consumer group belongs to exactly one stream, unlike a
		// Kafka group that may be subscribed to several.
		Destinations: 1,
		Backlog:      backlog,
		// Redis keeps no per-group consume rate. A zero would read as "nothing
		// is being consumed", which is a different claim from "not measured".
		RateOut:    model.UnknownMetric,
		Attributes: attributes,
	}
}

/*
 * groupStatus is what an operator should look at first.
 *
 * The middle state is the one worth having. A group with no consumer attached
 * and nothing pending is simply idle - an application that is not running,
 * which is often fine. One with no consumer and entries still pending is work
 * that was handed out and never acknowledged, and nothing is coming back for
 * it until something attaches or claims it.
 */
func groupStatus(group redis.XInfoGroup) model.SubscriptionStatus {
	switch {
	case group.Consumers > 0:
		return model.SubscriptionOnline
	case group.Pending > 0:
		return model.SubscriptionWarning
	default:
		return model.SubscriptionOffline
	}
}
