package redisstream

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/amigoer/mq-studio/internal/model"
)

// defaultPendingCount bounds a pending listing that did not ask for a size. A
// group behind by a million owes a million entries, and the page shows a page.
const defaultPendingCount = 200

/*
 * PendingSummary is the group's whole pending list in one call.
 *
 * XPENDING in its short form answers the count, the oldest and newest ids, and
 * who is holding what - without walking the list. The per-consumer breakdown
 * is what makes the page worth opening: it is how one dead consumer holding
 * everything is told apart from a group that is generally behind, and those
 * need completely different things done about them.
 */
func (c *Conn) PendingSummary(ctx context.Context, ref model.SubscriptionRef) (*model.PendingSummary, error) {
	stream, group, err := groupRef(ref)
	if err != nil {
		return nil, err
	}
	pending, err := c.client.XPending(ctx, stream, group).Result()
	if err != nil {
		return nil, fmt.Errorf("read the pending list of %q on %q: %w", group, stream, err)
	}

	summary := &model.PendingSummary{
		Ref:   model.SubscriptionRef{Namespace: stream, Name: group},
		Count: pending.Count,
		MinID: pending.Lower,
		MaxID: pending.Higher,
	}
	// An empty pending list answers with 0-0 at both ends rather than omitting
	// them. Passing that through would put an id on the page for a list that
	// has none.
	if summary.Count == 0 {
		summary.MinID, summary.MaxID = "", ""
	}

	summary.PerConsumer = make([]model.PendingByConsumer, 0, len(pending.Consumers))
	for name, count := range pending.Consumers {
		summary.PerConsumer = append(summary.PerConsumer,
			model.PendingByConsumer{Consumer: name, Count: count})
	}
	// Largest share first: the consumer holding the most is the one to look at.
	sort.Slice(summary.PerConsumer, func(left, right int) bool {
		if summary.PerConsumer[left].Count != summary.PerConsumer[right].Count {
			return summary.PerConsumer[left].Count > summary.PerConsumer[right].Count
		}
		return summary.PerConsumer[left].Consumer < summary.PerConsumer[right].Consumer
	})
	return summary, nil
}

// PendingEntries walks the list itself.
//
// The idle filter is what makes it useful rather than exhaustive: on a busy
// group most of the pending list is work in flight and perfectly healthy, and
// what an operator is looking for is the part nothing has touched for a while.
func (c *Conn) PendingEntries(ctx context.Context, query model.PendingQuery) ([]*model.PendingEntry, error) {
	stream, group, err := groupRef(query.Ref)
	if err != nil {
		return nil, err
	}
	count := query.Count
	if count <= 0 {
		count = defaultPendingCount
	}
	start, end := query.Start, query.End
	if start == "" {
		start = "-"
	}
	if end == "" {
		end = "+"
	}

	entries, err := c.client.XPendingExt(ctx, &redis.XPendingExtArgs{
		Stream:   stream,
		Group:    group,
		Idle:     time.Duration(query.MinIdleMs) * time.Millisecond,
		Start:    start,
		End:      end,
		Count:    int64(count),
		Consumer: strings.TrimSpace(query.Consumer),
	}).Result()
	if err != nil {
		return nil, fmt.Errorf("read the pending entries of %q on %q: %w", group, stream, err)
	}

	items := make([]*model.PendingEntry, 0, len(entries))
	for _, entry := range entries {
		items = append(items, &model.PendingEntry{
			Ref:        model.SubscriptionRef{Namespace: stream, Name: group},
			ID:         entry.ID,
			Consumer:   entry.Consumer,
			IdleMs:     entry.Idle.Milliseconds(),
			Deliveries: entry.RetryCount,
		})
	}
	return items, nil
}

// GroupConsumers lists the group's members.
//
// It lives with the pending list rather than under a runtime capability
// because it is the same question at a different grain: the summary says how
// much each consumer holds, and this says how long each has been quiet. A high
// idle with a pending count above zero is the shape of a consumer that died
// holding work, and neither number says it alone.
func (c *Conn) GroupConsumers(ctx context.Context, ref model.SubscriptionRef) ([]*model.GroupConsumer, error) {
	stream, group, err := groupRef(ref)
	if err != nil {
		return nil, err
	}
	consumers, err := c.client.XInfoConsumers(ctx, stream, group).Result()
	if err != nil {
		return nil, fmt.Errorf("list the consumers of %q on %q: %w", group, stream, err)
	}

	items := make([]*model.GroupConsumer, 0, len(consumers))
	for _, consumer := range consumers {
		items = append(items, &model.GroupConsumer{
			Name:    consumer.Name,
			Pending: consumer.Pending,
			IdleMs:  consumer.Idle.Milliseconds(),
			// Redis 7.2 and later. An older server reports nothing and this
			// stays zero, which the page renders as "not reported" rather
			// than as "active a moment ago".
			InactiveMs: consumer.Inactive.Milliseconds(),
		})
	}
	sort.Slice(items, func(left, right int) bool { return items[left].Name < items[right].Name })
	return items, nil
}

/*
 * AckEntries settles entries so they stop being owed.
 *
 * This is the destructive one on this page, and quietly so: acknowledging an
 * entry nobody processed removes it from the pending list and leaves it in the
 * stream, unread by that group forever. Nothing about the result distinguishes
 * that from a job well done, which is why the count comes back - it is how
 * many were actually owed, not how many were asked for, and a zero is the sign
 * that somebody else got there first.
 */
func (c *Conn) AckEntries(ctx context.Context, ref model.SubscriptionRef, ids []string) (*model.AckResult, error) {
	stream, group, err := groupRef(ref)
	if err != nil {
		return nil, err
	}
	wanted := trimmedIDs(ids)
	if len(wanted) == 0 {
		return nil, fmt.Errorf("no entry ids to acknowledge")
	}

	acknowledged, err := c.client.XAck(ctx, stream, group, wanted...).Result()
	if err != nil {
		return nil, fmt.Errorf("acknowledge entries of %q on %q: %w", group, stream, err)
	}
	return &model.AckResult{Acknowledged: acknowledged}, nil
}

/*
 * ClaimEntries moves named entries to another consumer.
 *
 * The minimum idle time is a guard rather than a filter: without it a claim
 * takes work from a consumer that is merely busy, and both consumers then
 * believe they own the same entry. Zero claims regardless, which is sometimes
 * exactly right - a consumer known to be gone - and is therefore a choice the
 * caller makes rather than a default this hides.
 *
 * The new consumer need not exist. Claiming creates it, which is how a
 * replacement worker takes over from a dead one without being started first.
 */
func (c *Conn) ClaimEntries(ctx context.Context, request model.ClaimRequest) (*model.ClaimResult, error) {
	stream, group, err := groupRef(request.Ref)
	if err != nil {
		return nil, err
	}
	consumer := strings.TrimSpace(request.Consumer)
	if consumer == "" {
		return nil, fmt.Errorf("a claim needs the consumer to move the entries to")
	}
	wanted := trimmedIDs(request.IDs)
	if len(wanted) == 0 {
		return nil, fmt.Errorf("no entry ids to claim")
	}

	// JustID: the entries' contents are not what a claim is about, and asking
	// for them would fetch every body to display a list of ids.
	claimed, err := c.client.XClaimJustID(ctx, &redis.XClaimArgs{
		Stream:   stream,
		Group:    group,
		Consumer: consumer,
		MinIdle:  time.Duration(request.MinIdleMs) * time.Millisecond,
		Messages: wanted,
	}).Result()
	if err != nil {
		return nil, fmt.Errorf("claim entries of %q on %q for %q: %w", group, stream, consumer, err)
	}
	return &model.ClaimResult{Claimed: claimed}, nil
}

/*
 * AutoClaim moves whatever has been idle too long, without naming ids.
 *
 * It is the gesture for the case the page exists to show: a consumer died and
 * its share has to go somewhere. Naming the ids by hand would mean copying a
 * list of them out of a table.
 *
 * The deleted ids are the part worth surfacing. An entry can be in a pending
 * list and no longer in the stream - trimmed or deleted while owed to somebody
 * - and an auto-claim drops those from the list rather than moving them. That
 * is work that was lost rather than reassigned, and it is the only moment
 * anything says so.
 */
func (c *Conn) AutoClaim(ctx context.Context, request model.AutoClaimRequest) (*model.ClaimResult, error) {
	stream, group, err := groupRef(request.Ref)
	if err != nil {
		return nil, err
	}
	consumer := strings.TrimSpace(request.Consumer)
	if consumer == "" {
		return nil, fmt.Errorf("an auto-claim needs the consumer to move the entries to")
	}
	start := strings.TrimSpace(request.Start)
	if start == "" {
		start = "0-0"
	}
	count := request.Count
	if count <= 0 {
		count = defaultPendingCount
	}

	// The raw command rather than XAutoClaimJustID, which discards the third
	// element of the reply - the ids that were dropped from the pending list
	// because the entries no longer exist. That is the only place anything
	// says work was lost rather than moved, so it is not something to give up
	// for a typed helper.
	reply, err := c.client.Do(ctx, "XAUTOCLAIM", stream, group, consumer,
		request.MinIdleMs, start, "COUNT", count, "JUSTID").Result()
	if err != nil {
		return nil, fmt.Errorf("auto-claim entries of %q on %q for %q: %w", group, stream, consumer, err)
	}
	result, err := parseAutoClaim(reply)
	if err != nil {
		return nil, fmt.Errorf("auto-claim entries of %q on %q: %w", group, stream, err)
	}
	return result, nil
}

/*
 * parseAutoClaim reads the XAUTOCLAIM reply.
 *
 * Three elements: where a further call would resume, the ids that changed
 * owner, and - since Redis 7.0 - the ids that were in the pending list and no
 * longer in the stream. A server that answers with two is answering the older
 * shape, and the absent third is "not reported" rather than "none deleted";
 * both come back as an empty list here, and the page does not claim otherwise.
 */
func parseAutoClaim(reply any) (*model.ClaimResult, error) {
	parts, ok := reply.([]any)
	if !ok || len(parts) < 2 {
		return nil, fmt.Errorf("unexpected reply shape %T", reply)
	}
	nextStart, ok := parts[0].(string)
	if !ok {
		return nil, fmt.Errorf("unexpected cursor %T in the reply", parts[0])
	}
	result := &model.ClaimResult{
		NextStart: nextStart,
		Claimed:   idsOf(parts[1]),
	}
	if len(parts) > 2 {
		result.Deleted = idsOf(parts[2])
	}
	return result, nil
}

// idsOf reads a list of entry ids out of a reply, skipping anything that is
// not one rather than failing: a partly readable answer is worth more here
// than none at all.
func idsOf(value any) []string {
	raw, ok := value.([]any)
	if !ok {
		return nil
	}
	ids := make([]string, 0, len(raw))
	for _, item := range raw {
		if id, ok := item.(string); ok {
			ids = append(ids, id)
		}
	}
	return ids
}

// trimmedIDs drops the blanks a form can produce without refusing the whole
// request for one empty row.
func trimmedIDs(ids []string) []string {
	wanted := make([]string, 0, len(ids))
	for _, id := range ids {
		if trimmed := strings.TrimSpace(id); trimmed != "" {
			wanted = append(wanted, trimmed)
		}
	}
	return wanted
}
