package pulsar

import (
	"context"
	"fmt"

	"github.com/apache/pulsar-client-go/pulsaradmin/pkg/utils"

	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * ResetOffset moves a subscription's cursor.
 *
 * model.ResetOffsetRequest carries a group, a topic, a timestamp and a force
 * flag, and all four map onto Pulsar without stretching:
 *
 *   - Group is the subscription name and Topic is its full URL, which is how
 *     the subscription refs on this family are already addressed.
 *   - A timestamp is Pulsar's own ResetCursorToTimestamp: the broker finds the
 *     position itself, which is exactly what "move this subscription to a
 *     moment in time" means.
 *   - A zero timestamp is the earliest message the topic still holds. There is
 *     no "reset to nothing" on any family, so zero has to mean something, and
 *     replaying from the start is the only reading that is useful.
 *   - Force skips the backlog instead of replaying it. Pulsar has a call for
 *     exactly that - ClearBacklog - and it is genuinely a different operation
 *     rather than a stronger version of the same one, which is why it is
 *     behind the flag rather than a separate capability.
 */
func (c *Conn) ResetOffset(ctx context.Context, request model.ResetOffsetRequest) error {
	if request.Group == "" {
		return fmt.Errorf("a cursor reset needs a subscription")
	}
	topic, err := utils.GetTopicName(request.Topic)
	if err != nil {
		return fmt.Errorf("read the topic %q: %w", request.Topic, err)
	}
	subscriptions := c.admin.Subscriptions()

	if request.Force {
		if err := subscriptions.ClearBacklogWithContext(ctx, *topic, request.Group); err != nil {
			return fmt.Errorf("clear the backlog of %q on %s: %w",
				request.Group, request.Topic, err)
		}
		return nil
	}

	timestamp := request.Timestamp
	if timestamp <= 0 {
		// Earliest, expressed as a moment before any message could have been
		// published. Pulsar has no "reset to earliest" on this endpoint, and
		// asking for epoch zero is how its own tooling says the same thing.
		timestamp = 1
	}
	if err := subscriptions.ResetCursorToTimestampWithContext(
		ctx, *topic, request.Group, timestamp); err != nil {
		return fmt.Errorf("reset the cursor of %q on %s: %w",
			request.Group, request.Topic, err)
	}
	return nil
}
