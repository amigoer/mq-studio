package redisstream

import (
	"context"
	"fmt"
	"strings"

	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * Trim discards entries from the head of a stream.
 *
 * XTRIM is the only thing Redis has here, and it is also the only way to empty
 * a stream without deleting it: MAXLEN 0 removes everything and leaves the key,
 * its groups and their positions in place. That is why this driver declares no
 * separate purge - it would be a second name for one command, and the two
 * would drift the day one of them grew an option.
 *
 * The approximate form is not a rounding error to hide. Redis stops at a macro
 * node boundary rather than splitting one, so the stream keeps at least what
 * was asked and possibly a little more; it is much cheaper on a large stream,
 * and the page says which form it used.
 */
func (c *Conn) Trim(ctx context.Context, request model.TrimRequest) (*model.TrimResult, error) {
	name := strings.TrimSpace(request.Ref.Name)
	if name == "" {
		return nil, fmt.Errorf("a trim needs a stream key")
	}

	var (
		removed int64
		err     error
	)
	switch request.Strategy {
	case model.TrimMaxLen:
		if request.MaxLen < 0 {
			return nil, fmt.Errorf("a length to keep cannot be negative")
		}
		if request.Approx {
			removed, err = c.client.XTrimMaxLenApprox(ctx, name, request.MaxLen, 0).Result()
		} else {
			removed, err = c.client.XTrimMaxLen(ctx, name, request.MaxLen).Result()
		}
	case model.TrimMinID:
		id := strings.TrimSpace(request.MinID)
		if id == "" {
			return nil, fmt.Errorf("a trim by position needs the lowest entry id to keep")
		}
		if request.Approx {
			removed, err = c.client.XTrimMinIDApprox(ctx, name, id, 0).Result()
		} else {
			removed, err = c.client.XTrimMinID(ctx, name, id).Result()
		}
	default:
		return nil, fmt.Errorf("unknown trim strategy %q", request.Strategy)
	}
	if err != nil {
		return nil, fmt.Errorf("trim stream %q: %w", name, err)
	}
	return &model.TrimResult{Removed: removed}, nil
}

// DeleteEntries removes entries by id.
//
// XDEL does not renumber anything: the ids that remain keep the values they
// had, and the gap stays visible. What it does move is max-deleted-entry-id,
// which is the only record that a gap was deliberate rather than a read that
// missed something - so the detail panel shows it.
//
// It reports how many of the named ids were actually there, which is not the
// same as how many were asked for: deleting an id twice succeeds and removes
// nothing, and a page that reported the request count would call that a
// deletion.
func (c *Conn) DeleteEntries(ctx context.Context, ref model.DestinationRef, ids []string) (*model.TrimResult, error) {
	name := strings.TrimSpace(ref.Name)
	if name == "" {
		return nil, fmt.Errorf("deleting entries needs a stream key")
	}
	wanted := make([]string, 0, len(ids))
	for _, id := range ids {
		if trimmed := strings.TrimSpace(id); trimmed != "" {
			wanted = append(wanted, trimmed)
		}
	}
	if len(wanted) == 0 {
		return nil, fmt.Errorf("no entry ids to delete")
	}

	removed, err := c.client.XDel(ctx, name, wanted...).Result()
	if err != nil {
		return nil, fmt.Errorf("delete entries from %q: %w", name, err)
	}
	return &model.TrimResult{Removed: removed}, nil
}
