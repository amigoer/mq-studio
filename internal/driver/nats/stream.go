package nats

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/nats-io/nats.go/jetstream"

	"github.com/amigoer/mq-studio/internal/model"
	"github.com/amigoer/mq-studio/internal/timestamp"
)

// errNoJetStream is asking a server that stores nothing about what it stores.
//
// Every method in this file starts here, because a connection whose JetStream
// tier did not answer still exists and its pages are still reachable - the
// capability is degraded rather than absent, so the request arrives and has to
// be refused with the reason the probe found.
func (c *Conn) requireJetStream() error {
	if c.js == nil || !c.tiers.jetStream {
		reason := c.tiers.jetStreamReason
		if reason == "" {
			reason = jetStreamDisabled
		}
		return &driverUnsupported{reason: reason}
	}
	return nil
}

// driverUnsupported carries an i18n key as its whole message, the way
// driver.UnsupportedError does: the renderer turns it into a sentence, and
// wrapping it in an English frame would put the key itself on screen.
type driverUnsupported struct{ reason string }

func (e *driverUnsupported) Error() string { return e.reason }

// maxStreams bounds one listing.
//
// The API pages at 256 and this walks every page, so the cap is about what a
// board can render rather than about protocol cost. A cluster with more
// streams than this is one where the list was never the useful view.
const maxStreams = 2000

// ListDestinations enumerates the account's JetStream streams.
//
// Streams, not subjects. A subject is a routing label with no existence of its
// own - nothing is declared, nothing is stored, and there is no way to
// enumerate the ones nobody is using. What can be listed is what the account
// has asked the server to keep, which is exactly a stream.
func (c *Conn) ListDestinations(ctx context.Context, filter model.DestinationFilter) ([]*model.Destination, error) {
	if err := c.requireJetStream(); err != nil {
		return nil, err
	}

	infos := make([]*jetstream.StreamInfo, 0, 32)
	lister := c.js.ListStreams(ctx)
	for info := range lister.Info() {
		// The system's own streams are hidden unless asked for, the way every
		// other family hides its internal destinations: KV buckets and object
		// stores are streams underneath, and listing them here would put a
		// dozen rows nobody created above the ones somebody did.
		if !filter.IncludeInternal && isInternalStream(info.Config.Name) {
			continue
		}
		infos = append(infos, info)
		if len(infos) >= maxStreams {
			break
		}
	}
	if err := lister.Err(); err != nil {
		return nil, err
	}

	sort.Slice(infos, func(i, j int) bool { return infos[i].Config.Name < infos[j].Config.Name })

	destinations := make([]*model.Destination, 0, len(infos))
	for index, info := range infos {
		destination := destinationOf(info)
		destination.ID = index + 1
		destinations = append(destinations, destination)
	}
	return destinations, nil
}

// DestinationDetail reads one stream.
func (c *Conn) DestinationDetail(ctx context.Context, ref model.DestinationRef) (*model.Destination, error) {
	if err := c.requireJetStream(); err != nil {
		return nil, err
	}
	stream, err := c.js.Stream(ctx, ref.Name)
	if err != nil {
		return nil, streamError(ref.Name, err)
	}
	// Ask for the per-subject counts here and not in the listing: they are one
	// entry per subject the stream has ever seen, which on a wildcard stream
	// is unbounded, and the list would carry all of it for every row.
	info, err := stream.Info(ctx, jetstream.WithSubjectFilter(">"))
	if err != nil {
		return nil, streamError(ref.Name, err)
	}
	return destinationOf(info), nil
}

// DestinationStats is the per-subject breakdown and the replica state.
//
// It answers the partitions page, and the mapping is not a stretch: a stream's
// subjects are the closest thing it has to parts, in that they are how its
// contents divide and where an operator looks when one of them is filling the
// stream up. What it is not is a unit of parallelism - every subject in a
// stream shares one sequence and one order.
func (c *Conn) DestinationStats(ctx context.Context, ref model.DestinationRef) (map[string]interface{}, error) {
	if err := c.requireJetStream(); err != nil {
		return nil, err
	}
	stream, err := c.js.Stream(ctx, ref.Name)
	if err != nil {
		return nil, streamError(ref.Name, err)
	}
	info, err := stream.Info(ctx, jetstream.WithSubjectFilter(">"))
	if err != nil {
		return nil, streamError(ref.Name, err)
	}

	subjects := make([]map[string]interface{}, 0, len(info.State.Subjects))
	for subject, count := range info.State.Subjects {
		subjects = append(subjects, map[string]interface{}{
			"subject":  subject,
			"messages": count,
		})
	}
	// Largest first: the reason to open this is to find what is filling a
	// stream, and an alphabetical list buries it.
	sort.Slice(subjects, func(i, j int) bool {
		left, right := subjects[i]["messages"].(uint64), subjects[j]["messages"].(uint64)
		if left != right {
			return left > right
		}
		return subjects[i]["subject"].(string) < subjects[j]["subject"].(string)
	})

	stats := map[string]interface{}{
		"stream":      info.Config.Name,
		"messages":    info.State.Msgs,
		"bytes":       info.State.Bytes,
		"firstSeq":    info.State.FirstSeq,
		"lastSeq":     info.State.LastSeq,
		"numSubjects": info.State.NumSubjects,
		"subjects":    subjects,
	}
	if info.Cluster != nil {
		peers := make([]map[string]interface{}, 0, len(info.Cluster.Replicas)+1)
		// The leader is a peer too, and one that is trivially current. Leaving
		// it out of the list would show a three-replica stream as two rows.
		peers = append(peers, map[string]interface{}{
			"name": info.Cluster.Leader, "leader": true, "current": true, "offline": false, "lag": 0,
		})
		for _, replica := range info.Cluster.Replicas {
			peers = append(peers, map[string]interface{}{
				"name":    replica.Name,
				"leader":  false,
				"current": replica.Current,
				"offline": replica.Offline,
				"lag":     replica.Lag,
			})
		}
		stats["cluster"] = info.Cluster.Name
		stats["leader"] = info.Cluster.Leader
		stats["peers"] = peers
	}
	return stats, nil
}

// destinationOf maps one stream onto the canonical model.
func destinationOf(info *jetstream.StreamInfo) *model.Destination {
	config := info.Config
	state := info.State

	destination := &model.Destination{
		Ref: model.DestinationRef{Name: config.Name},
		// A stream has no partitions. Every subject in it shares one sequence
		// and one order, so reporting the subject count here would put a
		// number under a column heading that means something else.
		Partitions:  model.UnknownMetric,
		Subscribers: state.Consumers,
		Depth:       int64(state.Msgs),
		// Rates are not reported per stream. JetStream counts messages and
		// bytes; a per-second figure would have to be two samples divided by
		// the time between them, and inventing one here would put a number
		// beside real ones with nothing marking it as derived.
		RateIn:      model.UnknownMetric,
		RateOut:     model.UnknownMetric,
		LastUpdated: timestamp.Now(),
		Attributes:  map[string]string{},
	}

	set := func(key, value string) {
		if value != "" {
			destination.Attributes[key] = value
		}
	}

	set(AttrSubjects, strings.Join(config.Subjects, ", "))
	set(AttrDescription, config.Description)
	set(AttrRetention, retentionName(config.Retention))
	set(AttrStorage, storageName(config.Storage))
	set(AttrDiscard, discardName(config.Discard))
	set(AttrReplicas, strconv.Itoa(max(config.Replicas, 1)))
	set(AttrMaxMsgs, strconv.FormatInt(config.MaxMsgs, 10))
	set(AttrMaxBytes, strconv.FormatInt(config.MaxBytes, 10))
	set(AttrMaxAge, config.MaxAge.String())
	set(AttrMaxMsgSize, strconv.FormatInt(int64(config.MaxMsgSize), 10))
	set(AttrMaxMsgsPer, strconv.FormatInt(config.MaxMsgsPerSubject, 10))
	set(AttrDuplicates, config.Duplicates.String())
	set(AttrCompression, compressionName(config.Compression))
	set(AttrSealed, strconv.FormatBool(config.Sealed))
	set(AttrDenyDelete, strconv.FormatBool(config.DenyDelete))
	set(AttrDenyPurge, strconv.FormatBool(config.DenyPurge))
	set(AttrAllowRollup, strconv.FormatBool(config.AllowRollup))
	set(AttrAllowDirect, strconv.FormatBool(config.AllowDirect))

	set(AttrFirstSeq, strconv.FormatUint(state.FirstSeq, 10))
	set(AttrLastSeq, strconv.FormatUint(state.LastSeq, 10))
	set(AttrBytes, strconv.FormatUint(state.Bytes, 10))
	set(AttrNumSubjects, strconv.FormatUint(state.NumSubjects, 10))
	set(AttrNumDeleted, strconv.Itoa(state.NumDeleted))
	set(AttrCreated, timestamp.FromTime(info.Created))
	// A stream with no messages has no first or last time, and the zero value
	// would render as a date in 1970 beside figures that are real.
	if state.Msgs > 0 {
		set(AttrFirstTime, timestamp.FromTime(state.FirstTime))
		set(AttrLastTime, timestamp.FromTime(state.LastTime))
	}

	if info.Cluster != nil {
		set(AttrClusterName, info.Cluster.Name)
		set(AttrLeader, info.Cluster.Leader)
		set(AttrReplicaState, replicaState(info))
		set(AttrReplicasHealthy, strconv.Itoa(healthyReplicas(info)))
	}
	if info.Mirror != nil {
		set(AttrMirrorOf, info.Mirror.Name)
	}
	if len(info.Sources) > 0 {
		names := make([]string, 0, len(info.Sources))
		for _, source := range info.Sources {
			names = append(names, source.Name)
		}
		set(AttrSourceOf, strings.Join(names, ", "))
	}
	return destination
}

// replicaState renders one line per peer, leader first.
//
// A rendered string rather than structured data because the attribute map
// carries strings, and the alternative - a shared model for one family's
// replica list - would be inventing a canonical shape for something only NATS
// and Kafka have, differently.
func replicaState(info *jetstream.StreamInfo) string {
	if info.Cluster == nil {
		return ""
	}
	lines := make([]string, 0, len(info.Cluster.Replicas)+1)
	lines = append(lines, info.Cluster.Leader+" leader")
	for _, replica := range info.Cluster.Replicas {
		switch {
		case replica.Offline:
			lines = append(lines, replica.Name+" offline")
		case !replica.Current:
			lines = append(lines, fmt.Sprintf("%s behind by %d", replica.Name, replica.Lag))
		default:
			lines = append(lines, replica.Name+" current")
		}
	}
	return strings.Join(lines, "\n")
}

// healthyReplicas counts the peers that are keeping up, the leader included.
func healthyReplicas(info *jetstream.StreamInfo) int {
	if info.Cluster == nil {
		return 0
	}
	healthy := 1 // the leader, which is current by definition
	for _, replica := range info.Cluster.Replicas {
		if replica.Current && !replica.Offline {
			healthy++
		}
	}
	return healthy
}

// isInternalStream reports the streams JetStream creates for its own features.
//
// KV buckets and object stores are streams underneath, named by convention.
// They are real and worth a page of their own; what they are not is something
// somebody declared on the streams board, and listing them there puts rows
// nobody made above the ones they did.
func isInternalStream(name string) bool {
	return strings.HasPrefix(name, "KV_") || strings.HasPrefix(name, "OBJ_")
}

// streamError names the stream a request was about.
//
// The library's "stream not found" carries no name, and a board that asked
// about one stream and is showing three would otherwise report a failure with
// nothing to attach it to.
func streamError(name string, err error) error {
	if errors.Is(err, jetstream.ErrStreamNotFound) {
		return fmt.Errorf("stream %q does not exist", name)
	}
	return err
}

func retentionName(policy jetstream.RetentionPolicy) string {
	switch policy {
	case jetstream.InterestPolicy:
		return "interest"
	case jetstream.WorkQueuePolicy:
		return "workqueue"
	default:
		return "limits"
	}
}

func storageName(storage jetstream.StorageType) string {
	if storage == jetstream.MemoryStorage {
		return "memory"
	}
	return "file"
}

func discardName(policy jetstream.DiscardPolicy) string {
	if policy == jetstream.DiscardNew {
		return "new"
	}
	return "old"
}

func compressionName(compression jetstream.StoreCompression) string {
	if compression == jetstream.S2Compression {
		return "s2"
	}
	return "none"
}
