package pulsar

import (
	"testing"

	pulsarclient "github.com/apache/pulsar-client-go/pulsar"

	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * The id an operator pastes has to round-trip.
 *
 * pulsar-admin prints two parts for a non-partitioned topic and three for a
 * partitioned one, and both are what somebody copies out of a log. Refusing
 * the two-part form would make the lookup box reject the id the cluster's own
 * tooling just printed.
 */
func TestParseMessageID(t *testing.T) {
	cases := []struct {
		name      string
		raw       string
		ledger    int64
		entry     int64
		partition int
	}{
		{name: "three parts", raw: "12:34:2", ledger: 12, entry: 34, partition: 2},
		{name: "partition zero is a partition", raw: "12:34:0", ledger: 12, entry: 34, partition: 0},
		{
			name:      "two parts mean a non-partitioned topic",
			raw:       "12:34",
			ledger:    12,
			entry:     34,
			partition: -1,
		},
		{name: "surrounding space", raw: "  12:34:2  ", ledger: 12, entry: 34, partition: 2},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			ledger, entry, partition, err := parseMessageID(test.raw)
			if err != nil {
				t.Fatalf("parseMessageID(%q): %v", test.raw, err)
			}
			if ledger != test.ledger || entry != test.entry || partition != test.partition {
				t.Errorf("parseMessageID(%q) = %d:%d:%d, want %d:%d:%d",
					test.raw, ledger, entry, partition,
					test.ledger, test.entry, test.partition)
			}
		})
	}
}

// An id the driver cannot read is refused rather than half-parsed into one
// that addresses a different message.
func TestParseMessageIDRefusesWhatItCannotRead(t *testing.T) {
	for _, raw := range []string{"", "12", "12:34:2:9", "a:34", "12:b", "12:34:c", "  "} {
		if _, _, _, err := parseMessageID(raw); err == nil {
			t.Errorf("parseMessageID(%q) was accepted", raw)
		}
	}
}

/*
 * A tail position has to survive being written down and read back.
 *
 * QueuePosition's Offset is an int64 and a Pulsar position is a ledger, an
 * entry and a batch index. A tail that resumed from the offset alone would
 * start reading in whichever ledger happened to be current, which on a topic
 * that has rolled over is somewhere else entirely - and the symptom is
 * duplicate or missing lines rather than an error.
 */
func TestTailPositionRoundTrips(t *testing.T) {
	original := pulsarclient.EarliestMessageID()

	position := positionOf(3, original)
	if position.Node == "" {
		t.Fatal("the position carries no serialized id")
	}
	if position.QueueID != 3 {
		t.Errorf("queue id = %d, want the partition 3", position.QueueID)
	}

	resumed, err := resumeFrom(position)
	if err != nil {
		t.Fatalf("resumeFrom: %v", err)
	}
	if resumed.LedgerID() != original.LedgerID() || resumed.EntryID() != original.EntryID() {
		t.Errorf("resumed at %d:%d, want %d:%d",
			resumed.LedgerID(), resumed.EntryID(),
			original.LedgerID(), original.EntryID())
	}
}

/*
 * A position that cannot be read is an error, not a silent restart.
 *
 * Falling back to the latest message would make a tail that hit a corrupt
 * cursor quietly skip everything published since the last poll, which reads on
 * screen as a topic that went quiet.
 */
func TestResumeFromRefusesAnUnreadablePosition(t *testing.T) {
	for _, position := range []model.QueuePosition{
		{QueueID: 0},
		{Node: "not base64!!", QueueID: 0},
		{Node: "AAAA", QueueID: 0},
	} {
		if _, err := resumeFrom(position); err == nil {
			t.Errorf("resumeFrom(%+v) was accepted", position)
		}
	}
}

// The printed form is what Pulsar's own tooling prints, so an id copied out of
// this app can be pasted into pulsar-admin and back.
func TestMessageIDStringMatchesPulsarsOwnForm(t *testing.T) {
	id := pulsarclient.EarliestMessageID()

	got := messageIDString(id)
	ledger, entry, partition, err := parseMessageID(got)
	if err != nil {
		t.Fatalf("the driver cannot read back its own id %q: %v", got, err)
	}
	if ledger != id.LedgerID() || entry != id.EntryID() || int32(partition) != id.PartitionIdx() {
		t.Errorf("%q read back as %d:%d:%d", got, ledger, entry, partition)
	}
}
