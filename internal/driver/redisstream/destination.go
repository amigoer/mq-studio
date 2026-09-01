package redisstream

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/redis/go-redis/v9"

	"github.com/amigoer/mq-studio/internal/model"
)

// Attribute keys the stream list and detail carry beyond the canonical fields.
//
// They are a contract between this package and frontend/src/mq/redis, not part
// of the shared vocabulary: what they mean is Redis's business, and another
// family spelling one of them the same way would be a coincidence.
const (
	AttrLastGeneratedID   = "lastGeneratedId"
	AttrFirstEntryID      = "firstEntryId"
	AttrLastEntryID       = "lastEntryId"
	AttrMaxDeletedEntryID = "maxDeletedEntryId"
	AttrEntriesAdded      = "entriesAdded"
	AttrRadixTreeKeys     = "radixTreeKeys"
	AttrRadixTreeNodes    = "radixTreeNodes"
	AttrMemoryBytes       = "memoryBytes"
	AttrGroupNames        = "groupNames"
)

const (
	// scanBatch is the COUNT hint on each SCAN step. It is a hint about work
	// per call rather than a page size, and a larger one means fewer round
	// trips over a keyspace that is mostly not streams.
	scanBatch = 500

	// maxStreams bounds what one listing returns.
	//
	// SCAN walks the whole keyspace whatever the filter, so on a large server
	// the cost is in the walking rather than in the matches. The cap stops a
	// page from trying to render tens of thousands of rows and stops the walk
	// from outliving its usefulness; the connection form's key pattern is the
	// control that actually narrows it. The page says how many it found rather
	// than presenting the number as a total.
	maxStreams = 2000
)

// ListDestinations enumerates the streams in the connected database.
//
// SCAN with TYPE stream, not KEYS: KEYS blocks the server for the length of
// the keyspace, which on the production server someone is debugging is the
// worst thing this app could do. The trade is that SCAN is a cursor rather
// than a snapshot - a key created midway through may be missed - so what comes
// back is what the walk found, and the page says so.
func (c *Conn) ListDestinations(ctx context.Context, filter model.DestinationFilter) ([]*model.Destination, error) {
	keys, err := c.scanStreams(ctx)
	if err != nil {
		return nil, err
	}
	sort.Strings(keys)

	infos, memory, err := c.describeStreams(ctx, keys)
	if err != nil {
		return nil, err
	}

	destinations := make([]*model.Destination, 0, len(keys))
	for index, key := range keys {
		info, ok := infos[key]
		if !ok {
			// The key was deleted between the scan and the describe. It is not
			// an error - it is a keyspace that moved - and listing it with no
			// figures would be worse than leaving it out.
			continue
		}
		destination := destinationOf(key, info)
		destination.ID = index + 1
		if bytes, ok := memory[key]; ok {
			destination.Attributes[AttrMemoryBytes] = strconv.FormatInt(bytes, 10)
		}
		destinations = append(destinations, destination)
	}
	return destinations, nil
}

// DestinationDetail describes one stream, with the names of the groups reading
// it. The names are a second call, which is why the listing carries only the
// count.
func (c *Conn) DestinationDetail(ctx context.Context, ref model.DestinationRef) (*model.Destination, error) {
	info, err := c.client.XInfoStream(ctx, ref.Name).Result()
	if err != nil {
		return nil, fmt.Errorf("describe stream %q: %w", ref.Name, err)
	}
	destination := destinationOf(ref.Name, info)

	if bytes, err := c.client.MemoryUsage(ctx, ref.Name).Result(); err == nil {
		destination.Attributes[AttrMemoryBytes] = strconv.FormatInt(bytes, 10)
	}

	groups, err := c.client.XInfoGroups(ctx, ref.Name).Result()
	if err != nil {
		// A stream with no groups answers with an empty list rather than an
		// error, so a failure here is the call itself and not an absence.
		return nil, fmt.Errorf("list groups of %q: %w", ref.Name, err)
	}
	names := make([]string, 0, len(groups))
	for _, group := range groups {
		names = append(names, group.Name)
	}
	// The count comes from the list just read rather than from XINFO STREAM's
	// own groups field. Both answer on a real server, and this one is the
	// authority: it is the thing the names were taken from, so the panel can
	// never show a count that disagrees with the chips beside it.
	destination.Subscribers = len(groups)
	destination.Attributes[AttrGroupNames] = strings.Join(names, ",")
	return destination, nil
}

/*
 * CreateDestination makes an empty stream.
 *
 * Redis has no command for it. XADD is the only thing that brings a stream into
 * existence, and it brings an entry with it - so creating one by writing a
 * placeholder would leave the first read showing a message nobody sent.
 *
 * XGROUP CREATE with MKSTREAM is the way round: it creates the key when it is
 * missing, and destroying the group afterwards leaves the stream behind, empty
 * and with a last-generated id of 0-0. The group is named for what it is so an
 * operator who catches it mid-flight can see it was not theirs.
 */
func (c *Conn) CreateDestination(ctx context.Context, spec model.DestinationSpec) error {
	name := strings.TrimSpace(spec.Ref.Name)
	if name == "" {
		return fmt.Errorf("a stream needs a key")
	}
	exists, err := c.client.Exists(ctx, name).Result()
	if err != nil {
		return fmt.Errorf("check whether %q exists: %w", name, err)
	}
	if exists > 0 {
		return fmt.Errorf("%q already exists", name)
	}

	const bootstrap = "mq-studio-create"
	if err := c.client.XGroupCreateMkStream(ctx, name, bootstrap, "0").Err(); err != nil {
		return fmt.Errorf("create stream %q: %w", name, err)
	}
	if err := c.client.XGroupDestroy(ctx, name, bootstrap).Err(); err != nil {
		return fmt.Errorf("create stream %q: remove the bootstrap group: %w", name, err)
	}
	return nil
}

// UpdateDestination is not something Redis offers.
//
// A stream has no stored settings: no maxlen, no retention, no durability. The
// capability is never declared, so the orchestration layer refuses before this
// is reached - it exists because DestinationAdmin is one interface.
func (c *Conn) UpdateDestination(context.Context, model.DestinationSpec) error {
	return fmt.Errorf("a redis stream has no settings to change; trim it instead")
}

// RemoveDestination deletes the key, and with it every group and pending entry
// on it. Redis has no softer form: there is no drop-if-empty and no
// drop-if-unused.
func (c *Conn) RemoveDestination(ctx context.Context, ref model.DestinationRef) error {
	removed, err := c.client.Del(ctx, ref.Name).Result()
	if err != nil {
		return fmt.Errorf("delete stream %q: %w", ref.Name, err)
	}
	if removed == 0 {
		return fmt.Errorf("stream %q does not exist", ref.Name)
	}
	return nil
}

// destinationOf turns one XINFO STREAM reply into the canonical shape.
//
// Kept apart from the call so it can be tested on a reply rather than on a
// server, and so the two callers cannot disagree about what a field means.
func destinationOf(key string, info *redis.XInfoStream) *model.Destination {
	attributes := map[string]string{
		AttrLastGeneratedID: info.LastGeneratedID,
		AttrEntriesAdded:    strconv.FormatInt(info.EntriesAdded, 10),
		AttrRadixTreeKeys:   strconv.FormatInt(info.RadixTreeKeys, 10),
		AttrRadixTreeNodes:  strconv.FormatInt(info.RadixTreeNodes, 10),
	}
	// An empty stream has no first or last entry, and the reply carries an
	// empty id rather than omitting the field. Writing "" through would put an
	// empty cell where the page expects a dash for "there is none".
	if info.FirstEntry.ID != "" {
		attributes[AttrFirstEntryID] = info.FirstEntry.ID
	}
	if info.LastEntry.ID != "" {
		attributes[AttrLastEntryID] = info.LastEntry.ID
	}
	// 0-0 is what a stream that has never had an entry deleted reports. It is
	// a real answer meaning "none", not an id, so it does not travel.
	if info.MaxDeletedEntryID != "" && info.MaxDeletedEntryID != "0-0" {
		attributes[AttrMaxDeletedEntryID] = info.MaxDeletedEntryID
	}

	return &model.Destination{
		Ref:   model.DestinationRef{Name: key},
		Depth: info.Length,
		// A stream is one log. There is no partition to count, and reporting
		// one would put a 1 where the page should show nothing at all.
		Partitions:  model.UnknownMetric,
		Subscribers: int(info.Groups),
		// Redis keeps no per-stream rates. The server-wide command rate is on
		// the node page, where it is true; inventing a per-stream figure from
		// it would not be.
		RateIn:     model.UnknownMetric,
		RateOut:    model.UnknownMetric,
		Attributes: attributes,
	}
}

// scanStreams walks the keyspace for keys of type stream.
func (c *Conn) scanStreams(ctx context.Context) ([]string, error) {
	pattern := c.config.StreamFilter
	if pattern == "" {
		pattern = "*"
	}

	// A cluster's keyspace is spread over its masters and SCAN is per node, so
	// asking one of them would list a third of the streams and look correct.
	if cluster, ok := c.client.(*redis.ClusterClient); ok {
		var (
			mu   sync.Mutex
			keys []string
		)
		err := cluster.ForEachMaster(ctx, func(ctx context.Context, node *redis.Client) error {
			found, err := scanNode(ctx, node, pattern)
			if err != nil {
				return err
			}
			mu.Lock()
			keys = append(keys, found...)
			mu.Unlock()
			return nil
		})
		if err != nil {
			return nil, fmt.Errorf("scan the cluster for streams: %w", err)
		}
		if len(keys) > maxStreams {
			keys = keys[:maxStreams]
		}
		return keys, nil
	}

	keys, err := scanNode(ctx, c.client, pattern)
	if err != nil {
		return nil, fmt.Errorf("scan for streams: %w", err)
	}
	return keys, nil
}

// scanNode runs the cursor loop against one server.
func scanNode(ctx context.Context, client redis.Cmdable, pattern string) ([]string, error) {
	var (
		keys   []string
		cursor uint64
	)
	for {
		// TYPE stream is filtered by the server, so a keyspace that is mostly
		// hashes and strings costs one round trip per batch rather than a
		// TYPE call per key.
		found, next, err := client.ScanType(ctx, cursor, pattern, scanBatch, "stream").Result()
		if err != nil {
			return nil, err
		}
		keys = append(keys, found...)
		cursor = next
		if cursor == 0 || len(keys) >= maxStreams {
			break
		}
		// A cancelled context stops the walk rather than being noticed on the
		// next command: a scan of a large keyspace is the one place this
		// driver loops, so it is the one place that has to check.
		if err := ctx.Err(); err != nil {
			return nil, err
		}
	}
	if len(keys) > maxStreams {
		keys = keys[:maxStreams]
	}
	return keys, nil
}

// describeStreams asks for every stream's info and size in one round trip.
//
// A call per stream would make the list page cost as much as the number of
// streams on it. Pipelining keeps it to one exchange per node - go-redis
// splits a cluster pipeline by slot on its own.
func (c *Conn) describeStreams(ctx context.Context, keys []string) (map[string]*redis.XInfoStream, map[string]int64, error) {
	infos := make(map[string]*redis.XInfoStream, len(keys))
	memory := make(map[string]int64, len(keys))
	if len(keys) == 0 {
		return infos, memory, nil
	}

	pipeline := c.client.Pipeline()
	infoCmds := make(map[string]*redis.XInfoStreamCmd, len(keys))
	memoryCmds := make(map[string]*redis.IntCmd, len(keys))
	for _, key := range keys {
		infoCmds[key] = pipeline.XInfoStream(ctx, key)
		memoryCmds[key] = pipeline.MemoryUsage(ctx, key)
	}
	// Exec reports the first command that failed. A key deleted between the
	// scan and here is one of those, and it must not take the whole listing
	// down - so the error is read per command below and this one is only
	// fatal when nothing came back at all.
	if _, err := pipeline.Exec(ctx); err != nil && !isNoSuchKey(err) {
		if len(keys) > 0 && allFailed(infoCmds) {
			return nil, nil, fmt.Errorf("describe streams: %w", err)
		}
	}

	for key, cmd := range infoCmds {
		info, err := cmd.Result()
		if err != nil {
			continue
		}
		infos[key] = info
	}
	for key, cmd := range memoryCmds {
		bytes, err := cmd.Result()
		if err != nil {
			continue
		}
		memory[key] = bytes
	}
	return infos, memory, nil
}

// isNoSuchKey is the reply for a key that is gone, which during a listing is
// ordinary: the scan and the describe are separate moments.
func isNoSuchKey(err error) bool {
	return err == redis.Nil || redis.HasErrorPrefix(err, "no such key")
}

func allFailed(commands map[string]*redis.XInfoStreamCmd) bool {
	for _, cmd := range commands {
		if cmd.Err() == nil {
			return false
		}
	}
	return true
}
