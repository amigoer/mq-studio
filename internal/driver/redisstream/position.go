package redisstream

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/amigoer/mq-studio/internal/model"
)

// PositionBeginning and PositionEnd are the two places Redis spells specially.
//
// "0" is the beginning of what the stream still holds, which is not the
// beginning of what it ever held: entries trimmed away do not come back, and a
// group moved here replays only what survives. "$" is whatever arrives next.
const (
	PositionBeginning = "0"
	PositionEnd       = "$"
)

// entryID is <milliseconds> or <milliseconds>-<sequence>, which is what Redis
// accepts. Checking it here rather than letting the server refuse keeps the
// error next to the field that produced it.
var entryID = regexp.MustCompile(`^\d+(-\d+)?$`)

/*
 * SetSubscriptionPosition moves a group to a named place in the log.
 *
 * XGROUP SETID rewrites last-delivered-id, and that is the whole of what it
 * does. What it does not do is worth stating, because both surprises cost
 * someone a debugging session:
 *
 *   - The pending list is untouched. Entries already handed out and not
 *     acknowledged stay owed to the consumers holding them, wherever the group
 *     is now reading from. Moving a group forward does not clear its backlog
 *     of unacknowledged work; only acknowledging or claiming does.
 *   - Nothing is redelivered on its own. Consumers reading with ">" see
 *     entries after the new position when they next ask; nothing is pushed.
 *
 * The page says both, because a reposition that looked like a reset would send
 * an operator looking for messages that were never going to arrive.
 */
func (c *Conn) SetSubscriptionPosition(ctx context.Context, request model.PositionRequest) error {
	stream, group, err := groupRef(request.Ref)
	if err != nil {
		return err
	}
	position := strings.TrimSpace(request.Position)
	switch {
	case position == "":
		return fmt.Errorf("a reposition needs somewhere to move to")
	case position == PositionBeginning, position == PositionEnd:
	case entryID.MatchString(position):
	default:
		return fmt.Errorf(
			"%q is not a position: use an entry id, %q for the beginning, or %q for the end",
			position, PositionBeginning, PositionEnd)
	}

	if err := c.client.XGroupSetID(ctx, stream, group, position).Err(); err != nil {
		return fmt.Errorf("move consumer group %q on %q to %s: %w", group, stream, position, err)
	}
	return nil
}
