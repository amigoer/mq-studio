package pulsar

import (
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"

	pulsarclient "github.com/apache/pulsar-client-go/pulsar"

	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * How a Pulsar message id is carried.
 *
 * A Pulsar id is four numbers - ledger, entry, partition and batch index - and
 * model.MessageItem was shaped for RocketMQ: one opaque string plus an int
 * queue id and an int64 offset. So the split is chosen rather than derived:
 *
 *   - MessageID is "ledger:entry:partition", which is exactly what Pulsar's
 *     own String() prints and what an operator pastes into pulsar-admin.
 *   - QueueID is the partition, which is the one field that means the same
 *     thing on both families.
 *   - QueueOffset is the entry id. It is not an offset a client can seek to on
 *     its own - the ledger is the other half - so it is for display and
 *     ordering only, and nothing reconstructs an id from it.
 *
 * The batch index does not fit any of the three, and dropping it would make
 * two messages in one batch indistinguishable. It rides in the item's
 * properties, and the tail cursor carries the whole serialized id rather than
 * these fields, so nothing has to round-trip through this lossy shape.
 */

// messageIDString is the form Pulsar's own tooling prints.
func messageIDString(id pulsarclient.MessageID) string {
	return fmt.Sprintf("%d:%d:%d", id.LedgerID(), id.EntryID(), id.PartitionIdx())
}

// parseMessageID reads back what messageIDString wrote, or what a user pasted.
//
// The partition is optional because pulsar-admin prints a two-part id for a
// non-partitioned topic, and an operator pasting one should not have to know
// to add ":-1".
func parseMessageID(raw string) (ledger, entry int64, partition int, err error) {
	parts := strings.Split(strings.TrimSpace(raw), ":")
	if len(parts) < 2 || len(parts) > 3 {
		return 0, 0, 0, fmt.Errorf(
			"%q is not a pulsar message id; expected ledger:entry or ledger:entry:partition", raw)
	}
	ledger, err = strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("%q has no ledger id: %w", raw, err)
	}
	entry, err = strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return 0, 0, 0, fmt.Errorf("%q has no entry id: %w", raw, err)
	}
	// -1 is what pulsar-client-go itself uses for "no partition", so a
	// two-part id means a non-partitioned topic rather than partition zero.
	partition = -1
	if len(parts) == 3 {
		value, err := strconv.Atoi(parts[2])
		if err != nil {
			return 0, 0, 0, fmt.Errorf("%q has no partition: %w", raw, err)
		}
		partition = value
	}
	return ledger, entry, partition, nil
}

/*
 * How a tail position is carried.
 *
 * QueuePosition is a node, an int queue id and an int64 offset, and none of
 * the three can hold a Pulsar id: ledger, entry and batch index are three
 * numbers, and a tail that resumed from the entry alone would start reading in
 * the wrong ledger.
 *
 * So the serialized id goes in Node - it is a string, and a tail cursor is
 * opaque to everything between the driver and itself - while QueueID and
 * Offset carry the partition and the entry for display. Nothing reads them
 * back.
 */
func positionOf(partition int32, id pulsarclient.MessageID) model.QueuePosition {
	return model.QueuePosition{
		Node:    base64.StdEncoding.EncodeToString(id.Serialize()),
		QueueID: int(partition),
		Offset:  id.EntryID(),
	}
}

// resumeFrom reads a position back into the id a reader can seek to.
func resumeFrom(position model.QueuePosition) (pulsarclient.MessageID, error) {
	if position.Node == "" {
		return nil, fmt.Errorf("tail position for partition %d carries no message id",
			position.QueueID)
	}
	raw, err := base64.StdEncoding.DecodeString(position.Node)
	if err != nil {
		return nil, fmt.Errorf("tail position for partition %d is unreadable: %w",
			position.QueueID, err)
	}
	id, err := pulsarclient.DeserializeMessageID(raw)
	if err != nil {
		return nil, fmt.Errorf("tail position for partition %d is not a message id: %w",
			position.QueueID, err)
	}
	return id, nil
}
