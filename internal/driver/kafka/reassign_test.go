package kafka

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * A plan naming a broker that is not there is refused before it is sent.
 *
 * Kafka accepts one: the partition is assigned to a broker that does not
 * exist, the copy never starts, and the reassignment sits in flight until
 * somebody cancels it. Saying so before the request is the difference between
 * a form error and an afternoon.
 */
func TestReassignRefusesABrokerThatIsNotThere(t *testing.T) {
	conn := fakeConn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	const name = "mqs-test-reassign-guard"
	if err := conn.CreateDestination(ctx, model.DestinationSpec{
		Ref: model.DestinationRef{Name: name}, Partitions: 1,
		Attributes: map[string]string{AttrReplicationFactor: "1"},
	}); err != nil {
		t.Fatalf("CreateDestination: %v", err)
	}

	err := conn.Reassign(ctx, name, 0, []int32{99})
	if err == nil {
		t.Fatal("a plan naming a broker that does not exist was accepted")
	}
	// The message has to name the broker, or the operator has to guess which
	// of the ids they typed was wrong.
	if !strings.Contains(err.Error(), "99") {
		t.Errorf("error = %v, want it to name broker 99", err)
	}
}

// Two copies on one broker is not two replicas, and Kafka's own error for it
// says nothing about which broker was repeated.
func TestReassignRefusesADuplicateBroker(t *testing.T) {
	conn := fakeConn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	brokers, err := conn.admin.ListBrokers(ctx)
	if err != nil {
		t.Fatalf("ListBrokers: %v", err)
	}
	id := brokers[0].NodeID

	if err := conn.Reassign(ctx, "any", 0, []int32{id, id}); err == nil {
		t.Error("a plan naming one broker twice was accepted")
	}
}

func TestReassignRefusesAnEmptyPlan(t *testing.T) {
	conn := newConn(nil, nil, clientConfig{})
	if err := conn.Reassign(t.Context(), "orders", 0, nil); err == nil {
		t.Error("a plan with no replicas was accepted")
	}
	if err := conn.Reassign(t.Context(), "", 0, []int32{1}); err == nil {
		t.Error("a plan with no topic was accepted")
	}
}

/*
 * A partition with neither half in flight is not being moved.
 *
 * Kafka lists such partitions on some paths, and showing them would make a
 * finished plan look like one still running - which is the only signal there
 * is, because a reassignment has no completion event.
 */
func TestOnlyPartitionsActuallyMovingAreListed(t *testing.T) {
	conn := fakeConn(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	moving, err := conn.ListReassignments(ctx)
	if err != nil {
		t.Fatalf("ListReassignments: %v", err)
	}
	// An idle cluster reports nothing, which is how an operator knows the last
	// plan finished.
	if len(moving) != 0 {
		t.Errorf("an idle cluster reports %d partitions moving", len(moving))
	}
}

// The replica lists come back sorted, so a panel does not reshuffle between
// refreshes for no reason the reader can see.
func TestReassignmentReplicasAreSorted(t *testing.T) {
	if got := sortedIDs([]int32{3, 1, 2}); got[0] != 1 || got[1] != 2 || got[2] != 3 {
		t.Errorf("sortedIDs = %v, want them ordered", got)
	}
	// And the input is not modified: it belongs to the caller.
	source := []int32{3, 1}
	_ = sortedIDs(source)
	if source[0] != 3 {
		t.Error("sortedIDs sorted its caller's slice")
	}
}
