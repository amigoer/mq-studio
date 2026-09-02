package redisstream

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/amigoer/mq-studio/internal/model"
)

// The reply shape is where a listing goes wrong quietly: a partition count
// invented from nothing, or an empty id written through as an empty cell.
func TestDestinationOf(t *testing.T) {
	info := &redis.XInfoStream{
		Length:            1204771,
		RadixTreeKeys:     11842,
		RadixTreeNodes:    23118,
		Groups:            3,
		LastGeneratedID:   "1756454646018-0",
		MaxDeletedEntryID: "1756454640000-2",
		EntriesAdded:      1300000,
		FirstEntry:        redis.XMessage{ID: "1756368200104-0"},
		LastEntry:         redis.XMessage{ID: "1756454646018-0"},
	}

	got := destinationOf("orders:events", info)

	if got.Ref.Name != "orders:events" {
		t.Errorf("name = %q", got.Ref.Name)
	}
	if got.Ref.Namespace != "" {
		t.Errorf("namespace = %q, want empty: the database is a connection setting", got.Ref.Namespace)
	}
	if got.Depth != 1204771 {
		t.Errorf("depth = %d, want the stream length", got.Depth)
	}
	if got.Subscribers != 3 {
		t.Errorf("subscribers = %d, want the group count", got.Subscribers)
	}
	// A stream is one log, and a 1 here would draw a partition column against
	// a family that has none.
	if got.Partitions != model.UnknownMetric {
		t.Errorf("partitions = %d, want UnknownMetric", got.Partitions)
	}
	// Redis reports no per-stream rates. A zero would read as "nothing is
	// flowing", which is a different claim from "this is not measured".
	if got.RateIn != model.UnknownMetric || got.RateOut != model.UnknownMetric {
		t.Errorf("rates = %d/%d, want UnknownMetric", got.RateIn, got.RateOut)
	}
	for key, want := range map[string]string{
		AttrLastGeneratedID:   "1756454646018-0",
		AttrFirstEntryID:      "1756368200104-0",
		AttrLastEntryID:       "1756454646018-0",
		AttrMaxDeletedEntryID: "1756454640000-2",
		AttrEntriesAdded:      "1300000",
		AttrRadixTreeKeys:     "11842",
		AttrRadixTreeNodes:    "23118",
	} {
		if got.Attributes[key] != want {
			t.Errorf("attribute %s = %q, want %q", key, got.Attributes[key], want)
		}
	}
}

// An empty stream reports empty ids and a max-deleted id of 0-0. Both mean
// "there is none", and writing them through would put an empty cell and a
// meaningless id where the page should show a dash.
func TestDestinationOfAnEmptyStreamOmitsTheAbsentIDs(t *testing.T) {
	got := destinationOf("fresh", &redis.XInfoStream{
		LastGeneratedID:   "0-0",
		MaxDeletedEntryID: "0-0",
	})

	for _, key := range []string{AttrFirstEntryID, AttrLastEntryID, AttrMaxDeletedEntryID} {
		if value, present := got.Attributes[key]; present {
			t.Errorf("attribute %s = %q, want it absent on an empty stream", key, value)
		}
	}
	if got.Depth != 0 {
		t.Errorf("depth = %d, want 0", got.Depth)
	}
}

// seedStream writes count entries and returns the connection's key.
func seedStream(t *testing.T, conn *Conn, key string, count int) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	for i := range count {
		err := conn.client.XAdd(ctx, &redis.XAddArgs{
			Stream: key,
			Values: map[string]any{"seq": strconv.Itoa(i)},
		}).Err()
		if err != nil {
			t.Fatalf("seed %s: %v", key, err)
		}
	}
}

func TestListDestinationsFindsOnlyStreams(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()

	seedStream(t, conn, "orders:events", 3)
	seedStream(t, conn, "payments:captured", 1)
	// The keyspace of a real server is mostly not streams. Without TYPE on the
	// scan these would be listed as destinations with no length and no groups.
	if err := conn.client.Set(ctx, "orders:counter", "7", 0).Err(); err != nil {
		t.Fatalf("seed string: %v", err)
	}
	if err := conn.client.LPush(ctx, "orders:queue", "a").Err(); err != nil {
		t.Fatalf("seed list: %v", err)
	}

	got, err := conn.ListDestinations(ctx, model.DestinationFilter{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	names := make([]string, 0, len(got))
	for _, destination := range got {
		names = append(names, destination.Ref.Name)
	}
	if len(names) != 2 {
		t.Fatalf("listed %v, want only the two streams", names)
	}
	if names[0] != "orders:events" || names[1] != "payments:captured" {
		t.Errorf("listed %v, want them sorted by key", names)
	}
	if got[0].Depth != 3 {
		t.Errorf("orders:events depth = %d, want 3", got[0].Depth)
	}
	// The id is the renderer's list key, not broker data, so it only has to be
	// stable and distinct within one listing.
	if got[0].ID == got[1].ID {
		t.Errorf("both rows carry id %d", got[0].ID)
	}
}

// The pattern is a connection setting because it is what the scan matches on.
// A driver that collected it and then scanned everything would make the field
// look like it did something.
func TestListDestinationsHonoursTheStreamFilter(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), map[string]string{OptionStreamFilter: "orders:*"}, nil)

	seedStream(t, conn, "orders:events", 1)
	seedStream(t, conn, "orders:settled", 1)
	seedStream(t, conn, "payments:captured", 1)

	got, err := conn.ListDestinations(context.Background(), model.DestinationFilter{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("listed %d streams, want the two matching orders:*", len(got))
	}
	for _, destination := range got {
		if destination.Ref.Name == "payments:captured" {
			t.Errorf("the filter did not exclude %q", destination.Ref.Name)
		}
	}
}

func TestListDestinationsOnAnEmptyKeyspace(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	got, err := conn.ListDestinations(context.Background(), model.DestinationFilter{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("listed %d streams on an empty server", len(got))
	}
}

func TestDestinationDetailNamesTheGroups(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()
	seedStream(t, conn, "orders:events", 4)
	for _, group := range []string{"settle-group", "notify-group"} {
		if err := conn.client.XGroupCreate(ctx, "orders:events", group, "0").Err(); err != nil {
			t.Fatalf("create group %s: %v", group, err)
		}
	}

	got, err := conn.DestinationDetail(ctx, model.DestinationRef{Name: "orders:events"})
	if err != nil {
		t.Fatalf("detail: %v", err)
	}
	// Counted from the group list this call already read, not from XINFO
	// STREAM's own field - which the in-process server does not fill in, and
	// which on a real server could disagree with the names beside it.
	if got.Subscribers != 2 {
		t.Errorf("subscribers = %d, want 2", got.Subscribers)
	}
	// The listing carries only the count, because the names are a second call.
	// The detail panel is where paying for it is worth it.
	names := got.Attributes[AttrGroupNames]
	if names != "settle-group,notify-group" && names != "notify-group,settle-group" {
		t.Errorf("group names = %q", names)
	}
}

// Redis has no command that makes an empty stream, so this goes the long way
// round through MKSTREAM. What must not happen is a placeholder entry showing
// up as the first message nobody sent.
func TestCreateDestinationLeavesAnEmptyStream(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()

	if err := conn.CreateDestination(ctx, model.DestinationSpec{
		Ref: model.DestinationRef{Name: "orders:new"},
	}); err != nil {
		t.Fatalf("create: %v", err)
	}

	length, err := conn.client.XLen(ctx, "orders:new").Result()
	if err != nil {
		t.Fatalf("xlen: %v", err)
	}
	if length != 0 {
		t.Errorf("the new stream holds %d entries, want none", length)
	}
	groups, err := conn.client.XInfoGroups(ctx, "orders:new").Result()
	if err != nil {
		t.Fatalf("xinfo groups: %v", err)
	}
	if len(groups) != 0 {
		t.Errorf("the bootstrap group was left behind: %+v", groups)
	}
	// And it is listed, which is the point of creating it.
	listed, err := conn.ListDestinations(ctx, model.DestinationFilter{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 1 || listed[0].Ref.Name != "orders:new" {
		t.Errorf("listed %d streams after creating one", len(listed))
	}
}

func TestCreateDestinationRefusesAKeyThatExists(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	seedStream(t, conn, "orders:events", 1)

	err := conn.CreateDestination(context.Background(), model.DestinationSpec{
		Ref: model.DestinationRef{Name: "orders:events"},
	})
	if err == nil {
		t.Fatal("creating an existing stream succeeded")
	}
}

func TestCreateDestinationNeedsAKey(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	if err := conn.CreateDestination(context.Background(), model.DestinationSpec{}); err == nil {
		t.Fatal("creating a stream with no key succeeded")
	}
}

func TestRemoveDestination(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()
	seedStream(t, conn, "orders:events", 2)

	if err := conn.RemoveDestination(ctx, model.DestinationRef{Name: "orders:events"}); err != nil {
		t.Fatalf("remove: %v", err)
	}
	listed, err := conn.ListDestinations(ctx, model.DestinationFilter{})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(listed) != 0 {
		t.Errorf("the stream is still listed after being deleted")
	}
}

// Deleting a key that is not there returns zero rather than an error, so
// without the check a delete of something already gone would report success
// and the page would remove a row that was never removed by this click.
func TestRemoveDestinationReportsAMissingStream(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	if err := conn.RemoveDestination(context.Background(), model.DestinationRef{Name: "gone"}); err == nil {
		t.Fatal("deleting a stream that does not exist succeeded")
	}
}

// The capability is never declared, so nothing reaches this - but the method
// exists because DestinationAdmin is one interface, and it has to say why
// rather than pretending to have done something.
func TestUpdateDestinationIsRefused(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	if err := conn.UpdateDestination(context.Background(), model.DestinationSpec{}); err == nil {
		t.Fatal("updating a stream succeeded, but a stream has no settings")
	}
}
