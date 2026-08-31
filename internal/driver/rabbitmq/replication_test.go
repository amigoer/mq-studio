package rabbitmq

import (
	"strings"
	"testing"

	rabbithole "github.com/michaelklishin/rabbit-hole/v3"
)

/*
 * A shovel or federation URI is the one place the whole management API stores
 * another broker's password in plain text and hands it back on request. This
 * page is exactly the sort of thing that ends up in a screenshot, so the
 * credential is removed before it leaves the process.
 */
func TestShovelURIsAreRedacted(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want string
	}{
		{
			name: "user and password",
			raw:  "amqp://app:s3cret@upstream.example.com:5672/%2F",
			want: "amqp://app:***@upstream.example.com:5672/%2F",
		},
		{
			name: "password with punctuation",
			raw:  "amqps://app:p%40ss%3Aword@upstream:5671/orders",
			want: "amqps://app:***@upstream:5671/orders",
		},
		{
			name: "no credentials at all",
			raw:  "amqp://upstream.example.com:5672",
			want: "amqp://upstream.example.com:5672",
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got := redactURI(testCase.raw)
			if got != testCase.want {
				t.Errorf("redactURI = %q, want %q", got, testCase.want)
			}
			if strings.Contains(got, "s3cret") || strings.Contains(got, "p%40ss") {
				t.Errorf("the password survived redaction: %q", got)
			}
		})
	}
}

// An address this app cannot parse still must not leak a password, so
// everything before the last @ goes.
func TestUnparsableURIStillLosesItsPassword(t *testing.T) {
	got := redactURI("not a url at all app:s3cret@host")
	if strings.Contains(got, "s3cret") {
		t.Errorf("the password survived redaction of an unparsable address: %q", got)
	}
	if !strings.Contains(got, "host") {
		t.Errorf("redaction removed the host as well: %q", got)
	}
}

func TestRedactionHandlesAnEmptySet(t *testing.T) {
	if got := redactURIs(rabbithole.URISet{}); len(got) != 0 {
		t.Errorf("redactURIs on an empty set = %v", got)
	}
}

/*
 * A shovel moves one thing at each end - a queue or an exchange, never both -
 * and saying which is what makes the row readable at a glance.
 */
func TestShovelEndsAreDescribed(t *testing.T) {
	queueToExchange := &rabbithole.ShovelDefinition{
		SourceQueue: "orders.in", DestinationExchange: "ex.orders",
	}
	if got := shovelSource(queueToExchange); got != "queue orders.in" {
		t.Errorf("source = %q", got)
	}
	if got := shovelTarget(queueToExchange); got != "exchange ex.orders" {
		t.Errorf("target = %q", got)
	}

	// AMQP 1.0 shovels use an address instead, which is the fallback.
	addressed := &rabbithole.ShovelDefinition{
		SourceAddress: "/queues/orders", DestinationAddress: "/exchanges/out",
	}
	if got := shovelSource(addressed); got != "/queues/orders" {
		t.Errorf("source = %q", got)
	}
}

/*
 * The broker reports a shovel's state timestamp in UTC, in its own format,
 * with no zone marker and a single-digit hour. Passed through as it stood it
 * was drawn beside times rendered in the reader's own zone, so a reader eight
 * hours from UTC read it as eight hours wrong.
 */
func TestShovelTimestampCarriesItsZone(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want string
	}{
		{"single digit hour", "2026-08-31 4:15:18", "2026-08-31T04:15:18Z"},
		{"two digit hour", "2026-08-31 14:15:18", "2026-08-31T14:15:18Z"},
		{"single digit throughout", "2026-08-31 4:5:8", "2026-08-31T04:05:08Z"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := shovelTimestamp(testCase.raw); got != testCase.want {
				t.Errorf("shovelTimestamp(%q) = %q, want %q", testCase.raw, got, testCase.want)
			}
		})
	}
}

// A shovel that has never run reports no timestamp, and an empty string has to
// stay empty rather than becoming the zero time.
func TestShovelTimestampLeavesAnEmptyOneEmpty(t *testing.T) {
	if got := shovelTimestamp(""); got != "" {
		t.Errorf("shovelTimestamp(\"\") = %q", got)
	}
}

// A format this cannot read is passed through: a wrong-looking timestamp is
// more use than no timestamp.
func TestShovelTimestampPassesThroughWhatItCannotParse(t *testing.T) {
	if got := shovelTimestamp("some day soon"); got != "some day soon" {
		t.Errorf("shovelTimestamp = %q, want it passed through", got)
	}
}
