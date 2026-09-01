package redisstream

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/redis/go-redis/v9"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/timestamp"
)

// Filter keys the message query understands. They are a contract with
// frontend/src/mq/redis/messages.ts.
const (
	// FilterField narrows to entries carrying a field of this name, whatever
	// its value. Stream entries are schemaless, so "which of these even has a
	// customer id" is a real question.
	FilterField = "field"
	// FilterContains narrows to entries where some field's value contains this
	// text. Redis has no server-side search over entry contents, so it is
	// applied here - which is why the query reads a bounded window and says
	// how much of it it looked at.
	FilterContains = "contains"
)

// defaultMaxResults bounds a query that did not ask for a size. A stream can
// hold millions and the panel shows a page.
const defaultMaxResults = 200

// scanMultiplier is how much more than the caller asked for is read when a
// filter is set.
//
// Redis cannot filter entry contents, so matching happens here: reading
// exactly maxResults and then discarding most of them would return a nearly
// empty page and look like the stream was empty. Reading a bounded multiple
// and saying so is the honest version of a server-side search that does not
// exist.
const scanMultiplier = 10

/*
 * QueryMessages reads a window of a stream, newest first.
 *
 * The time range maps onto Redis natively and this is the one place the
 * canonical shape fits without a seam: a stream entry's id is
 * <milliseconds>-<sequence>, so a start and end timestamp are literally a
 * start and end id. No scan, no index, no client-side date matching - XREVRANGE
 * answers the exact question the panel asks.
 */
func (c *Conn) QueryMessages(ctx context.Context, params model.MessageQueryParams) ([]*model.MessageItem, error) {
	stream := strings.TrimSpace(params.Topic)
	if stream == "" {
		return nil, fmt.Errorf("a message query needs a stream key")
	}
	// A single id is a lookup rather than a range, and answering it through
	// the range path would scan for something already addressable.
	if id := strings.TrimSpace(params.MessageID); id != "" {
		item, err := c.MessageByID(ctx, stream, id)
		if err != nil {
			return nil, err
		}
		return []*model.MessageItem{item}, nil
	}

	limit := params.MaxResults
	if limit <= 0 {
		limit = defaultMaxResults
	}
	field, contains := filtersOf(params)
	read := limit
	if field != "" || contains != "" {
		read = limit * scanMultiplier
	}

	start, end := rangeOf(params)
	// Newest first: a console is opened to see what just happened far more
	// often than what happened first.
	entries, err := c.client.XRevRangeN(ctx, stream, end, start, int64(read)).Result()
	if err != nil {
		return nil, fmt.Errorf("read stream %q: %w", stream, err)
	}

	items := make([]*model.MessageItem, 0, min(len(entries), limit))
	for _, entry := range entries {
		if !matches(entry, field, contains) {
			continue
		}
		items = append(items, messageOf(stream, entry))
		if len(items) == limit {
			break
		}
	}
	for index, item := range items {
		item.ID = index + 1
	}
	return items, nil
}

// MessageByID reads one entry.
//
// Redis Streams is the one family here with a stable, addressable id, so this
// is an exact lookup rather than a search: XRANGE with the same id at both
// ends returns that entry or nothing.
func (c *Conn) MessageByID(ctx context.Context, topic, messageID string) (*model.MessageItem, error) {
	stream := strings.TrimSpace(topic)
	id := strings.TrimSpace(messageID)
	if stream == "" || id == "" {
		return nil, fmt.Errorf("a message lookup needs a stream key and an entry id")
	}
	if !entryID.MatchString(id) {
		return nil, fmt.Errorf("%q is not an entry id: it is <milliseconds> or <milliseconds>-<sequence>", id)
	}

	entries, err := c.client.XRangeN(ctx, stream, id, id, 1).Result()
	if err != nil {
		return nil, fmt.Errorf("read entry %s from %q: %w", id, stream, err)
	}
	if len(entries) == 0 {
		return nil, fmt.Errorf("entry %s does not exist in %q", id, stream)
	}
	item := messageOf(stream, entries[0])
	item.ID = 1
	return item, nil
}

// rangeOf turns the query's time window into the ids XREVRANGE takes.
//
// An absent bound is Redis's own open end rather than a made-up one: "-" is
// the first entry the stream still holds and "+" is the last. A start of zero
// is absent rather than the epoch, because a form that has not been filled in
// sends a zero.
func rangeOf(params model.MessageQueryParams) (start, end string) {
	start, end = "-", "+"
	if params.StartTime > 0 {
		// Sequence zero: the first entry in that millisecond, so a window
		// beginning at a moment includes everything stamped with it.
		start = strconv.FormatInt(params.StartTime, 10) + "-0"
	}
	if params.EndTime > 0 {
		// And the last, so a window ending at a moment includes it too. A
		// range ending at <ms>-0 would drop every entry after the first in
		// that millisecond, which on a busy stream is most of them.
		end = strconv.FormatInt(params.EndTime, 10) + "-" + strconv.FormatUint(^uint64(0), 10)
	}
	return start, end
}

func filtersOf(params model.MessageQueryParams) (field, contains string) {
	return strings.TrimSpace(params.Filters[FilterField]),
		strings.TrimSpace(params.Filters[FilterContains])
}

// matches applies the filters Redis cannot.
func matches(entry redis.XMessage, field, contains string) bool {
	if field != "" {
		if _, present := entry.Values[field]; !present {
			return false
		}
	}
	if contains == "" {
		return true
	}
	needle := strings.ToLower(contains)
	for name, value := range entry.Values {
		if strings.Contains(strings.ToLower(name), needle) {
			return true
		}
		if strings.Contains(strings.ToLower(valueOf(value)), needle) {
			return true
		}
	}
	return false
}

/*
 * messageOf turns one entry into the canonical shape.
 *
 * Two decisions worth naming.
 *
 * The fields land in Properties, not in Body, because that is what they are: a
 * stream entry is a set of field/value pairs rather than a payload with
 * metadata attached. Their order is lost - go-redis hands them back as a map -
 * so the panel sorts by name, which is at least stable between reads.
 *
 * Body carries the whole entry as a JSON object. It is a rendering rather than
 * a field: picking one field and calling it the payload would be guessing at a
 * convention Redis does not have, and leaving it empty would give the copy
 * control and every generic viewer nothing to show.
 */
func messageOf(stream string, entry redis.XMessage) *model.MessageItem {
	properties := make(map[string]string, len(entry.Values))
	names := make([]string, 0, len(entry.Values))
	for name, value := range entry.Values {
		properties[name] = valueOf(value)
		names = append(names, name)
	}
	sort.Strings(names)

	ordered := make(map[string]string, len(properties))
	for _, name := range names {
		ordered[name] = properties[name]
	}
	body, err := json.Marshal(ordered)
	if err != nil {
		// A map of strings cannot fail to marshal; if it somehow does, an
		// empty body is better than losing the entry.
		body = []byte("{}")
	}

	milliseconds := millisecondsOf(entry.ID)
	return &model.MessageItem{
		Topic:     stream,
		MessageID: entry.ID,
		Body:      string(body),
		// A stream is one log, so there is no partition and no offset within
		// one. The id is the position, and it is already in MessageID.
		QueueID:        0,
		QueueOffset:    0,
		StoreTimestamp: milliseconds,
		StoreTime:      timestamp.FromUnixMilli(milliseconds),
		Status:         model.MsgNormal,
		Properties:     properties,
	}
}

// millisecondsOf reads the timestamp out of an entry id. It is not derived
// data: Redis generates the id from the clock, so the id is when the entry was
// added.
func millisecondsOf(id string) int64 {
	head, _, _ := strings.Cut(id, "-")
	milliseconds, err := strconv.ParseInt(head, 10, 64)
	if err != nil {
		return 0
	}
	return milliseconds
}

// valueOf renders a field value. Redis stores them as strings, but the RESP3
// decoder hands back whatever type the reply carried, so anything else is
// formatted rather than dropped.
func valueOf(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case nil:
		return ""
	default:
		return fmt.Sprint(typed)
	}
}
