package rocketmq

import (
	"context"
	"sync"
	"time"

	"github.com/amigoer/mq-studio/internal/driver/rocketmq/resource"
	"github.com/amigoer/mq-studio/internal/model"

	admin "github.com/amigoer/rocketmq-admin-go"
)

// defaultRequestTimeout applies when a caller passes a context with no
// deadline. The orchestration layer always sets one; this only guards direct
// use from tests and background work.
const defaultRequestTimeout = 5 * time.Second

// Conn is one live RocketMQ connection.
//
// It owns its admin client: the registry opens one Conn per profile, so two
// profiles aimed at the same NameServer hold two clients and closing either
// leaves the other working. The client field is guarded because a reconnect
// swaps it while other requests are in flight.
//
// It holds no application settings: every method takes a context that already
// carries the request deadline, which is what keeps the driver from having to
// know the settings service exists.
type Conn struct {
	mu       sync.RWMutex
	client   *admin.Client
	config   ClientConfig
	endpoint string
}

// NewConn wraps an already-dialled admin client.
func NewConn(client *admin.Client, config ClientConfig, endpoint string) *Conn {
	return &Conn{client: client, config: config, endpoint: endpoint}
}

// Kind identifies the family.
func (c *Conn) Kind() model.MQKind { return model.KindRocketMQ }

// The three namespace boundaries.
//
// A RocketMQ namespace is a naming convention rather than a broker object, so
// this connection is scoped by wrapping every name it sends and unwrapping
// every name it shows. Inside the driver a name is always broker-real, which
// is what lets the retry and dead-letter composition ("%DLQ%" + group) stay as
// it was and still come out as RocketMQ's "%DLQ%ns%group".
//
// All three are the identity function on a connection with no namespace, so
// the unscoped path is unchanged rather than merely equivalent.

// wrap turns a name a page passed in into the one the broker stores.
func (c *Conn) wrap(name string) string {
	return resource.Wrap(c.config.Namespace, name)
}

// unwrap turns a name the broker returned into the one a page shows.
func (c *Conn) unwrap(name string) string {
	return resource.Unwrap(c.config.Namespace, name)
}

// owns reports whether a broker-real name is in this connection's scope. It is
// what the topic and group listings filter on.
func (c *Conn) owns(name string) bool {
	return resource.In(c.config.Namespace, name)
}

// current returns the client to issue the next request on.
func (c *Conn) current() *admin.Client {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.client
}

// Ping checks the NameServer still answers a route request.
func (c *Conn) Ping(ctx context.Context) error {
	_, err := c.current().ExamineBrokerClusterInfo(ctx)
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

// Close releases this connection's client.
func (c *Conn) Close() error {
	c.mu.Lock()
	client := c.client
	c.client = nil
	c.mu.Unlock()
	if client != nil {
		client.Close()
	}
	return nil
}

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
		model.CapOffsetClone,
		model.CapQueueOffset,
		model.CapSubscriptionRuntime,

		model.CapMessageQuery,
		model.CapMessageByID,
		model.CapMessageTrack,
		model.CapMessageLiveTail,
		model.CapMessageResend,
		model.CapMessageReplay,
		model.CapDLQ,
		model.CapPublish,
		model.CapDelayedDelivery,
		model.CapProducerInspect,

		model.CapClusterTopology,
		model.CapClusterMetrics,
		model.CapDirectory,
		model.CapNodeConfig,
		model.CapNodeMaintenance,
		model.CapNodeWritePerm,
		model.CapAccessControl,
		model.CapAccessDirectory,

		model.CapConnectionScope,
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

// defaultFetchLimit caps a message scan when the caller does not narrow it.
// The page size used to come from application settings; it is a query
// parameter now, and this is the fallback for callers that pass none.
const defaultFetchLimit = 32
