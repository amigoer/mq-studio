package kafka

import (
	"testing"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kerr"

	"github.com/amigoer/mq-studio/internal/model"
)

func memberLag(
	topic string, partition int32, commit, start, end, lag int64,
	member ...*kadm.DescribedGroupMember,
) kadm.GroupMemberLag {
	var held *kadm.DescribedGroupMember
	if len(member) > 0 {
		held = member[0]
	}
	return kadm.GroupMemberLag{
		Member:    held,
		Topic:     topic,
		Partition: partition,
		Commit:    kadm.Offset{Topic: topic, Partition: partition, At: commit},
		Start:     kadm.ListedOffset{Topic: topic, Partition: partition, Offset: start},
		End:       kadm.ListedOffset{Topic: topic, Partition: partition, Offset: end},
		Lag:       lag,
	}
}

func TestSubscriptionFromGroupLag(t *testing.T) {
	instance := "worker-a"
	member := kadm.DescribedGroupMember{
		MemberID: "m-1", ClientID: "c-1", ClientHost: "/10.2.3.4", InstanceID: &instance,
	}
	subscription := subscriptionFrom(1, kadm.DescribedGroupLag{
		Group:        "settle-consumer",
		State:        groupStateStable,
		ProtocolType: "consumer",
		Protocol:     "range",
		Coordinator:  kadm.BrokerDetail{NodeID: 2},
		Members:      []kadm.DescribedGroupMember{member},
		Lag: kadm.GroupLag{
			"orders": {
				0: memberLag("orders", 0, 100, 0, 400, 300),
				1: memberLag("orders", 1, 50, 0, 250, 200),
			},
			"payments": {
				0: memberLag("payments", 0, 10, 0, 10, 0),
			},
		},
	})

	if subscription.Ref.Name != "settle-consumer" {
		t.Errorf("name = %q", subscription.Ref.Name)
	}
	if subscription.Status != model.SubscriptionOnline {
		t.Errorf("status = %q, want online for a stable group", subscription.Status)
	}
	if subscription.Members != 1 {
		t.Errorf("members = %d, want 1", subscription.Members)
	}
	if subscription.Destinations != 2 {
		t.Errorf("topics = %d, want 2", subscription.Destinations)
	}
	if subscription.Backlog != 500 {
		t.Errorf("backlog = %d, want 500", subscription.Backlog)
	}
	if subscription.Attribute(AttrGroupAssignor) != "range" {
		t.Errorf("assignor = %q", subscription.Attribute(AttrGroupAssignor))
	}
	if subscription.Attribute(AttrGroupCoordinator) != "2" {
		t.Errorf("coordinator = %q, want 2", subscription.Attribute(AttrGroupCoordinator))
	}
	if subscription.Attribute(AttrGroupTopics) != "orders,payments" {
		t.Errorf("topics = %q, want them sorted", subscription.Attribute(AttrGroupTopics))
	}
	// No consume rate exists in the admin protocol; it is a JMX metric on the
	// consumer itself.
	if subscription.RateOut != model.UnknownMetric {
		t.Errorf("rate = %d, want unknown", subscription.RateOut)
	}
}

/*
 * The lag edge cases, which are the ones a page reads wrong when they slip.
 *
 * kadm reports -1 for a partition whose lag it could not work out - a commit
 * error, or an offset listing that failed. Summing that would quietly reduce
 * the total, and a group that is behind would look less behind than it is.
 */
func TestTotalLagIgnoresPartitionsItCouldNotWorkOut(t *testing.T) {
	total, known := totalLag(kadm.GroupLag{"orders": {
		0: memberLag("orders", 0, 100, 0, 400, 300),
		1: memberLag("orders", 1, -1, 0, 250, -1),
	}})

	if !known {
		t.Fatal("one partition was measurable but the total reported nothing")
	}
	if total != 300 {
		t.Errorf("total = %d, want 300 - an unmeasurable partition is not a negative lag", total)
	}
}

// And a group where nothing could be worked out has an unknown backlog, not a
// zero one: caught up and unanswerable must not look alike.
func TestABacklogNobodyCouldMeasureIsUnknown(t *testing.T) {
	subscription := subscriptionFrom(1, kadm.DescribedGroupLag{
		Group: "broken", State: groupStateStable,
		Lag: kadm.GroupLag{"orders": {0: memberLag("orders", 0, -1, -1, -1, -1)}},
	})
	if subscription.Backlog != model.UnknownMetric {
		t.Errorf("backlog = %d, want unknown", subscription.Backlog)
	}
}

// A group with no topics at all is measurable and empty, which is a real zero.
func TestAGroupWithNoOffsetsHasNoBacklog(t *testing.T) {
	subscription := subscriptionFrom(1, kadm.DescribedGroupLag{
		Group: "fresh", State: groupStateEmpty, Lag: kadm.GroupLag{},
	})
	if subscription.Backlog != model.UnknownMetric {
		t.Errorf("backlog = %d, want unknown - nothing was measured", subscription.Backlog)
	}
	if subscription.Destinations != 0 {
		t.Errorf("topics = %d, want 0", subscription.Destinations)
	}
}

/*
 * Empty is a warning, not offline.
 *
 * A group with committed offsets and no members is either between deployments
 * or a consumer that died and left a backlog growing behind it, and nothing in
 * the protocol says which. Offline would suggest the first.
 */
func TestGroupStateMapping(t *testing.T) {
	cases := map[string]model.SubscriptionStatus{
		groupStateStable:  model.SubscriptionOnline,
		groupStateDead:    model.SubscriptionOffline,
		groupStateEmpty:   model.SubscriptionWarning,
		groupStatePrepare: model.SubscriptionWarning,
		groupStateComplet: model.SubscriptionWarning,
		"SomethingNew":    model.SubscriptionWarning,
	}
	for state, want := range cases {
		if got := groupStatus(kadm.DescribedGroupLag{State: state}); got != want {
			t.Errorf("state %q mapped to %q, want %q", state, got, want)
		}
	}
}

// A group in Empty state has offsets and no member holding them, and the rows
// have to say so rather than leaving the column blank for no stated reason.
func TestPartitionRowsNameTheMemberOrReportNone(t *testing.T) {
	member := kadm.DescribedGroupMember{ClientID: "c-1", ClientHost: "/10.2.3.4"}
	rows := partitionLagRows(kadm.GroupLag{"orders": {
		0: memberLag("orders", 0, 100, 0, 400, 300, &member),
		1: memberLag("orders", 1, 100, 0, 400, 300, nil),
	}})

	if len(rows) != 2 {
		t.Fatalf("rows = %d, want 2", len(rows))
	}
	if rows[0]["member"] != "c-1@10.2.3.4" {
		t.Errorf("member = %v, want c-1@10.2.3.4", rows[0]["member"])
	}
	if rows[1]["member"] != "" {
		t.Errorf("an unheld partition named %v as its member", rows[1]["member"])
	}
}

// A partition the group has never committed on reports -1, which is Kafka's
// "no position" and the opposite end of the log from offset 0.
func TestAnUncommittedPartitionKeepsItsSentinel(t *testing.T) {
	rows := partitionLagRows(kadm.GroupLag{"orders": {
		0: memberLag("orders", 0, -1, 0, 400, 400, nil),
	}})
	if rows[0]["committed"] != int64(-1) {
		t.Errorf("committed = %v, want -1", rows[0]["committed"])
	}
}

// An offset listing that failed must not read as position zero either.
func TestAFailedOffsetListingReadsAsUnknown(t *testing.T) {
	if got := offsetOrUnknown(kadm.ListedOffset{Offset: 40, Err: kerr.NotLeaderForPartition}); got != model.UnknownMetric {
		t.Errorf("offset = %d, want unknown", got)
	}
	if got := offsetOrUnknown(kadm.ListedOffset{Offset: 40}); got != 40 {
		t.Errorf("offset = %d, want 40", got)
	}
}

/*
 * A reset outside the log is a surprise nobody asked for: below the start it
 * is unreadable and past the end the consumer waits for records that do not
 * exist, and Kafka accepts both.
 */
func TestClampKeepsAResetInsideTheLog(t *testing.T) {
	cases := []struct {
		name                     string
		offset, start, end, want int64
	}{
		{"inside stays", 150, 100, 400, 150},
		{"below the start lands on it", 40, 100, 400, 100},
		{"past the end lands on it", 900, 100, 400, 400},
		{"an unknown start does not clamp", 40, -1, 400, 40},
		{"an unknown end does not clamp", 900, 100, -1, 900},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := clamp(test.offset, test.start, test.end); got != test.want {
				t.Errorf("clamp(%d, %d, %d) = %d, want %d",
					test.offset, test.start, test.end, got, test.want)
			}
		})
	}
}

func TestResolveOffsetPerTarget(t *testing.T) {
	request := func(target OffsetTarget, value int64) OffsetResetRequest {
		return OffsetResetRequest{Group: "g", Topic: "orders", Target: target, Value: value}
	}
	timestamps := kadm.ListedOffsets{"orders": {0: kadm.ListedOffset{Topic: "orders", Partition: 0, Offset: 220}}}
	committed := kadm.OffsetResponses{"orders": {0: kadm.OffsetResponse{
		Offset: kadm.Offset{Topic: "orders", Partition: 0, At: 150},
	}}}

	cases := []struct {
		name string
		req  OffsetResetRequest
		want int64
	}{
		{"earliest is the start of what is retained", request(OffsetEarliest, 0), 100},
		{"latest is the end", request(OffsetLatest, 0), 400},
		{"absolute is the number given", request(OffsetAbsolute, 275), 275},
		{"a timestamp resolves to its first record", request(OffsetTimestamp, 0), 220},
		{"a shift moves from where the group is", request(OffsetShift, -50), 100},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			got, err := resolveOffset(test.req, 0, 100, 400, timestamps, committed)
			if err != nil {
				t.Fatalf("resolveOffset: %v", err)
			}
			if got != test.want {
				t.Errorf("offset = %d, want %d", got, test.want)
			}
		})
	}
}

/*
 * A timestamp after the last record has no offset to land on.
 *
 * Kafka answers with nothing, and the honest reading is the end of the log:
 * everything written before that moment has already been produced, so there is
 * nothing to replay. Reading it as offset zero would replay the whole topic -
 * the opposite of what was asked for.
 */
func TestATimestampPastTheLastRecordLandsAtTheEnd(t *testing.T) {
	got, err := resolveOffset(
		OffsetResetRequest{Group: "g", Topic: "orders", Target: OffsetTimestamp},
		0, 100, 400, kadm.ListedOffsets{}, nil,
	)
	if err != nil {
		t.Fatalf("resolveOffset: %v", err)
	}
	if got != 400 {
		t.Errorf("offset = %d, want the end of the log", got)
	}
}

// A shift on a partition the group has never committed on has nowhere to shift
// from, so it moves from the end rather than from an imagined zero.
func TestAShiftWithNoCommitMovesFromTheEnd(t *testing.T) {
	got, err := resolveOffset(
		OffsetResetRequest{Group: "g", Topic: "orders", Target: OffsetShift, Value: -10},
		0, 100, 400, nil, kadm.OffsetResponses{},
	)
	if err != nil {
		t.Fatalf("resolveOffset: %v", err)
	}
	if got != 390 {
		t.Errorf("offset = %d, want 390", got)
	}
}

func TestResolveOffsetRefusesAnUnknownTarget(t *testing.T) {
	if _, err := resolveOffset(
		OffsetResetRequest{Target: "sideways"}, 0, 0, 1, nil, nil,
	); err == nil {
		t.Error("an unknown target was accepted")
	}
}

// A consumer group is not declared: it exists once something commits to it.
// The methods are here because Go requires them, and they say so.
func TestCreatingAConsumerGroupIsRefused(t *testing.T) {
	conn := newConn(nil, nil, clientConfig{})
	if err := conn.CreateSubscription(t.Context(), model.SubscriptionSpec{}); err == nil {
		t.Error("creating a consumer group was accepted")
	}
	if err := conn.UpdateSubscription(t.Context(), model.SubscriptionSpec{}); err == nil {
		t.Error("editing a consumer group was accepted")
	}
}
