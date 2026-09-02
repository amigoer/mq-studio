package nats

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/nats-io/nats.go/jetstream"

	"github.com/amigoer/mq-studio/internal/model"
)

// Trim discards messages from the head of a stream.
//
// StreamTrimmer rather than QueueActions, and that is not a preference. A
// queue's vocabulary is purge, move and drop-a-batch; a log's is a bound to
// keep, and JetStream's purge takes exactly that - keep the newest N, or
// remove everything below sequence N. Emptying a stream is one setting of the
// first, which is why there is no separate purge here: offering both would be
// two controls for one command.
//
// The count is the whole report. Only it separates "removed nothing because
// the bound already held" from "removed nothing because the stream was already
// empty", and those look identical on the page otherwise.
func (c *Conn) Trim(ctx context.Context, request model.TrimRequest) (*model.TrimResult, error) {
	if err := c.requireJetStream(); err != nil {
		return nil, err
	}
	stream, err := c.js.Stream(ctx, request.Ref.Name)
	if err != nil {
		return nil, streamError(request.Ref.Name, err)
	}

	// The count has to be taken before and after: JetStream's purge answers
	// with the number of messages the stream holds afterwards, not with how
	// many it removed, and those are different questions.
	before, err := stream.Info(ctx)
	if err != nil {
		return nil, streamError(request.Ref.Name, err)
	}

	option, err := purgeOption(request)
	if err != nil {
		return nil, err
	}
	if err := stream.Purge(ctx, option); err != nil {
		return nil, streamError(request.Ref.Name, err)
	}

	after, err := stream.Info(ctx)
	if err != nil {
		return nil, streamError(request.Ref.Name, err)
	}
	return &model.TrimResult{Removed: removedBetween(before, after)}, nil
}

// purgeOption turns the canonical request into the one JetStream takes.
//
// Approx is accepted and has no effect, which is the honest reading rather
// than a shortcut: it means the server may keep a little more than asked and
// never less, and an exact purge satisfies that. Refusing it would make a
// shared control fail against one family for a promise it is already keeping.
func purgeOption(request model.TrimRequest) (jetstream.StreamPurgeOpt, error) {
	switch request.Strategy {
	case model.TrimMaxLen:
		if request.MaxLen < 0 {
			return nil, fmt.Errorf("cannot keep a negative number of messages")
		}
		// Zero is not a special case here: keeping none is emptying the
		// stream, which is what the operator asked for.
		return jetstream.WithPurgeKeep(uint64(request.MaxLen)), nil
	case model.TrimMinID:
		sequence, err := strconv.ParseUint(request.MinID, 10, 64)
		if err != nil {
			// Not a generic parse error: somebody who has come from another
			// family will type an id in that family's shape, and saying which
			// shape this one wants is the difference between a fixable
			// mistake and a mystery.
			return nil, fmt.Errorf(
				"%q is not a jetstream sequence; a message is addressed by one number for the whole stream",
				request.MinID)
		}
		// Purge removes everything *below* the sequence, so the message at it
		// survives - which is what "the lowest to keep" means.
		return jetstream.WithPurgeSequence(sequence), nil
	default:
		return nil, fmt.Errorf("unknown trim strategy %q", request.Strategy)
	}
}

// DeleteEntries removes messages by sequence.
//
// The count is how many were there to remove rather than how many were asked
// for, which is what lets a caller tell a successful delete from a no-op on
// sequences that had already gone.
func (c *Conn) DeleteEntries(ctx context.Context, ref model.DestinationRef, ids []string) (*model.TrimResult, error) {
	if err := c.requireJetStream(); err != nil {
		return nil, err
	}
	stream, err := c.js.Stream(ctx, ref.Name)
	if err != nil {
		return nil, streamError(ref.Name, err)
	}

	var removed int64
	for _, id := range ids {
		sequence, err := strconv.ParseUint(id, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("%q is not a jetstream sequence", id)
		}
		// SecureDeleteMsg would overwrite the message on disk as well as
		// removing it, at a cost the caller did not ask for. A delete here is
		// the ordinary one.
		switch err := stream.DeleteMsg(ctx, sequence); {
		case err == nil:
			removed++
		case alreadyGone(err):
			// Not a failure: the caller asked for it to be absent and it is,
			// and stopping here would leave the rest of the list undeleted for
			// no reason.
		default:
			return &model.TrimResult{Removed: removed}, streamError(ref.Name, err)
		}
	}
	return &model.TrimResult{Removed: removed}, nil
}

// removedBetween is how many messages went, from two stream snapshots.
//
// A subtraction rather than a figure the server reports, because it reports
// none: the purge response carries what the stream holds afterwards. On a
// stream something is publishing to concurrently the difference is a floor
// rather than an exact count, which is the same caveat every other family's
// trim carries.
func removedBetween(before, after *jetstream.StreamInfo) int64 {
	if before.State.Msgs <= after.State.Msgs {
		return 0
	}
	return int64(before.State.Msgs - after.State.Msgs)
}

// alreadyGone reports a delete of a sequence that is not there.
//
// It matches on the wire error code inside the message, which is not how this
// would be written if there were an alternative. DeleteMsg formats the API
// error into a string - fmt.Errorf("%w: %s", ErrMsgDeleteUnsuccessful,
// resp.Error.Error()) - so the structured error never reaches the caller and
// errors.As has nothing to find. The sentinel that survives says only that the
// delete failed, which is true of a permission refusal and a sealed stream as
// well, and treating those as "already gone" would report a delete that did
// not happen as one that did.
//
// The code rather than the description because the code is the wire contract
// and the description is prose the server is free to reword.
func alreadyGone(err error) bool {
	// Kept for the day the library stops flattening it: an errors.As match is
	// the right one and costs nothing to leave in place.
	var apiErr *jetstream.APIError
	if errors.As(err, &apiErr) {
		return apiErr.ErrorCode == jetstream.JSErrCodeMessageNotFound ||
			apiErr.ErrorCode == jsErrCodeSequenceNotFound
	}
	if !errors.Is(err, jetstream.ErrMsgDeleteUnsuccessful) {
		return false
	}
	return strings.Contains(err.Error(), fmt.Sprintf("err_code=%d", jsErrCodeSequenceNotFound)) ||
		strings.Contains(err.Error(), fmt.Sprintf("err_code=%d", jetstream.JSErrCodeMessageNotFound))
}

// jsErrCodeSequenceNotFound is the delete path's "sequence not found". The
// library names the read path's 10037 and not this one.
const jsErrCodeSequenceNotFound jetstream.ErrorCode = 10043
