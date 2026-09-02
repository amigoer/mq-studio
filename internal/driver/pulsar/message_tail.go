package pulsar

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	pulsarclient "github.com/apache/pulsar-client-go/pulsar"
	"github.com/apache/pulsar-client-go/pulsaradmin/pkg/utils"

	"github.com/amigoer/mq-studio/internal/model"
)

// tailPoll is how long one poll waits for something to arrive.
//
// Short on purpose: a tail that blocked would hold the request until a message
// happened to be published, and a quiet topic is a normal thing to be watching.
const tailPoll = 2 * time.Second

/*
 * TailMessages follows a topic from where the last poll left off.
 *
 * A Reader again, for the same reason a browse uses one: it takes no
 * subscription, moves nobody's position and leaves nothing on the broker, so a
 * tail on a production topic is invisible to the consumers reading it.
 *
 * The cursor is the whole mechanism. It carries the serialized message id
 * rather than an offset, because a Pulsar position is a ledger and an entry
 * and resuming from the entry alone would start reading in the wrong ledger.
 *
 * Every poll opens a reader and closes it. That is deliberate: a reader held
 * between polls would keep a broker-side cursor open for a page somebody may
 * have navigated away from, and the seek that replaces it is cheap.
 */
func (c *Conn) TailMessages(
	ctx context.Context, ref model.DestinationRef, cursor model.TailCursor, limit int,
) (*model.TailBatch, error) {
	url, err := tailTopicURL(ref)
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > readMaxResults {
		limit = readMaxResults
	}

	reader, resumed, err := c.openTail(ctx, url, cursor)
	if err != nil {
		return nil, err
	}
	defer reader.Close()

	deadline, cancel := context.WithTimeout(ctx, tailPoll)
	defer cancel()

	batch := &model.TailBatch{
		Messages: make([]*model.MessageItem, 0, limit),
		// The cursor starts as what was passed in, so a poll that returns
		// nothing still hands back somewhere to resume from. A batch that
		// returned an empty cursor would send the next poll back to the end of
		// the topic and replay whatever arrived in between.
		Cursor: cursor,
	}

	last := resumed
	for len(batch.Messages) < limit {
		if !reader.HasNext() {
			break
		}
		message, err := reader.Next(deadline)
		if err != nil {
			if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
				break
			}
			return nil, fmt.Errorf("tail %s: %w", url, err)
		}
		batch.Messages = append(batch.Messages, messageItem(url, len(batch.Messages)+1, message))
		last = message.ID()
	}

	if last != nil {
		batch.Cursor = model.TailCursor{
			Positions: []model.QueuePosition{positionOf(last.PartitionIdx(), last)},
		}
	}
	return batch, nil
}

/*
 * openTail resumes where the cursor left off, or starts at the end.
 *
 * An empty cursor means the end, because that is what makes a tail a tail: it
 * shows what arrives from now on rather than replaying the topic, which is
 * what the browse is for.
 *
 * But "the end" is resolved to a concrete id here rather than left as
 * LatestMessageID, and that is the whole correctness of this file. A poll that
 * read nothing has no message to build a cursor from, so it would hand back
 * the empty cursor it was given - and the next poll would resolve "the end"
 * again, at its own end, silently skipping everything published in between. On
 * a quiet topic that looks exactly like working software.
 */
func (c *Conn) openTail(
	ctx context.Context, url string, cursor model.TailCursor,
) (pulsarclient.Reader, pulsarclient.MessageID, error) {
	var resumed pulsarclient.MessageID

	if len(cursor.Positions) > 0 {
		id, err := resumeFrom(cursor.Positions[0])
		if err != nil {
			return nil, nil, err
		}
		resumed = id
	} else {
		resumed = c.lastMessageID(ctx, url)
	}

	start := resumed
	if start == nil {
		// A topic nothing has been published to has no last message, so there
		// is no id to resolve. Earliest is correct here and not a fallback to
		// the end: an empty topic has nothing to skip, and the first message
		// that arrives is the one the tail should show.
		start = pulsarclient.EarliestMessageID()
	}

	reader, err := c.client.CreateReader(pulsarclient.ReaderOptions{
		Topic:          url,
		StartMessageID: start,
		// The message the cursor names has already been shown. Including it
		// would make every poll repeat the last line of the previous one.
		StartMessageIDInclusive: false,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("open a tail on %s: %w", url, err)
	}
	return reader, resumed, nil
}

/*
 * lastMessageID is the concrete id of the newest message on a topic, or nil.
 *
 * Asked of the admin API rather than the client, because the client can only
 * express "the end" as a sentinel a Reader resolves privately - which is
 * exactly the value a cursor cannot carry.
 *
 * Nil on any failure, including an empty topic: the caller starts at the
 * earliest message, which for a topic with nothing on it is the same place.
 */
func (c *Conn) lastMessageID(ctx context.Context, url string) pulsarclient.MessageID {
	name, err := utils.GetTopicName(url)
	if err != nil {
		return nil
	}
	id, err := c.admin.Topics().GetLastMessageIDWithContext(ctx, *name)
	if err != nil {
		return nil
	}
	if id.LedgerID < 0 || id.EntryID < 0 {
		return nil
	}
	return pulsarclient.NewMessageID(
		id.LedgerID, id.EntryID, int32(id.BatchIndex), int32(id.PartitionIndex))
}

/*
 * tailTopicURL is the address a tail opens, from the ref the board passed.
 *
 * A ref carries a namespace and a name and nothing about storage, and a tail
 * polls every couple of seconds - so asking the cluster which scheme this
 * topic uses would be a request per poll for something that cannot change.
 * The board sends the full URL it already listed instead, and a bare name
 * falls back to persistent, which is what a topic is unless it says otherwise.
 */
func tailTopicURL(ref model.DestinationRef) (string, error) {
	if strings.Contains(ref.Name, "://") {
		return ref.Name, nil
	}
	if strings.TrimSpace(ref.Name) == "" {
		return "", fmt.Errorf("a tail needs a topic")
	}
	return topicURL(ref, true), nil
}
