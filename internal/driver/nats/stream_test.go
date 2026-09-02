package nats

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/nats-io/nats.go/jetstream"

	"github.com/amigoer/mq-studio/internal/model"
)

// jetStreamConn opens a connection to a fixture with JetStream on.
func jetStreamConn(t *testing.T) *Conn {
	t.Helper()
	return open(t, startServer(t, serverOptions{jetStream: true, jetStreamAccount: true}), false, false)
}

func testContext(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	t.Cleanup(cancel)
	return ctx
}

// declare builds a stream the way the board would, through the driver.
func declare(t *testing.T, conn *Conn, name string, attributes map[string]string) {
	t.Helper()
	spec := model.DestinationSpec{
		Ref:        model.DestinationRef{Name: name},
		Attributes: attributes,
	}
	if err := conn.CreateDestination(testContext(t), spec); err != nil {
		t.Fatalf("CreateDestination(%s): %v", name, err)
	}
}

func TestStreamsAreListedWithWhatTheyHold(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{
		AttrSubjects:  "orders.created, orders.shipped",
		AttrRetention: "limits",
		AttrStorage:   "memory",
	})

	destinations, err := conn.ListDestinations(testContext(t), model.DestinationFilter{})
	if err != nil {
		t.Fatalf("ListDestinations: %v", err)
	}
	if len(destinations) != 1 {
		t.Fatalf("listed %d streams, want 1", len(destinations))
	}

	orders := destinations[0]
	if orders.Ref.Name != "ORDERS" {
		t.Errorf("name = %q, want ORDERS", orders.Ref.Name)
	}
	if orders.Depth != 0 {
		t.Errorf("depth = %d, want 0 on a stream nothing has been published to", orders.Depth)
	}
	// Not zero, and not a subject count either: a stream has no partitions,
	// and a number under that heading would mean something it does not.
	if orders.Partitions != model.UnknownMetric {
		t.Errorf("partitions = %d, want UnknownMetric - a stream has none", orders.Partitions)
	}
	// A rate would have to be two samples divided by the time between them.
	// Reporting zero would put an invented figure beside real ones.
	if orders.RateIn != model.UnknownMetric || orders.RateOut != model.UnknownMetric {
		t.Errorf("rates = %d/%d, want UnknownMetric - JetStream reports no rate per stream",
			orders.RateIn, orders.RateOut)
	}
	if got := orders.Attributes[AttrSubjects]; got != "orders.created, orders.shipped" {
		t.Errorf("subjects = %q, want both", got)
	}
	if got := orders.Attributes[AttrStorage]; got != "memory" {
		t.Errorf("storage = %q, want memory", got)
	}
}

// A stream with nothing in it has no first or last message, and the zero time
// would render as a date in 1970 beside figures that are real.
func TestAnEmptyStreamReportsNoFirstOrLastTime(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "EMPTY", map[string]string{AttrSubjects: "empty.>"})

	destination, err := conn.DestinationDetail(testContext(t), model.DestinationRef{Name: "EMPTY"})
	if err != nil {
		t.Fatalf("DestinationDetail: %v", err)
	}
	if got, ok := destination.Attributes[AttrFirstTime]; ok {
		t.Errorf("first time = %q on an empty stream, want it absent", got)
	}
	if got, ok := destination.Attributes[AttrLastTime]; ok {
		t.Errorf("last time = %q on an empty stream, want it absent", got)
	}
}

// KV buckets and object stores are streams underneath. Listing them beside the
// ones somebody declared would put rows nobody made above the ones they did.
func TestInternalStreamsAreHiddenUnlessAskedFor(t *testing.T) {
	conn := jetStreamConn(t)
	ctx := testContext(t)

	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	if _, err := conn.js.CreateKeyValue(ctx, jetstream.KeyValueConfig{Bucket: "settings"}); err != nil {
		t.Fatalf("CreateKeyValue: %v", err)
	}

	visible, err := conn.ListDestinations(ctx, model.DestinationFilter{})
	if err != nil {
		t.Fatalf("ListDestinations: %v", err)
	}
	for _, destination := range visible {
		if strings.HasPrefix(destination.Ref.Name, "KV_") {
			t.Errorf("%s was listed as an ordinary stream", destination.Ref.Name)
		}
	}

	all, err := conn.ListDestinations(ctx, model.DestinationFilter{IncludeInternal: true})
	if err != nil {
		t.Fatalf("ListDestinations(internal): %v", err)
	}
	if len(all) <= len(visible) {
		t.Errorf("asking for internal streams returned %d, no more than the %d without",
			len(all), len(visible))
	}
}

func TestDestinationStatsBreaksDownBySubject(t *testing.T) {
	conn := jetStreamConn(t)
	ctx := testContext(t)
	declare(t, conn, "EVENTS", map[string]string{AttrSubjects: "events.>"})

	for range 5 {
		if _, err := conn.js.Publish(ctx, "events.a", []byte("x")); err != nil {
			t.Fatalf("publish: %v", err)
		}
	}
	if _, err := conn.js.Publish(ctx, "events.b", []byte("x")); err != nil {
		t.Fatalf("publish: %v", err)
	}

	stats, err := conn.DestinationStats(ctx, model.DestinationRef{Name: "EVENTS"})
	if err != nil {
		t.Fatalf("DestinationStats: %v", err)
	}
	subjects, ok := stats["subjects"].([]map[string]interface{})
	if !ok {
		t.Fatalf("subjects = %T, want a list", stats["subjects"])
	}
	if len(subjects) != 2 {
		t.Fatalf("broke down into %d subjects, want 2", len(subjects))
	}
	// Largest first: the reason to open this page is to find what is filling
	// the stream, and an alphabetical list buries it.
	if subjects[0]["subject"] != "events.a" || subjects[0]["messages"].(uint64) != 5 {
		t.Errorf("first row = %v, want events.a with 5", subjects[0])
	}
}

// A stream name is not a subject, and the commonest mistake is pasting one in.
// The server's own "invalid stream name" leaves the user staring at something
// that looks fine.
func TestStreamNamesRefuseWhatTheServerWould(t *testing.T) {
	cases := []struct {
		name    string
		stream  string
		mention string
	}{
		{"a subject pasted in as a name", "orders.created", "dot"},
		{"a wildcard", "orders.*", "dot"},
		{"a greater-than", "orders>", "wildcard"},
		{"a space", "my stream", "spaces"},
		{"a slash", "orders/new", "slash"},
		{"nothing at all", "", "needs a name"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			_, err := streamConfigOf(model.DestinationSpec{
				Ref:        model.DestinationRef{Name: test.stream},
				Attributes: map[string]string{AttrSubjects: "a.b"},
			})
			if err == nil {
				t.Fatalf("streamConfigOf(%q) was accepted", test.stream)
			}
			if !strings.Contains(err.Error(), test.mention) {
				t.Errorf("error %q does not mention %q, so it does not say what to fix",
					err, test.mention)
			}
		})
	}
}

// A > matches the rest of a subject and only means anything at the end.
// Anywhere else it silently matches nothing, and the stream sits there
// collecting no messages with nothing on screen to say why.
func TestSubjectsRefuseWildcardsWhereTheyMatchNothing(t *testing.T) {
	cases := []struct {
		name     string
		subjects string
		valid    bool
	}{
		{name: "a plain subject", subjects: "orders.created", valid: true},
		{name: "a token wildcard", subjects: "orders.*.created", valid: true},
		{name: "a trailing catch-all", subjects: "orders.>", valid: true},
		{name: "a catch-all in the middle", subjects: "orders.>.created"},
		{name: "a wildcard glued to a token", subjects: "orders.new*"},
		{name: "an empty token", subjects: "orders..created"},
		// A space separates the list rather than sitting inside a subject:
		// NATS subjects cannot contain one, so two words are two subjects.
		{name: "a space separates two subjects", subjects: "orders new", valid: true},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			_, err := streamConfigOf(model.DestinationSpec{
				Ref:        model.DestinationRef{Name: "S"},
				Attributes: map[string]string{AttrSubjects: test.subjects},
			})
			if test.valid && err != nil {
				t.Fatalf("streamConfigOf(%q): %v", test.subjects, err)
			}
			if !test.valid && err == nil {
				t.Fatalf("streamConfigOf(%q) was accepted", test.subjects)
			}
		})
	}
}

// Unlimited is -1 in this API and zero in nobody's mental model. A blank field
// falling through as zero would be a stream that can hold no messages at all.
func TestBlankLimitsMeanUnlimitedRatherThanZero(t *testing.T) {
	config, err := streamConfigOf(model.DestinationSpec{
		Ref:        model.DestinationRef{Name: "S"},
		Attributes: map[string]string{AttrSubjects: "s.>"},
	})
	if err != nil {
		t.Fatalf("streamConfigOf: %v", err)
	}
	if config.MaxMsgs != -1 || config.MaxBytes != -1 || config.MaxMsgsPerSubject != -1 {
		t.Errorf("limits = %d/%d/%d, want -1 each", config.MaxMsgs, config.MaxBytes, config.MaxMsgsPerSubject)
	}
	// Age is the one where zero really is the server's "no limit", so a blank
	// field must reach it as zero rather than as -1.
	if config.MaxAge != 0 {
		t.Errorf("max age = %v, want 0 - that is how the server spells no limit", config.MaxAge)
	}
}

func TestDurationsAreReadTheWayPeopleWriteThem(t *testing.T) {
	cases := []struct {
		name  string
		raw   string
		want  time.Duration
		valid bool
	}{
		{name: "hours", raw: "24h", want: 24 * time.Hour, valid: true},
		{name: "minutes", raw: "10m", want: 10 * time.Minute, valid: true},
		{name: "blank is no limit", raw: "", want: 0, valid: true},
		{name: "a bare number is not a duration", raw: "86400"},
		{name: "negative is not a limit", raw: "-1h"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			got, err := durationAttr(map[string]string{AttrMaxAge: test.raw}, AttrMaxAge)
			if test.valid {
				if err != nil {
					t.Fatalf("durationAttr(%q): %v", test.raw, err)
				}
				if got != test.want {
					t.Errorf("durationAttr(%q) = %v, want %v", test.raw, got, test.want)
				}
				return
			}
			if err == nil {
				t.Fatalf("durationAttr(%q) = %v, want an error", test.raw, got)
			}
		})
	}
}

// A create that quietly rewrote an existing stream would take another
// application's messages with it.
func TestCreatingAStreamThatExistsIsRefused(t *testing.T) {
	conn := jetStreamConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})

	err := conn.CreateDestination(testContext(t), model.DestinationSpec{
		Ref:        model.DestinationRef{Name: "ORDERS"},
		Attributes: map[string]string{AttrSubjects: "something.else.>"},
	})
	if err == nil {
		t.Fatal("creating an existing stream succeeded and would have rewritten its subjects")
	}
}

func TestUpdatingAStreamChangesWhatItAccepts(t *testing.T) {
	conn := jetStreamConn(t)
	ctx := testContext(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.created"})

	err := conn.UpdateDestination(ctx, model.DestinationSpec{
		Ref:        model.DestinationRef{Name: "ORDERS"},
		Attributes: map[string]string{AttrSubjects: "orders.created, orders.shipped"},
	})
	if err != nil {
		t.Fatalf("UpdateDestination: %v", err)
	}

	destination, err := conn.DestinationDetail(ctx, model.DestinationRef{Name: "ORDERS"})
	if err != nil {
		t.Fatalf("DestinationDetail: %v", err)
	}
	if got := destination.Attributes[AttrSubjects]; got != "orders.created, orders.shipped" {
		t.Errorf("subjects after update = %q, want both", got)
	}
}

func TestRemovingAStreamTakesItOutOfTheListing(t *testing.T) {
	conn := jetStreamConn(t)
	ctx := testContext(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})

	if err := conn.RemoveDestination(ctx, model.DestinationRef{Name: "ORDERS"}); err != nil {
		t.Fatalf("RemoveDestination: %v", err)
	}
	destinations, err := conn.ListDestinations(ctx, model.DestinationFilter{})
	if err != nil {
		t.Fatalf("ListDestinations: %v", err)
	}
	if len(destinations) != 0 {
		t.Errorf("listed %d streams after removing the only one", len(destinations))
	}
}

// A stream that is not there has to be named in the error. The library's own
// message carries no name, and a board that asked about one stream while
// showing three would have nothing to attach the failure to.
func TestAMissingStreamIsNamedInTheError(t *testing.T) {
	conn := jetStreamConn(t)
	_, err := conn.DestinationDetail(testContext(t), model.DestinationRef{Name: "ABSENT"})
	if err == nil {
		t.Fatal("reading a stream that does not exist succeeded")
	}
	if !strings.Contains(err.Error(), "ABSENT") {
		t.Errorf("error %q does not name the stream", err)
	}
}

// Every one of these arrives on a connection whose pages are still reachable -
// the capability is degraded, not absent - so each has to be refused with the
// reason the probe found rather than with a nil-pointer panic.
func TestStreamCallsOnAServerWithoutJetStreamSayWhy(t *testing.T) {
	conn := open(t, startServer(t, serverOptions{}), false, false)
	ctx := testContext(t)

	calls := map[string]func() error{
		"list": func() error {
			_, err := conn.ListDestinations(ctx, model.DestinationFilter{})
			return err
		},
		"detail": func() error {
			_, err := conn.DestinationDetail(ctx, model.DestinationRef{Name: "S"})
			return err
		},
		"stats": func() error {
			_, err := conn.DestinationStats(ctx, model.DestinationRef{Name: "S"})
			return err
		},
		"create": func() error {
			return conn.CreateDestination(ctx, model.DestinationSpec{
				Ref: model.DestinationRef{Name: "S"}, Attributes: map[string]string{AttrSubjects: "s.>"},
			})
		},
		"update": func() error {
			return conn.UpdateDestination(ctx, model.DestinationSpec{
				Ref: model.DestinationRef{Name: "S"}, Attributes: map[string]string{AttrSubjects: "s.>"},
			})
		},
		"remove": func() error {
			return conn.RemoveDestination(ctx, model.DestinationRef{Name: "S"})
		},
	}
	for name, call := range calls {
		t.Run(name, func(t *testing.T) {
			err := call()
			if err == nil {
				t.Fatal("succeeded against a server that stores nothing")
			}
			if err.Error() != jetStreamDisabled {
				t.Errorf("error = %q, want the bare key %q so the renderer can translate it",
					err, jetStreamDisabled)
			}
		})
	}
}

// The five stream capabilities are degraded rather than dropped, so the page
// stays in the sidebar and explains itself. One that vanished would read as an
// app that had lost a feature.
func TestStreamCapabilitiesAreDegradedNotDroppedWithoutJetStream(t *testing.T) {
	conn := open(t, startServer(t, serverOptions{}), false, false)
	capabilities := conn.Capabilities()

	for _, capability := range jetStreamCapabilities {
		if capabilities.Has(capability) {
			t.Errorf("%s is still supported on a server without jetstream", capability)
		}
		reason, degraded := capabilities.DegradedReason(capability)
		if !degraded {
			t.Errorf("%s is absent rather than degraded; the page would vanish", capability)
		}
		if reason != jetStreamDisabled {
			t.Errorf("%s degraded with %q, want %q", capability, reason, jetStreamDisabled)
		}
	}
}
