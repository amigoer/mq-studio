package redisstream

import (
	"context"
	"fmt"
	"sort"

	"github.com/amigoer/mq-studio/internal/model"
)

// defaultSlowLogLimit is how many entries a slow-log read takes when the caller
// did not say. Redis keeps 128 by default, and reading all of them costs
// nothing.
const defaultSlowLogLimit = 128

// NodeConfig reads what a server is actually running with.
//
// CONFIG GET * rather than a list of interesting keys: what matters differs
// with what is being debugged, and a driver that picked would be deciding for
// the reader. The page filters.
func (c *Conn) NodeConfig(ctx context.Context, address string) (map[string]string, error) {
	client, release := c.clientFor(address)
	defer release()

	settings, err := client.ConfigGet(ctx, "*").Result()
	if err != nil {
		return nil, fmt.Errorf("read the configuration of %q: %w", address, err)
	}
	return settings, nil
}

// DirectoryConfig is empty. Redis has no discovery tier of its own: a cluster's
// nodes find each other over the cluster bus and a sentinel deployment's
// sentinels are servers like any other, so there is nothing here that is not
// already a node.
func (c *Conn) DirectoryConfig(context.Context) (map[string]string, error) {
	return map[string]string{}, nil
}

/*
 * RunMaintenance asks a server to do its housekeeping now.
 *
 * Both of Redis's are additive, which is unusual for this port: elsewhere it
 * reclaims disk by deleting what is past retention. A snapshot writes the
 * dataset down and a rewrite compacts the append-only file, and neither loses
 * anything - so the UI does not have to confirm them the way it confirms a
 * retention sweep.
 *
 * They are asynchronous. The server accepts the request and does the work in a
 * child process, so a success here means it started rather than finished; the
 * node page reads the last status back out of INFO, which is where the outcome
 * actually shows up.
 */
func (c *Conn) RunMaintenance(ctx context.Context, address string, task model.MaintenanceTask) error {
	client, release := c.clientFor(address)
	defer release()

	switch task {
	case model.TaskSnapshot:
		if err := client.BgSave(ctx).Err(); err != nil {
			return fmt.Errorf("start a snapshot on %q: %w", address, err)
		}
	case model.TaskRewriteAppendLog:
		if err := client.BgRewriteAOF(ctx).Err(); err != nil {
			return fmt.Errorf("start an append-log rewrite on %q: %w", address, err)
		}
	default:
		// The other tasks in the vocabulary are RocketMQ's retention sweeps.
		// Refusing by name rather than silently doing nothing is what stops a
		// button that was drawn for another family reporting success here.
		return fmt.Errorf("redis has no %q maintenance task", task)
	}
	return nil
}

/*
 * SlowLog reads what has actually been slow on a server.
 *
 * SLOWLOG GET's reply is nested arrays with no field names, and go-redis's
 * typed helper drops the client address and name - which are the two fields
 * that turn "something ran a slow KEYS" into "that service ran a slow KEYS".
 * So the raw reply is parsed here.
 */
func (c *Conn) SlowLog(ctx context.Context, address string, limit int) ([]*model.SlowLogEntry, error) {
	client, release := c.clientFor(address)
	defer release()

	if limit <= 0 {
		limit = defaultSlowLogLimit
	}
	reply, err := client.Do(ctx, "SLOWLOG", "GET", limit).Result()
	if err != nil {
		return nil, fmt.Errorf("read the slow log of %q: %w", address, err)
	}
	entries, err := parseSlowLog(reply)
	if err != nil {
		return nil, fmt.Errorf("read the slow log of %q: %w", address, err)
	}
	// Newest first: the page is opened after something went wrong, not before.
	sort.SliceStable(entries, func(left, right int) bool { return entries[left].ID > entries[right].ID })
	return entries, nil
}

/*
 * parseSlowLog reads the SLOWLOG GET reply.
 *
 * Six fields per entry since Redis 4.0: the sequence number, when it ran, how
 * long it took in microseconds, the command with its arguments, the client
 * address and the client name. An older server sends four, and the two missing
 * ones are simply absent rather than a reason to fail - a slow log with no
 * client names is still the answer to what has been slow.
 */
func parseSlowLog(reply any) ([]*model.SlowLogEntry, error) {
	rows, ok := reply.([]any)
	if !ok {
		return nil, fmt.Errorf("unexpected reply shape %T", reply)
	}

	entries := make([]*model.SlowLogEntry, 0, len(rows))
	for _, row := range rows {
		fields, ok := row.([]any)
		if !ok || len(fields) < 4 {
			continue
		}
		entry := &model.SlowLogEntry{
			ID:             intOf(fields[0]),
			TimestampMs:    intOf(fields[1]) * 1000,
			DurationMicros: intOf(fields[2]),
			Command:        stringsOf(fields[3]),
		}
		if len(fields) > 4 {
			entry.ClientAddress = stringOf(fields[4])
		}
		if len(fields) > 5 {
			entry.ClientName = stringOf(fields[5])
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

// intOf reads a reply value that should be an integer. RESP2 gives int64 and
// RESP3 can give other widths, so anything unreadable is zero rather than a
// failure that would take a whole slow log down for one malformed row.
func intOf(value any) int64 {
	switch typed := value.(type) {
	case int64:
		return typed
	case int:
		return int64(typed)
	case float64:
		return int64(typed)
	default:
		return 0
	}
}

func stringOf(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	return ""
}

// stringsOf renders a command's arguments. Redis logs them as bulk strings,
// but an argument that was a number can come back typed, so anything else is
// formatted rather than dropped - an argument missing from a logged command
// changes what it says.
func stringsOf(value any) []string {
	raw, ok := value.([]any)
	if !ok {
		return nil
	}
	parts := make([]string, 0, len(raw))
	for _, item := range raw {
		if text, ok := item.(string); ok {
			parts = append(parts, text)
			continue
		}
		parts = append(parts, fmt.Sprint(item))
	}
	return parts
}
