package redisstream

import (
	"context"
	"strings"
	"testing"

	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * The position is checked before the command goes out, so the error lands next
 * to the field that produced it rather than coming back as a server refusal.
 *
 * Only the refusals are covered here. The in-process server has no XGROUP
 * SETID at all, so what a position Redis accepts actually does is asserted
 * against a real broker in live_test.go - including that repositioning leaves
 * the pending list alone, which is the part that would be expensive to get
 * wrong.
 */
func TestSetSubscriptionPositionRefusesWhatIsNotAPosition(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()
	ref := model.SubscriptionRef{Namespace: "orders:events", Name: "settle-group"}

	for _, position := range []string{"", "   ", "yesterday", "-1", "1756454646018-", "+", "-", "1-2-3"} {
		err := conn.SetSubscriptionPosition(ctx, model.PositionRequest{Ref: ref, Position: position})
		if err == nil {
			t.Errorf("position %q was accepted", position)
			continue
		}
		// A blank field is its own message: there is nothing to explain the
		// syntax of yet. Anything else has to name the alternatives, because
		// "invalid" leaves the user guessing at a syntax they have no reason
		// to know.
		if strings.TrimSpace(position) != "" && !strings.Contains(err.Error(), "entry id") {
			t.Errorf("position %q was refused without saying what one looks like: %v", position, err)
		}
	}
}

// The three shapes Redis accepts pass the check. They cannot be run against
// the in-process server, so this asserts only that the driver does not refuse
// them itself - the round trip is live.
func TestSetSubscriptionPositionAcceptsEveryShapeRedisDoes(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()
	ref := model.SubscriptionRef{Namespace: "orders:events", Name: "settle-group"}

	for _, position := range []string{PositionBeginning, PositionEnd, "1756454646018", "1756454646018-0"} {
		err := conn.SetSubscriptionPosition(ctx, model.PositionRequest{Ref: ref, Position: position})
		if err == nil {
			continue
		}
		// The in-process server answers "not supported" for XGROUP SETID. Any
		// other failure is the driver refusing a position it should not.
		if !strings.Contains(err.Error(), "not supported") {
			t.Errorf("position %q was refused by the driver: %v", position, err)
		}
	}
}

func TestSetSubscriptionPositionNeedsBothHalvesOfTheReference(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()
	for name, ref := range map[string]model.SubscriptionRef{
		"no stream": {Name: "settle-group"},
		"no group":  {Namespace: "orders:events"},
	} {
		err := conn.SetSubscriptionPosition(ctx, model.PositionRequest{Ref: ref, Position: "0"})
		if err == nil {
			t.Errorf("repositioning with %s succeeded", name)
		}
	}
}
