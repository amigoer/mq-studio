package rabbitmq

import (
	"context"
	"net/http"

	rabbithole "github.com/michaelklishin/rabbit-hole/v3"

	"github.com/amigoer/mq-studio/internal/model"
)

// Conn is one live RabbitMQ connection.
type Conn struct {
	mgmt     *mgmt
	vhost    string
	endpoint string
	// version is the broker version, read once at connect: the node listing
	// does not carry it and asking per node would be a request each.
	version string

	capabilities model.Capabilities
}

// Kind identifies the family.
func (c *Conn) Kind() model.MQKind { return model.KindRabbitMQ }

// Ping checks the management API still answers.
func (c *Conn) Ping(ctx context.Context) error {
	_, err := c.overview(ctx)
	return err
}

// overview is the one call every health check goes through.
func (c *Conn) overview(ctx context.Context) (*rabbithole.Overview, error) {
	return call(ctx, c.mgmt, func(client *rabbithole.Client) (*rabbithole.Overview, error) {
		return client.Overview()
	})
}

// Capabilities is what this endpoint can do.
func (c *Conn) Capabilities() model.Capabilities { return c.capabilities }

// Close drops the connection's idle HTTP connections.
//
// The management API is stateless, so there is no session to end - but the
// transport this connection owns holds sockets open for reuse, and a profile
// that has been disconnected should not still be holding one.
func (c *Conn) Close() error {
	if transport, ok := c.mgmt.transport.(*http.Transport); ok {
		transport.CloseIdleConnections()
	}
	return nil
}

// capabilities is the family's best case.
//
// What is absent matters as much as what is present. There is no offset to
// reset, no partition to count and no stable message id to look one up by, so
// those capabilities are never declared and the UI never offers the controls.
//
// destination.update is absent for a different reason: a queue's durability
// and type are fixed at declaration, so there is nothing an edit form could
// change. subscription.create and subscription.delete are absent because a
// consumer appears when an application attaches, not when an admin asks.
func capabilities() []model.Capability {
	return []model.Capability{
		model.CapDestinationList,
		model.CapDestinationCreate,
		model.CapDestinationDelete,

		model.CapSubscriptionList,
		model.CapSubscriptionLag,

		model.CapMessageQuery,
		model.CapPublish,

		model.CapClusterTopology,
		model.CapClusterMetrics,
		model.CapRouting,
	}
}

// probe narrows the family's best case to what this endpoint actually answers.
//
// A broker without the management plugin fails every admin call, and reporting
// that as "unsupported" without a reason would make a fixable deployment
// choice look like a missing feature.
func (c *Conn) probe(ctx context.Context) {
	// Browsing works and still deserves a warning, which is the third
	// capability state: supported, but with a consequence the user has to
	// know about before clicking.
	c.capabilities = model.NewCapabilities(capabilities()...).
		WithCaveat(model.CapMessageQuery, browseCaveat)

	overview, err := c.overview(ctx)
	if err == nil {
		c.version = overview.RabbitMQVersion
	} else {
		for _, capability := range capabilities() {
			c.capabilities = c.capabilities.WithDegraded(capability, managementPluginMissing)
		}
	}
}

// browseCaveat is an i18n key. Browsing a queue is a POST that alters queue
// state even when the message is requeued, so the UI says so rather than
// letting an operator find out afterwards.
const browseCaveat = "mq.rabbitmq.caveat.browseAltersQueue"

// managementPluginMissing is an i18n key: the renderer turns it into a
// sentence, because a reason the user has to act on should be in their
// language.
const managementPluginMissing = "mq.rabbitmq.degraded.managementPlugin"
