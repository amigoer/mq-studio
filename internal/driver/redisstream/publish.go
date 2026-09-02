package redisstream

import (
	"context"
	"fmt"
	"strings"

	"github.com/redis/go-redis/v9"

	"github.com/amigoer/mq-studio/internal/model"
)

// maxAddCount bounds one send. The console is for trying a consumer out, not
// for load testing, and an unbounded count is a way to fill a server's memory
// from a text box.
const maxAddCount = 1000

/*
 * AddEntry writes entries to a stream.
 *
 * NOMKSTREAM, deliberately. XADD creates the stream when it is missing, which
 * for a send console is the wrong default: a mistyped key would silently make
 * a new stream holding one test message, and the operator would be looking at
 * a list wondering where their entry went. Creating a stream is its own
 * gesture on its own page.
 *
 * The id is almost always left to the server. An explicit one has to be higher
 * than the last, which is what keeps a stream ordered - so the failure a user
 * hits here is Redis refusing an id that is too small, and that error is worth
 * passing through rather than dressing up.
 */
func (c *Conn) AddEntry(ctx context.Context, request model.StreamAddRequest) (*model.StreamAddResult, error) {
	stream := strings.TrimSpace(request.Ref.Name)
	if stream == "" {
		return nil, fmt.Errorf("a send needs a stream key")
	}

	values := make([]any, 0, len(request.Fields)*2)
	for _, field := range request.Fields {
		name := strings.TrimSpace(field.Name)
		if name == "" {
			continue
		}
		values = append(values, name, field.Value)
	}
	if len(values) == 0 {
		// Redis refuses an entry with no fields, and saying so here names the
		// form's problem rather than passing back a wrong-number-of-arguments
		// error from the server.
		return nil, fmt.Errorf("an entry needs at least one field")
	}

	count := request.Count
	if count <= 0 {
		count = 1
	}
	if count > maxAddCount {
		return nil, fmt.Errorf("a send is capped at %d copies, asked for %d", maxAddCount, count)
	}

	id := strings.TrimSpace(request.ID)
	if id == "" {
		id = "*"
	} else if !entryID.MatchString(id) {
		return nil, fmt.Errorf("%q is not an entry id: it is <milliseconds> or <milliseconds>-<sequence>", id)
	} else if count > 1 {
		// Every entry needs its own id and an explicit one can only be used
		// once, so this would fail on the second copy having already written
		// the first. Refusing up front leaves the stream as it was.
		return nil, fmt.Errorf("an explicit entry id can only be used once; send one copy or let the server assign ids")
	}

	ids := make([]string, 0, count)
	for range count {
		assigned, err := c.client.XAdd(ctx, &redis.XAddArgs{
			Stream:     stream,
			NoMkStream: true,
			ID:         id,
			Values:     values,
		}).Result()
		if err != nil {
			// The ids already written are reported alongside the failure: a
			// send of a hundred that stopped at forty has put forty entries in
			// the stream, and a caller told only "it failed" would not know to
			// go and look.
			return &model.StreamAddResult{IDs: ids}, fmt.Errorf("write to %q: %w", stream, err)
		}
		ids = append(ids, assigned)
	}
	return &model.StreamAddResult{IDs: ids}, nil
}
