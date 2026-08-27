package rocketmq

import (
	"context"
	"time"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// defaultRequestTimeout applies when a caller passes a context with no
// deadline. The orchestration layer always sets one; this only guards direct
// use from tests and background work.
const defaultRequestTimeout = 5 * time.Second

// Conn is one live RocketMQ connection.
//
// It holds no application settings: every method takes a context that already
// carries the request deadline, which is what keeps the driver from having to
// know the settings service exists.
type Conn struct {
	client   *admin.Client
	endpoint string
}

// NewConn wraps an already-created admin client.
func NewConn(client *admin.Client, endpoint string) *Conn {
	return &Conn{client: client, endpoint: endpoint}
}

// Kind identifies the family.
func (c *Conn) Kind() model.MQKind { return model.KindRocketMQ }

// Ping checks the NameServer still answers a route request.
func (c *Conn) Ping(ctx context.Context) error {
	_, err := c.client.ExamineBrokerClusterInfo(ctx)
	return err
}

// Capabilities is what a NameServer endpoint supports.
//
// A 5.x Proxy endpoint answers far less than this - it is a data plane only,
// with no topic listing, cluster topology or ACL - which is what the degraded
// entries in model.Capabilities exist to describe once endpoint probing lands.
func (c *Conn) Capabilities() model.Capabilities {
	return model.NewCapabilities(rocketMQCapabilities()...)
}

// Close is a no-op while the process-wide client manager owns the client's
// lifetime. It becomes real when the registry takes ownership.
func (c *Conn) Close() error { return nil }

func rocketMQCapabilities() []model.Capability {
	return []model.Capability{
		model.CapDestinationList,
		model.CapDestinationCreate,
		model.CapDestinationUpdate,
		model.CapDestinationDelete,
		model.CapPartitions,

		model.CapSubscriptionList,
		model.CapSubscriptionCreate,
		model.CapSubscriptionDelete,
		model.CapSubscriptionLag,
		model.CapOffsetReset,

		model.CapMessageQuery,
		model.CapMessageByID,
		model.CapMessageTrack,
		model.CapMessageResend,
		model.CapDLQ,
		model.CapPublish,

		model.CapClusterTopology,
		model.CapClusterMetrics,
		model.CapAccessControl,
	}
}

// timeoutFrom returns the budget left on ctx.
//
// The retry helpers need a duration rather than the context itself, because
// each attempt builds a fresh context: reusing one across retries would hand
// the second attempt an already-cancelled context.
func timeoutFrom(ctx context.Context) time.Duration {
	deadline, ok := ctx.Deadline()
	if !ok {
		return defaultRequestTimeout
	}
	if remaining := time.Until(deadline); remaining > 0 {
		return remaining
	}
	return 0
}

// CurrentConn wraps the process-wide default client as a driver.Conn.
//
// Scaffolding for the transition: the connection service still drives the
// global client manager, so this is how the new orchestration layer reaches a
// live client until the registry takes ownership of connection lifetime.
func CurrentConn() (driver.Conn, error) {
	client, err := GetClientManager().GetDefaultClient()
	if err != nil {
		return nil, driver.ErrNotConnected
	}
	return NewConn(client, GetClientManager().GetDefaultConnection()), nil
}

// defaultFetchLimit caps a message scan when the caller does not narrow it.
// The page size used to come from application settings; it is a query
// parameter now, and this is the fallback for callers that pass none.
const defaultFetchLimit = 32

// HasActiveConnection reports whether a client is already open, without
// dialling one. The background collector samples only when it is true.
func HasActiveConnection() bool {
	return GetClientManager().HasActiveDefaultClient()
}
