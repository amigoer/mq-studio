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

// GroupConsumer is one member of a consumer group.
//
// It is not the canonical SubscriptionClient, and cannot be: that is a set of
// queue assignments with a broker and a queue id, pull and consume latencies,
// and a locked flag for ordered delivery. A group consumer has a name, how
// much it is holding, and how long it has been quiet - and filling the other
// shape would mean inventing every field but one.
//
// It is also not model.StreamConsumer, which is RabbitMQ's: a client attached
// over the stream protocol, with a connection, a peer host and an offset. The
// two are different objects that both reasonably answer to "stream consumer",
// which is why neither name is shared.
type GroupConsumer struct {
	Name string `json:"name"`
	// Pending is how many entries this consumer has been handed and not
	// acknowledged. They are its responsibility until it acknowledges them or
	// somebody claims them away.
	Pending int64 `json:"pending"`
	// IdleMs is how long since it last read anything. A high idle with a
	// pending count above zero is the shape of a consumer that died holding
	// work.
	IdleMs int64 `json:"idleMs"`
	// InactiveMs is how long since it last did anything at all, which Redis
	// tracks separately: a consumer polling an empty stream is idle but not
	// inactive. Redis 7.2 and later; zero on an older server.
	InactiveMs int64 `json:"inactiveMs"`
}

// PendingSummary is a group's pending list at a glance.
type PendingSummary struct {
	Ref SubscriptionRef `json:"ref"`

	// Count is how many entries the group is owed in total.
	Count int64 `json:"count"`
	// MinID and MaxID bound them. The oldest is what an operator acts on: it
	// is the entry that has been stuck the longest.
	MinID string `json:"minId"`
	MaxID string `json:"maxId"`

	// PerConsumer says who is holding what, which is how a single dead
	// consumer is told apart from a group that is generally behind.
	PerConsumer []PendingByConsumer `json:"perConsumer"`
}

// PendingByConsumer is one consumer's share of a pending list.
type PendingByConsumer struct {
	Consumer string `json:"consumer"`
	Count    int64  `json:"count"`
}

// PendingEntry is one delivery that has not been acknowledged.
//
// It is a delivery record rather than a message: what it carries is who was
// given the entry, how long ago, and how many times. The entry's own contents
// are a separate read, because a pending list of a thousand would otherwise
// fetch a thousand bodies nobody asked to see.
type PendingEntry struct {
	Ref SubscriptionRef `json:"ref"`

	ID       string `json:"id"`
	Consumer string `json:"consumer"`
	// IdleMs is how long since it was delivered. It is the column an operator
	// sorts by: an entry idle for hours is one nothing is coming back for.
	IdleMs int64 `json:"idleMs"`
	// Deliveries counts how many times it has been handed out. Above one means
	// something claimed it or a consumer restarted; climbing means an entry
	// that keeps being retried and keeps failing.
	Deliveries int64 `json:"deliveries"`
}

// PendingQuery narrows a group's pending list.
type PendingQuery struct {
	Ref SubscriptionRef `json:"ref"`

	// Consumer narrows to one consumer's share. Empty is all of them.
	Consumer string `json:"consumer"`
	// MinIdleMs narrows to entries nothing has touched for at least this long,
	// which is how the ones worth acting on are found.
	MinIdleMs int64 `json:"minIdleMs"`
	// Start and End bound the ids. Empty means the whole list.
	Start string `json:"start"`
	End   string `json:"end"`
	Count int    `json:"count"`
}

// ClaimRequest moves named entries to another consumer.
type ClaimRequest struct {
	Ref SubscriptionRef `json:"ref"`
	// Consumer is the new owner. It need not exist yet - claiming creates it,
	// which is how a replacement worker takes over from a dead one.
	Consumer string   `json:"consumer"`
	IDs      []string `json:"ids"`
	// MinIdleMs refuses to claim anything touched more recently than this. It
	// is the guard against taking work from a consumer that is simply busy:
	// zero claims regardless, which is a choice rather than a default.
	MinIdleMs int64 `json:"minIdleMs"`
}

// AutoClaimRequest moves whatever has been idle too long, without naming ids.
type AutoClaimRequest struct {
	Ref       SubscriptionRef `json:"ref"`
	Consumer  string          `json:"consumer"`
	MinIdleMs int64           `json:"minIdleMs"`
	// Start is where to resume from, for walking a long pending list. Empty
	// starts at the beginning.
	Start string `json:"start"`
	Count int    `json:"count"`
}

// ClaimResult is what a claim moved.
type ClaimResult struct {
	// Claimed are the entries that changed owner.
	Claimed []string `json:"claimed"`

	// Deleted are ids that were in the pending list and no longer in the
	// stream - trimmed or XDEL'd while owed to somebody. An auto-claim drops
	// them from the pending list, and reporting them is the only way an
	// operator learns that work was lost rather than moved.
	Deleted []string `json:"deleted"`

	// NextStart is where a further auto-claim would resume. "0-0" means the
	// walk reached the end.
	NextStart string `json:"nextStart"`
}

// AckResult is what an acknowledgement settled.
type AckResult struct {
	// Acknowledged is how many of the named ids were actually owed. It is not
	// how many were asked for: acknowledging an id twice succeeds and settles
	// nothing.
	Acknowledged int64 `json:"acknowledged"`
}

// SlowLogEntry is one command the server recorded as slow.
//
// It is the only view in this app of a single request rather than of an
// aggregate, which is what makes it worth having: an average hides the one
// KEYS somebody ran against a million-key database, and that one command is
// usually the whole answer.
type SlowLogEntry struct {
	// ID is the server's own sequence number, which only ever increases. It is
	// how a reader tells a new entry from one they have already looked at.
	ID int64 `json:"id"`

	// TimestampMs is when the command ran, and DurationMicros how long it took
	// - microseconds because the threshold that captured it is set in them,
	// and rounding to milliseconds would put most entries at zero.
	TimestampMs    int64 `json:"timestampMs"`
	DurationMicros int64 `json:"durationMicros"`

	// Command is the command and its arguments as the server recorded them.
	// Redis truncates both the argument count and each argument's length, so
	// this is what was logged rather than what was sent.
	Command []string `json:"command"`

	// Client is who ran it. The name is whatever that connection set with
	// CLIENT SETNAME, which for this app is the profile name - so an operator
	// can tell their own console apart from the service they are debugging.
	ClientAddress string `json:"clientAddress"`
	ClientName    string `json:"clientName"`
}
