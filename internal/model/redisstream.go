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
