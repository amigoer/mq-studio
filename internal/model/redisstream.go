package model

// The shapes only Redis Streams has.
//
// They live here beside the other families' own files - policy.go and
// replication.go are RabbitMQ's, and the reassignment and quota types are
// Kafka's - because the canonical vocabulary is what several families share,
// not the only thing that may be named.

// TrimStrategy is how a trim decides what to discard.
//
// The two are not interchangeable. A length keeps a count and lets the oldest
// go whatever they are; a minimum id keeps a moment and lets everything before
// it go however many that is. An operator reclaiming disk wants the first; one
// dropping everything before an incident wants the second.
type TrimStrategy string

const (
	TrimMaxLen TrimStrategy = "maxlen"
	TrimMinID  TrimStrategy = "minid"
)

// TrimRequest discards entries from the head of a stream.
type TrimRequest struct {
	Ref      DestinationRef `json:"ref"`
	Strategy TrimStrategy   `json:"strategy"`

	// MaxLen is how many of the newest entries to keep. Zero empties the
	// stream, which is the only "purge" Redis has - there is no separate
	// command, and offering one under another name would be two controls for
	// one thing.
	MaxLen int64 `json:"maxLen"`

	// MinID is the lowest entry id to keep. Everything before it goes.
	MinID string `json:"minId"`

	// Approx lets the server stop at a macro-node boundary rather than
	// splitting one, which is much cheaper and is what Redis's own docs
	// recommend. It means the stream may keep slightly more than asked, never
	// less, so a page that offers it has to say so.
	Approx bool `json:"approx"`
}

// TrimResult is what the trim actually did.
//
// The count matters even when Approx was set, and especially then: it is the
// only way to tell "kept a few extra at a node boundary" from "matched nothing
// and did nothing at all".
type TrimResult struct {
	Removed int64 `json:"removed"`
}

// PositionRequest moves where a subscription reads to a named place in the log.
//
// Separate from ResetOffsetRequest, which names a moment in time. A stream
// entry's id already is a moment - milliseconds and a sequence within them -
// so a timestamp alone cannot say which of the entries sharing a millisecond
// to start from, and cannot say "the end" at all. On a busy stream that
// sequence is the difference between replaying a batch and skipping it.
type PositionRequest struct {
	Ref SubscriptionRef `json:"ref"`

	// Position is an entry id, or one of the two the family spells specially:
	// "0" for the beginning of what the stream still holds, "$" for whatever
	// arrives next.
	Position string `json:"position"`
}

// StreamField is one field of an entry being written.
//
// A slice rather than a map, because XADD takes an ordered list and the order
// is the producer's. Reading loses it - the client hands fields back as a map -
// but writing must not: a form that reordered what someone typed would be
// changing the entry on the way out.
type StreamField struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// StreamAddRequest writes entries to a stream.
type StreamAddRequest struct {
	Ref    DestinationRef `json:"ref"`
	Fields []StreamField  `json:"fields"`

	// ID is an explicit entry id. Empty means the server generates one from
	// its clock, which is what almost every producer does and the only way to
	// keep ids monotonic without coordinating.
	ID string `json:"id"`

	// Count writes the same entry more than once, for filling a stream to test
	// a consumer. Each copy gets its own id.
	Count int `json:"count"`
}

// StreamAddResult is what the server assigned.
//
// The ids rather than a count, because an id is the only handle on an entry:
// without them a caller that has just written something has no way to look it
// up, delete it, or point a consumer group at it.
type StreamAddResult struct {
	IDs []string `json:"ids"`
}
