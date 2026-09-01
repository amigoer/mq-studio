package pulsar

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"sync"

	"github.com/apache/pulsar-client-go/pulsaradmin/pkg/utils"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/timestamp"
)

// statsConcurrency bounds the fan-out when a listing reads every topic's
// stats.
//
// A namespace with a thousand topics is a thousand requests either way; what
// this stops is a thousand of them in flight at once, which is enough to
// exhaust the broker's HTTP threads and make the app the reason its own
// cluster is slow.
const statsConcurrency = 8

// listCap bounds how many topics one listing enriches.
//
// The names all come back in one call and every one of them is listed. What is
// capped is the per-topic stats behind them, because that is the part that
// costs a request each. Past this the rows are still there and simply carry no
// figures, and the page says how many - a silent truncation would read as a
// namespace with fewer topics than it has.
const listCap = 500

// ListDestinations is every topic in a namespace.
//
// pulsaradmin's List makes four requests behind one call - partitioned and
// non-partitioned, each for persistent and non-persistent storage - and hands
// back the first two categories as separate slices. Both are merged here,
// because they are one page: an operator looking for a topic does not know or
// care which shape or storage it was declared with. Which one each actually is
// comes from its own URL, not from which slice it arrived in.
func (c *Conn) ListDestinations(
	ctx context.Context, filter model.DestinationFilter,
) ([]*model.Destination, error) {
	namespace := c.namespaceScope(filter.Namespace)
	name, err := utils.GetNamespaceName(namespace)
	if err != nil {
		return nil, fmt.Errorf("read the namespace %q: %w", namespace, err)
	}

	partitioned, nonPartitioned, err := c.admin.Topics().ListWithContext(ctx, *name)
	if err != nil {
		return nil, fmt.Errorf("list the topics of %q: %w", namespace, err)
	}

	urls := make([]string, 0, len(partitioned)+len(nonPartitioned))
	urls = append(urls, partitioned...)
	urls = append(urls, nonPartitioned...)
	sort.Strings(urls)

	destinations := make([]*model.Destination, 0, len(urls))
	for i, url := range urls {
		ref, isPersistent, err := parseTopicURL(url)
		if err != nil {
			// A name the driver cannot parse is still a topic on the cluster.
			// Dropping it would make the page disagree with pulsar-admin about
			// what is there, which is worse than a row with no detail.
			ref = model.DestinationRef{Namespace: namespace, Name: url}
		}
		if !filter.IncludeInternal && isInternalTopic(ref.Name) {
			continue
		}
		destinations = append(destinations, newDestination(i+1, ref, isPersistent))
	}

	c.enrich(ctx, destinations)
	return destinations, nil
}

// enrich fills in the figures, which cost a request per topic.
//
// Bounded twice: at most listCap topics are asked about, and at most
// statsConcurrency requests are in flight. Rows past the cap keep the unknown
// sentinel rather than a zero, so the page can say the figures are missing
// instead of claiming every one of those topics is empty.
func (c *Conn) enrich(ctx context.Context, destinations []*model.Destination) {
	limit := len(destinations)
	if limit > listCap {
		limit = listCap
	}

	var wait sync.WaitGroup
	slots := make(chan struct{}, statsConcurrency)
	for _, destination := range destinations[:limit] {
		wait.Add(1)
		go func(destination *model.Destination) {
			defer wait.Done()
			slots <- struct{}{}
			defer func() { <-slots }()
			c.applyStats(ctx, destination)
		}(destination)
	}
	wait.Wait()
}

/*
 * applyStats reads one topic's figures onto its row.
 *
 * Pulsar's two shapes answer at two different endpoints, and neither serves
 * the other: partitioned-stats returns 404 "Partitioned Topic not found" for a
 * non-partitioned topic, and stats returns one partition's figures rather than
 * a topic's for a partitioned one.
 *
 * So the partitioned endpoint is tried first - it is the shape whose figures
 * cannot be assembled any other way - and only a 404 falls through to the
 * plain one. Falling through on any error would turn a refused read into a
 * confident report of zero partitions.
 */
func (c *Conn) applyStats(ctx context.Context, destination *model.Destination) {
	topic, err := utils.GetTopicName(topicURL(destination.Ref, isPersistent(destination)))
	if err != nil {
		return
	}

	stats, err := c.admin.Topics().GetPartitionedStatsWithContext(ctx, *topic, false)
	if err == nil {
		applyTopicFigures(destination, topicFigures{
			partitions:     stats.Metadata.Partitions,
			subscriptions:  stats.Subscriptions,
			publishers:     len(stats.Publishers),
			rateIn:         stats.MsgRateIn,
			rateOut:        stats.MsgRateOut,
			storageSize:    stats.StorageSize,
			averageMsgSize: stats.AverageMsgSize,
			lastPublished:  stats.LastPublishTimestamp,
		})
		return
	}
	if statusOf(err) != http.StatusNotFound {
		return
	}

	plain, err := c.admin.Topics().GetStatsWithContext(ctx, *topic)
	if err != nil {
		return
	}
	applyTopicFigures(destination, topicFigures{
		// Zero here is a fact rather than a missing figure: the partitioned
		// endpoint said this topic is not one, which is what a non-partitioned
		// topic is.
		partitions:     0,
		subscriptions:  plain.Subscriptions,
		publishers:     len(plain.Publishers),
		rateIn:         plain.MsgRateIn,
		rateOut:        plain.MsgRateOut,
		storageSize:    plain.StorageSize,
		averageMsgSize: plain.AverageMsgSize,
		lastPublished:  plain.LastPublishTimestamp,
	})
}

// topicFigures is what the two stat shapes have in common, so the mapping onto
// a row is written once rather than kept in step in two places.
type topicFigures struct {
	partitions     int
	subscriptions  map[string]utils.SubscriptionStats
	publishers     int
	rateIn         float64
	rateOut        float64
	storageSize    int64
	averageMsgSize float64
	lastPublished  int64
}

func applyTopicFigures(destination *model.Destination, figures topicFigures) {
	destination.Partitions = figures.partitions
	destination.Subscribers = len(figures.subscriptions)
	destination.RateIn = int(figures.rateIn)
	destination.RateOut = int(figures.rateOut)
	destination.Depth = backlogOf(figures.subscriptions)

	destination.Attributes[AttrTopicStorageBytes] = strconv.FormatInt(figures.storageSize, 10)
	destination.Attributes[AttrTopicProducers] = strconv.Itoa(figures.publishers)
	destination.Attributes[AttrTopicAverageMessageBytes] = strconv.Itoa(int(figures.averageMsgSize))
	if figures.lastPublished > 0 {
		destination.LastUpdated = timestamp.FromUnixMilli(figures.lastPublished)
	}
}

/*
 * backlogOf is the deepest subscription's backlog, not the sum of them.
 *
 * A Pulsar topic holds one copy of each message and every subscription reads
 * it independently, so summing five subscriptions that are each ten messages
 * behind would report fifty messages the topic does not hold. The deepest one
 * is the number that answers "how far behind is this topic", which is what the
 * column is for.
 */
func backlogOf(subscriptions map[string]utils.SubscriptionStats) int64 {
	if len(subscriptions) == 0 {
		// No subscription is not a backlog of zero: nothing is reading, so
		// nothing is behind. Zero is the truthful answer here.
		return 0
	}
	deepest := int64(0)
	for _, subscription := range subscriptions {
		if subscription.MsgBacklog > deepest {
			deepest = subscription.MsgBacklog
		}
	}
	return deepest
}

// DestinationDetail is one topic, with its per-partition breakdown.
func (c *Conn) DestinationDetail(
	ctx context.Context, ref model.DestinationRef,
) (*model.Destination, error) {
	persistent, err := c.topicPersistence(ctx, ref)
	if err != nil {
		return nil, err
	}

	destination := newDestination(1, ref, persistent)
	c.applyStats(ctx, destination)
	return destination, nil
}

// topicPersistence answers which scheme a topic was declared with.
//
// The ref does not carry it - persistence rides in the attributes, which a
// detail request does not have yet - so it is asked of the cluster. Persistent
// is tried first because it is the overwhelming majority; a non-persistent
// topic costs one extra 404.
func (c *Conn) topicPersistence(ctx context.Context, ref model.DestinationRef) (bool, error) {
	for _, persistent := range []bool{true, false} {
		topic, err := utils.GetTopicName(topicURL(ref, persistent))
		if err != nil {
			return false, err
		}
		if _, err := c.admin.Topics().GetMetadataWithContext(ctx, *topic); err == nil {
			return persistent, nil
		}
	}
	return false, fmt.Errorf("no topic %s/%s on this cluster", ref.Namespace, ref.Name)
}

// CreateDestination declares a topic.
//
// Partitions is the decision that cannot be taken back: Pulsar can raise the
// count later but never lower it, and a non-partitioned topic can never become
// partitioned. Zero means non-partitioned, which is a different topic from one
// with a single partition - the second is addressed as name-partition-0 and
// can grow.
func (c *Conn) CreateDestination(ctx context.Context, spec model.DestinationSpec) error {
	persistent := spec.Attributes[AttrTopicPersistent] != "false"
	topic, err := utils.GetTopicName(topicURL(spec.Ref, persistent))
	if err != nil {
		return err
	}
	if spec.Partitions < 0 {
		return fmt.Errorf("a topic cannot have %d partitions", spec.Partitions)
	}
	if err := c.admin.Topics().CreateWithContext(ctx, *topic, spec.Partitions); err != nil {
		return fmt.Errorf("create topic %s: %w", topic.String(), err)
	}
	return nil
}

// UpdateDestination raises a partitioned topic's partition count.
//
// It is the only edit Pulsar offers on a topic, and it is one-way. Lowering is
// refused by the broker; refusing it here as well means the message names the
// field rather than arriving as a 409 about metadata.
func (c *Conn) UpdateDestination(ctx context.Context, spec model.DestinationSpec) error {
	persistent := spec.Attributes[AttrTopicPersistent] != "false"
	topic, err := utils.GetTopicName(topicURL(spec.Ref, persistent))
	if err != nil {
		return err
	}

	metadata, err := c.admin.Topics().GetMetadataWithContext(ctx, *topic)
	if err != nil {
		return fmt.Errorf("read the partitions of %s: %w", topic.String(), err)
	}
	if metadata.Partitions == 0 {
		return fmt.Errorf(
			"%s is not partitioned, and a non-partitioned topic cannot become one",
			topic.String())
	}
	if spec.Partitions <= metadata.Partitions {
		return fmt.Errorf(
			"%s already has %d partitions, and Pulsar cannot reduce them",
			topic.String(), metadata.Partitions)
	}
	if err := c.admin.Topics().UpdateWithContext(ctx, *topic, spec.Partitions); err != nil {
		return fmt.Errorf("raise the partitions of %s: %w", topic.String(), err)
	}
	return nil
}

// RemoveDestination deletes a topic.
//
// Not forced: Pulsar refuses while a producer or consumer is still attached,
// and that refusal is the point. Forcing it disconnects them mid-flight, which
// is a decision an operator should take deliberately rather than have taken
// for them by a delete button.
func (c *Conn) RemoveDestination(ctx context.Context, ref model.DestinationRef) error {
	persistent, err := c.topicPersistence(ctx, ref)
	if err != nil {
		return err
	}
	topic, err := utils.GetTopicName(topicURL(ref, persistent))
	if err != nil {
		return err
	}

	metadata, err := c.admin.Topics().GetMetadataWithContext(ctx, *topic)
	if err != nil {
		return fmt.Errorf("read the partitions of %s: %w", topic.String(), err)
	}
	// The two shapes are deleted through the same call and it has to be told
	// which one it is looking at: asking to delete a partitioned topic as
	// non-partitioned leaves every partition behind.
	nonPartitioned := metadata.Partitions == 0
	if err := c.admin.Topics().DeleteWithContext(ctx, *topic, false, nonPartitioned); err != nil {
		return fmt.Errorf("delete topic %s: %w", topic.String(), err)
	}
	return nil
}

// DestinationStats is the per-partition breakdown the detail panel draws.
func (c *Conn) DestinationStats(
	ctx context.Context, ref model.DestinationRef,
) (map[string]interface{}, error) {
	persistent, err := c.topicPersistence(ctx, ref)
	if err != nil {
		return nil, err
	}
	topic, err := utils.GetTopicName(topicURL(ref, persistent))
	if err != nil {
		return nil, err
	}

	stats, err := c.admin.Topics().GetPartitionedStatsWithContext(ctx, *topic, true)
	if err != nil {
		return nil, fmt.Errorf("read the stats of %s: %w", topic.String(), err)
	}

	partitions := make([]map[string]interface{}, 0, len(stats.Partitions))
	names := make([]string, 0, len(stats.Partitions))
	for name := range stats.Partitions {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		partition := stats.Partitions[name]
		partitions = append(partitions, map[string]interface{}{
			"name":          name,
			"backlog":       backlogOf(partition.Subscriptions),
			"storageSize":   partition.StorageSize,
			"msgRateIn":     partition.MsgRateIn,
			"msgRateOut":    partition.MsgRateOut,
			"producers":     len(partition.Publishers),
			"subscriptions": len(partition.Subscriptions),
		})
	}

	return map[string]interface{}{
		"partitions":    partitions,
		"storageSize":   stats.StorageSize,
		"backlog":       backlogOf(stats.Subscriptions),
		"producers":     len(stats.Publishers),
		"subscriptions": len(stats.Subscriptions),
		"msgRateIn":     stats.MsgRateIn,
		"msgRateOut":    stats.MsgRateOut,
	}, nil
}

func newDestination(id int, ref model.DestinationRef, persistent bool) *model.Destination {
	return &model.Destination{
		ID:  id,
		Ref: ref,
		// Every figure starts unknown and is filled in only by a stats read
		// that succeeded. A topic whose stats were refused reports nothing
		// rather than reporting that it is empty.
		Partitions:  model.UnknownMetric,
		Subscribers: model.UnknownMetric,
		Depth:       model.UnknownMetric,
		RateIn:      model.UnknownMetric,
		RateOut:     model.UnknownMetric,
		Attributes: map[string]string{
			AttrTopicPersistent: strconv.FormatBool(persistent),
		},
	}
}

func isPersistent(destination *model.Destination) bool {
	return destination.Attributes[AttrTopicPersistent] != "false"
}

// isInternalTopic reports the objects Pulsar keeps for its own bookkeeping.
//
// They are real topics in the listing and an operator browsing their own
// namespace does not want them, which is what the include-internal filter is
// for. Transaction buffer snapshots and the health-check topic are the ones a
// stock cluster creates on its own.
func isInternalTopic(name string) bool {
	switch name {
	case "__change_events", "__transaction_buffer_snapshot", "healthcheck":
		return true
	}
	return len(name) > 2 && name[0] == '_' && name[1] == '_'
}
