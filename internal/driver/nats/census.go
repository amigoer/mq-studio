package nats

import (
	"context"
	"errors"
	"fmt"
	"net/url"

	"github.com/nats-io/nats.go/jetstream"

	"github.com/amigoer/mq-studio/internal/model"
)

// Census answers for the whole account in one request.
//
// The account rather than the cluster, which is what makes this answerable at
// all: JetStream keeps running totals per account - how many streams and
// consumers exist, how much memory and disk they occupy - and reports them in
// one call. A figure assembled by walking every stream would take a minute on
// a large account and would never have been true at any single moment.
//
// What it cannot answer it says nothing about rather than guessing. Several of
// the canonical fields are RabbitMQ's vocabulary and have no NATS counterpart,
// and a zero in them would read as an empty broker.
func (c *Conn) Census(ctx context.Context) (*model.BrokerCensus, error) {
	if err := c.requireJetStream(); err != nil {
		return nil, err
	}

	info, err := c.js.AccountInfo(ctx)
	if err != nil {
		if errors.Is(err, jetstream.ErrJetStreamNotEnabledForAccount) {
			return nil, &driverUnsupported{reason: jetStreamNoAccount}
		}
		return nil, err
	}

	census := &model.BrokerCensus{
		// Streams are this family's destinations, so they go where queues do.
		Queues:    info.Streams,
		Consumers: info.Consumers,
		// NATS has no exchanges and no channels. Zero is the honest answer
		// for a concept that does not exist - unlike the message counts
		// below, where zero would mean "holds nothing".
		Exchanges: 0,
		Channels:  0,
	}

	// The version and cluster come from whichever of the two cluster tiers
	// answered, because JetStream's account info carries neither.
	if identity, err := c.identity(ctx); err == nil {
		census.ClusterName = identity.Cluster.Name
		census.Version = identity.Version
		census.RuntimeVersion = identity.Go
		census.Connections = identity.Connections
	} else {
		census.Connections = model.UnknownMetric
	}

	// Message counts are deliberately absent, and this is the one worth
	// explaining. JetStream reports bytes stored per account, not messages -
	// there is no account-wide message total anywhere, and no split between
	// deliverable and unacknowledged, because "unacknowledged" is a property
	// of a consumer rather than of the account. Zero would say the account
	// holds nothing.
	census.Total = model.UnknownMetric
	census.Ready = model.UnknownMetric
	census.Unacknowledged = model.UnknownMetric

	return census, nil
}

// identity is whichever cluster tier can name the server this is connected to.
func (c *Conn) identity(ctx context.Context) (*varzResponse, error) {
	if c.monitor != nil {
		return c.monitor.varz(ctx)
	}
	if c.system != nil {
		replies, err := c.system.ping(ctx, endpointVarz, 1)
		if err != nil {
			return nil, err
		}
		if len(replies) == 0 {
			return nil, fmt.Errorf("no server answered")
		}
		var varz varzResponse
		if err := unmarshalReply(replies[0], &varz); err != nil {
			return nil, err
		}
		return &varz, nil
	}
	return nil, fmt.Errorf("no server can be asked about itself")
}

// AccountUsage is what the account is using against what it may use.
//
// Its own type rather than part of the census, because the census is a count
// of objects and this is a pair of meters. The limits matter as much as the
// usage: -1 means no cap, and a meter drawn against -1 can never move.
type AccountUsage struct {
	MemoryUsed  int64 `json:"memoryUsed"`
	MemoryLimit int64 `json:"memoryLimit"`
	StoreUsed   int64 `json:"storeUsed"`
	StoreLimit  int64 `json:"storeLimit"`

	Streams       int `json:"streams"`
	StreamLimit   int `json:"streamLimit"`
	Consumers     int `json:"consumers"`
	ConsumerLimit int `json:"consumerLimit"`

	// Domain is set where the cluster has been split by a leaf node. Empty is
	// the ordinary case.
	Domain string `json:"domain"`
	// Tier names which limit set applies, on an account with several. Empty
	// where the account has one, which is almost always.
	Tier string `json:"tier"`
}

// Usage reads the account's JetStream meters.
func (c *Conn) Usage(ctx context.Context) (*AccountUsage, error) {
	if err := c.requireJetStream(); err != nil {
		return nil, err
	}
	info, err := c.js.AccountInfo(ctx)
	if err != nil {
		return nil, err
	}

	usage := &AccountUsage{
		MemoryUsed:    int64(info.Memory),
		StoreUsed:     int64(info.Store),
		Streams:       info.Streams,
		Consumers:     info.Consumers,
		MemoryLimit:   info.Limits.MaxMemory,
		StoreLimit:    info.Limits.MaxStore,
		StreamLimit:   info.Limits.MaxStreams,
		ConsumerLimit: info.Limits.MaxConsumers,
		Domain:        info.Domain,
	}

	// An account with tiers reports its real limits per tier and leaves the
	// top-level ones at zero, which would draw every meter as full. Where
	// there is exactly one tier it is the account's limits; where there are
	// several, no single set applies and the page says so rather than picking.
	if len(info.Tiers) == 1 {
		for name, tier := range info.Tiers {
			usage.Tier = name
			usage.MemoryLimit = tier.Limits.MaxMemory
			usage.StoreLimit = tier.Limits.MaxStore
			usage.StreamLimit = tier.Limits.MaxStreams
			usage.ConsumerLimit = tier.Limits.MaxConsumers
		}
	}
	return usage, nil
}

// Health runs the server's own health check.
//
// The server's opinion rather than a judgement made here, which is the whole
// point of the port: /healthz is what the server answers about itself, and it
// checks things this app cannot see - whether the JetStream meta group has a
// leader, whether every stream and consumer it is responsible for has been
// recovered from disk.
func (c *Conn) Health(ctx context.Context) (*model.BrokerHealth, error) {
	if c.monitor == nil {
		reason := c.tiers.monitorReason
		if reason == "" {
			reason = monitorAbsent
		}
		return nil, &driverUnsupported{reason: reason}
	}

	health := &model.BrokerHealth{}
	// Three checks rather than one, because /healthz answers a different
	// question per set of parameters and an operator needs to know which part
	// is unhealthy. A server can be up and serving core NATS perfectly while
	// its JetStream assets are still being recovered.
	for _, check := range []struct {
		id    string
		query url.Values
	}{
		{id: HealthCheckServer, query: url.Values{}},
		{id: HealthCheckJetStream, query: url.Values{"js-enabled-only": {"true"}}},
		{id: HealthCheckAssets, query: url.Values{"js-server-only": {"false"}}},
	} {
		health.Checks = append(health.Checks, c.runHealthCheck(ctx, check.id, check.query))
	}
	return health, nil
}

// The health checks this driver asks for. They are ids rather than sentences:
// the renderer turns them into labels in the user's own language.
const (
	// HealthCheckServer is whether the server is running and serving.
	HealthCheckServer = "server"
	// HealthCheckJetStream is whether JetStream is enabled and its meta group
	// has a leader. A server can serve core NATS perfectly with this failing.
	HealthCheckJetStream = "jetstream"
	// HealthCheckAssets is whether every stream and consumer this server is
	// responsible for has been recovered. On a restart it is the last to pass.
	HealthCheckAssets = "assets"
)

// runHealthCheck asks once and reports what came back.
func (c *Conn) runHealthCheck(ctx context.Context, id string, query url.Values) *model.HealthCheck {
	check := &model.HealthCheck{ID: id}
	err := c.monitor.get(ctx, pathHealthz, query, nil)
	if err == nil {
		check.Passed = true
		return check
	}

	var status *monitorError
	if errors.As(err, &status) {
		// The server answered and said no. That is a failure with a reason,
		// which is what this page is for - the body carries what is wrong.
		check.Reason = status.Body
		return check
	}
	// The endpoint could not be reached at all, which is not the same as a
	// server reporting itself unhealthy and must not be drawn as one.
	check.Unavailable = true
	check.Reason = err.Error()
	return check
}
