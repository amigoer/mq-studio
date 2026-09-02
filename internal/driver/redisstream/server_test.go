package redisstream

import (
	"context"
	"strings"
	"sync"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/alicebob/miniredis/v2/server"

	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * SLOWLOG GET's reply is nested arrays with no field names, and go-redis's
 * typed helper drops the last two - the client address and name. Those are the
 * two fields that turn "something ran a slow KEYS" into "that service ran a
 * slow KEYS", which is the whole reason anyone opens the page.
 */
func TestParseSlowLog(t *testing.T) {
	reply := []any{
		[]any{
			int64(14),
			int64(1756454646),
			int64(41200),
			[]any{"KEYS", "*"},
			"10.2.0.44:51234",
			"reporting-service",
		},
		[]any{
			int64(13),
			int64(1756454600),
			int64(9100),
			[]any{"XRANGE", "orders:events", "-", "+"},
			"10.2.0.45:51201",
			"",
		},
	}

	entries, err := parseSlowLog(reply)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("read %d entries, want 2", len(entries))
	}

	first := entries[0]
	if first.ID != 14 {
		t.Errorf("id = %d", first.ID)
	}
	// Redis reports seconds; the model carries milliseconds so it renders the
	// same way as every other timestamp in the app.
	if first.TimestampMs != 1756454646000 {
		t.Errorf("timestamp = %d, want milliseconds", first.TimestampMs)
	}
	// Microseconds, because the threshold that captured the entry is set in
	// them - rounding to milliseconds would put most entries at zero.
	if first.DurationMicros != 41200 {
		t.Errorf("duration = %d", first.DurationMicros)
	}
	if len(first.Command) != 2 || first.Command[0] != "KEYS" {
		t.Errorf("command = %v", first.Command)
	}
	if first.ClientAddress != "10.2.0.44:51234" || first.ClientName != "reporting-service" {
		t.Errorf("client = %q/%q", first.ClientAddress, first.ClientName)
	}
	// An unnamed client is common - most applications never call CLIENT
	// SETNAME - and is not a parse failure.
	if entries[1].ClientName != "" {
		t.Errorf("name = %q, want empty", entries[1].ClientName)
	}
}

/*
 * Redis before 4.0 sends four fields rather than six. The two missing ones are
 * absent rather than a reason to fail: a slow log with no client names is
 * still the answer to what has been slow.
 */
func TestParseSlowLogOlderReply(t *testing.T) {
	entries, err := parseSlowLog([]any{
		[]any{int64(3), int64(1756454646), int64(15000), []any{"DEBUG", "SLEEP", "0"}},
	})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("read %d entries", len(entries))
	}
	if entries[0].ClientAddress != "" || entries[0].ClientName != "" {
		t.Errorf("client = %q/%q, want both empty", entries[0].ClientAddress, entries[0].ClientName)
	}
	if len(entries[0].Command) != 3 {
		t.Errorf("command = %v", entries[0].Command)
	}
}

// One malformed row must not take a whole slow log down: the rest of it is
// still the answer someone came for.
func TestParseSlowLogSkipsUnreadableRows(t *testing.T) {
	entries, err := parseSlowLog([]any{
		"not a row",
		[]any{int64(1)},
		[]any{int64(2), int64(1756454646), int64(500), []any{"PING"}},
	})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(entries) != 1 || entries[0].ID != 2 {
		t.Errorf("entries = %+v, want only the readable row", entries)
	}

	if _, err := parseSlowLog("not a list"); err == nil {
		t.Error("parsing a reply that is not a list succeeded")
	}
}

// An argument that came back typed rather than as a bulk string is still part
// of the command, and dropping it would change what the logged command says.
func TestParseSlowLogRendersTypedArguments(t *testing.T) {
	entries, err := parseSlowLog([]any{
		[]any{int64(1), int64(1756454646), int64(500), []any{"EXPIRE", "key", int64(60)}},
	})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(entries[0].Command) != 3 || entries[0].Command[2] != "60" {
		t.Errorf("command = %v", entries[0].Command)
	}
}

// The other tasks in the vocabulary are RocketMQ's retention sweeps. Refusing
// by name rather than doing nothing is what stops a control drawn for another
// family reporting success here.
func TestRunMaintenanceRefusesTasksRedisDoesNotHave(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()

	for _, task := range []model.MaintenanceTask{
		model.TaskCleanExpiredQueues,
		model.TaskCleanUnusedTopics,
		model.TaskDeleteExpiredLogs,
		model.MaintenanceTask("whatever"),
	} {
		if err := conn.RunMaintenance(ctx, "", task); err == nil {
			t.Errorf("%s was accepted", task)
		}
	}
}

// Redis has no discovery tier: a cluster's nodes find each other over the
// cluster bus and sentinels are servers like any other. An empty map is the
// answer rather than an error, so the page renders "nothing here" instead of a
// failure.
func TestDirectoryConfigIsEmpty(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	settings, err := conn.DirectoryConfig(context.Background())
	if err != nil {
		t.Fatalf("directory config: %v", err)
	}
	if len(settings) != 0 {
		t.Errorf("directory config = %v, want empty", settings)
	}
}

// fakeSnapshots answers BGSAVE with a fixed reply and records the arguments it
// was called with. miniredis has no BGSAVE of its own, so this is the only
// place the snapshot path can be driven without a real server.
func fakeSnapshots(t *testing.T, srv *miniredis.Miniredis, reply func(*server.Peer)) *[]string {
	t.Helper()
	var (
		mu   sync.Mutex
		args []string
	)
	err := srv.Server().Register("BGSAVE", func(peer *server.Peer, _ string, cmdArgs []string) {
		mu.Lock()
		args = append(args, cmdArgs...)
		mu.Unlock()
		reply(peer)
	})
	if err != nil {
		t.Fatalf("register BGSAVE: %v", err)
	}
	return &args
}

/*
 * A server takes one snapshot at a time and, with the default save points on,
 * starts them by itself - so a click can land on a server that is already
 * writing the dataset down. That is the outcome the caller asked for, not a
 * failure, and reporting it as one put Redis's raw refusal on screen.
 *
 * The e2e broker proved the race is real rather than theoretical: its own
 * "100 changes in 300 seconds" save fired between the live suite's writes and
 * its BGSAVE.
 */
func TestRunMaintenanceAcceptsASnapshotAlreadyUnderway(t *testing.T) {
	srv := fakeServer(t)
	args := fakeSnapshots(t, srv, func(peer *server.Peer) {
		peer.WriteError("ERR Background save already in progress")
	})
	conn := fakeConn(t, srv, nil, nil)

	if err := conn.RunMaintenance(context.Background(), "", model.TaskSnapshot); err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	// SCHEDULE covers the other half of the race: a plain BGSAVE refuses
	// outright while an append-log rewrite holds the child slot.
	if len(*args) != 1 || !strings.EqualFold((*args)[0], "SCHEDULE") {
		t.Errorf("BGSAVE args = %v, want [SCHEDULE]", *args)
	}
}

// Only that one refusal is swallowed. Anything else is a server that could not
// take a snapshot, which the node board has to say out loud.
func TestRunMaintenanceReportsASnapshotRefusedForAnyOtherReason(t *testing.T) {
	srv := fakeServer(t)
	fakeSnapshots(t, srv, func(peer *server.Peer) {
		peer.WriteError("ERR Can't BGSAVE while AOF log rewriting is in progress")
	})
	conn := fakeConn(t, srv, nil, nil)

	err := conn.RunMaintenance(context.Background(), "", model.TaskSnapshot)
	if err == nil {
		t.Fatal("a refused snapshot was reported as a success")
	}
	if !strings.Contains(err.Error(), "AOF log rewriting") {
		t.Errorf("error = %v, want the server's reason", err)
	}
}
