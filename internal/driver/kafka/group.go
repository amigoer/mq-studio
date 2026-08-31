package kafka

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/twmb/franz-go/pkg/kadm"

	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * Attribute keys the consumer group board reads.
 *
 * A private contract with frontend/src/mq/kafka/subscriptions.ts.
 */
const (
	AttrGroupState       = "state"
	AttrGroupProtocol    = "protocol"
	AttrGroupAssignor    = "assignor"
	AttrGroupCoordinator = "coordinator"
	AttrGroupTopics      = "topics"
	AttrGroupHasMembers  = "hasMembers"
)

// Kafka's own group states. Only two of them mean the group is doing anything.
const (
	groupStateStable  = "Stable"
	groupStateEmpty   = "Empty"
	groupStateDead    = "Dead"
	groupStatePrepare = "PreparingRebalance"
	groupStateComplet = "CompletingRebalance"
)

/*
 * ListSubscriptions reports the consumer groups the cluster knows about.
 *
 * Describe first, then lag, rather than one Lag call for both. Lag is the
 * better answer when it works - it assembles the state, the members and the
 * per-partition arithmetic from one consistent view - but it fails outright on
 * a group that has committed nothing, which a console consumer leaves behind
 * and an expired group becomes. One such group used to take the whole page
 * down with it.
 *
 * So the describe is what the listing is built from, and the lag is merged in
 * where it exists. A group whose lag could not be worked out is listed with an
 * unknown backlog, which is the truth about it.
 */
func (c *Conn) ListSubscriptions(ctx context.Context) ([]*model.Subscription, error) {
	listed, err := c.admin.ListGroups(ctx)
	if err != nil {
		return nil, err
	}
	names := listed.Groups()
	if len(names) == 0 {
		return []*model.Subscription{}, nil
	}
	sort.Strings(names)

	described, err := c.admin.DescribeGroups(ctx, names...)
	if err != nil {
		return nil, err
	}
	lags := c.lagsFor(ctx, names)

	subscriptions := make([]*model.Subscription, 0, len(names))
	for index, name := range names {
		group, ok := described[name]
		if !ok || group.Err != nil {
			continue
		}
		subscriptions = append(subscriptions, subscriptionFrom(index+1, mergeLag(group, lags)))
	}
	return subscriptions, nil
}

// lagsFor is best effort: a cluster that will not compute lag still has groups
// worth listing.
func (c *Conn) lagsFor(ctx context.Context, names []string) kadm.DescribedGroupLags {
	lags, err := c.admin.Lag(ctx, names...)
	if err != nil {
		return nil
	}
	return lags
}

// mergeLag puts a described group and its lag back together, and stands on its
// own when the lag is missing.
func mergeLag(group kadm.DescribedGroup, lags kadm.DescribedGroupLags) kadm.DescribedGroupLag {
	if lag, ok := lags[group.Group]; ok && lag.DescribeErr == nil {
		return lag
	}
	return kadm.DescribedGroupLag{
		Group:        group.Group,
		Coordinator:  group.Coordinator,
		State:        group.State,
		ProtocolType: group.ProtocolType,
		Protocol:     group.Protocol,
		Members:      group.Members,
	}
}

// SubscriptionDetail reports one group.
func (c *Conn) SubscriptionDetail(
	ctx context.Context, ref model.SubscriptionRef,
) (*model.Subscription, error) {
	described, err := c.admin.DescribeGroups(ctx, ref.Name)
	if err != nil {
		return nil, err
	}
	group, ok := described[ref.Name]
	if !ok || group.Err != nil {
		return nil, fmt.Errorf("consumer group not found: %s", ref.Name)
	}
	return subscriptionFrom(1, mergeLag(group, c.lagsFor(ctx, []string{ref.Name}))), nil
}

/*
 * CreateSubscription and UpdateSubscription exist because Go requires every
 * method of an interface, and they refuse because Kafka has no such operation.
 *
 * A consumer group is not declared. It comes into existence when something
 * commits an offset to it and disappears when its offsets are deleted or
 * expire, so there is nothing for an admin to create and nothing to edit.
 * Neither CapSubscriptionCreate nor CapSubscriptionUpdate is declared, so no
 * page offers either - these are the floor under that, not a feature gap.
 */
func (c *Conn) CreateSubscription(context.Context, model.SubscriptionSpec) error {
	return fmt.Errorf("kafka consumer groups are created by committing an offset, not by an administrator")
}

func (c *Conn) UpdateSubscription(context.Context, model.SubscriptionSpec) error {
	return fmt.Errorf("kafka consumer groups carry no settings to edit")
}

// RemoveSubscription deletes a group and the offsets it holds.
//
// Kafka refuses this while the group has members, which is not a failure to
// hide: an operator has to stop the consumers first, and saying so is more
// use than a delete that silently did nothing.
func (c *Conn) RemoveSubscription(ctx context.Context, ref model.SubscriptionRef) error {
	response, err := c.admin.DeleteGroup(ctx, ref.Name)
	if err != nil {
		return err
	}
	return response.Err
}

// SubscriptionStats reports one group's progress, partition by partition.
//
// This is what the detail panel is opened for: a group-level lag says a group
// is behind, and only the per-partition rows say which member is behind on
// which partition, which is the difference between "scale up" and "one
// consumer is stuck".
func (c *Conn) SubscriptionStats(
	ctx context.Context, ref model.SubscriptionRef,
) (map[string]interface{}, error) {
	described, err := c.admin.DescribeGroups(ctx, ref.Name)
	if err != nil {
		return nil, err
	}
	group, ok := described[ref.Name]
	if !ok || group.Err != nil {
		return nil, fmt.Errorf("consumer group not found: %s", ref.Name)
	}

	// A group that has committed nothing has members and no progress, and the
	// panel says so with an empty table rather than an error.
	lag := mergeLag(group, c.lagsFor(ctx, []string{ref.Name}))
	return map[string]interface{}{
		"partitions": partitionLagRows(lag.Lag),
		"members":    memberRows(lag.Members),
	}, nil
}

// partitionLagRows is the group's progress on every partition it holds.
func partitionLagRows(lag kadm.GroupLag) []map[string]interface{} {
	sorted := lag.Sorted()
	rows := make([]map[string]interface{}, 0, len(sorted))
	for _, entry := range sorted {
		rows = append(rows, map[string]interface{}{
			"topic":     entry.Topic,
			"partition": entry.Partition,
			"member":    memberLabel(entry.Member),
			// A group that has never committed on a partition has no offset
			// there. -1 is what Kafka sends for that, and it must not be shown
			// as position zero - the two are opposite ends of the log.
			"committed": entry.Commit.At,
			"start":     offsetOrUnknown(entry.Start),
			"end":       offsetOrUnknown(entry.End),
			"lag":       entry.Lag,
		})
	}
	return rows
}

func memberRows(members []kadm.DescribedGroupMember) []map[string]interface{} {
	rows := make([]map[string]interface{}, 0, len(members))
	for _, member := range members {
		instance := ""
		if member.InstanceID != nil {
			instance = *member.InstanceID
		}
		rows = append(rows, map[string]interface{}{
			"memberId":   member.MemberID,
			"clientId":   member.ClientID,
			"clientHost": member.ClientHost,
			"instanceId": instance,
			"assigned":   assignedLabels(member),
		})
	}
	return rows
}

// assignedLabels is what one member currently holds, as topic:partition pairs.
func assignedLabels(member kadm.DescribedGroupMember) []string {
	assignment, ok := member.Assigned.AsConsumer()
	if !ok {
		return []string{}
	}
	labels := make([]string, 0)
	for _, topic := range assignment.Topics {
		for _, partition := range topic.Partitions {
			labels = append(labels, topic.Topic+":"+strconv.FormatInt(int64(partition), 10))
		}
	}
	sort.Strings(labels)
	return labels
}

// memberLabel names the consumer holding a partition, or reports that nothing
// does. A group in Empty state has committed offsets and no members, which is
// the state an operator most wants to see named rather than shown as blank.
func memberLabel(member *kadm.DescribedGroupMember) string {
	if member == nil {
		return ""
	}
	if member.ClientHost == "" {
		return member.ClientID
	}
	return member.ClientID + "@" + strings.TrimPrefix(member.ClientHost, "/")
}

func offsetOrUnknown(offset kadm.ListedOffset) int64 {
	if offset.Err != nil {
		return model.UnknownMetric
	}
	return offset.Offset
}

func subscriptionFrom(id int, lag kadm.DescribedGroupLag) *model.Subscription {
	topics := topicsOf(lag.Lag)
	total, known := totalLag(lag.Lag)
	backlog := int64(model.UnknownMetric)
	if known {
		backlog = total
	}

	return &model.Subscription{
		ID:           id,
		Ref:          model.SubscriptionRef{Name: lag.Group},
		Status:       groupStatus(lag),
		Members:      len(lag.Members),
		Destinations: len(topics),
		Backlog:      backlog,
		// Kafka's admin protocol reports no consume rate. It is a JMX metric on
		// the consumer, not something the cluster knows.
		RateOut: model.UnknownMetric,
		Attributes: map[string]string{
			AttrGroupState:       lag.State,
			AttrGroupProtocol:    lag.ProtocolType,
			AttrGroupAssignor:    lag.Protocol,
			AttrGroupCoordinator: strconv.FormatInt(int64(lag.Coordinator.NodeID), 10),
			AttrGroupTopics:      strings.Join(topics, ","),
			AttrGroupHasMembers:  strconv.FormatBool(len(lag.Members) > 0),
		},
	}
}

/*
 * groupStatus maps Kafka's five group states onto the three the canonical page
 * draws.
 *
 * Empty is deliberately a warning rather than offline. A group with committed
 * offsets and no members is either between deployments - fine - or a consumer
 * that died and left a backlog growing behind it, and the page cannot tell
 * which. Drawing it as offline would suggest the first; a warning asks the
 * question.
 */
func groupStatus(lag kadm.DescribedGroupLag) model.SubscriptionStatus {
	switch lag.State {
	case groupStateStable:
		return model.SubscriptionOnline
	case groupStateDead:
		return model.SubscriptionOffline
	case groupStatePrepare, groupStateComplet:
		return model.SubscriptionWarning
	case groupStateEmpty:
		return model.SubscriptionWarning
	default:
		return model.SubscriptionWarning
	}
}

func topicsOf(lag kadm.GroupLag) []string {
	seen := make(map[string]bool, len(lag))
	topics := make([]string, 0, len(lag))
	for topic := range lag {
		if seen[topic] {
			continue
		}
		seen[topic] = true
		topics = append(topics, topic)
	}
	sort.Strings(topics)
	return topics
}

/*
 * totalLag sums what the group still has to read.
 *
 * A partition whose lag Kafka could not work out contributes nothing and is
 * not counted as zero: kadm reports -1 for a commit error or a failed offset
 * listing, and adding that would quietly reduce the total. If no partition
 * could be worked out at all the total is unknown rather than zero, because a
 * caught-up group and an unanswerable one must not look alike.
 */
func totalLag(lag kadm.GroupLag) (int64, bool) {
	total := int64(0)
	known := false
	for _, partitions := range lag {
		for _, entry := range partitions {
			if entry.Lag < 0 {
				continue
			}
			known = true
			total += entry.Lag
		}
	}
	return total, known
}
