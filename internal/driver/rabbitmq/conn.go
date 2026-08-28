package rabbitmq

import (
	"context"

	rabbithole "github.com/michaelklishin/rabbit-hole/v2"

	"github.com/amigoer/mq-studio/internal/model"
)

// Conn is one live RabbitMQ connection.
type Conn struct {
	client   *rabbithole.Client
	vhost    string
	endpoint string

	capabilities model.Capabilities
}

// Kind identifies the family.
func (c *Conn) Kind() model.MQKind { return model.KindRabbitMQ }

// Ping checks the management API still answers.
func (c *Conn) Ping(ctx context.Context) error {
	_, err := c.client.Overview()
	return err
}

// Capabilities is what this endpoint can do.
func (c *Conn) Capabilities() model.Capabilities { return c.capabilities }

// Close releases nothing: the management client is stateless HTTP.
func (c *Conn) Close() error { return nil }

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
	}
}

// probe narrows the family's best case to what this endpoint actually answers.
//
// A broker without the management plugin fails every admin call, and reporting
// that as "unsupported" without a reason would make a fixable deployment
// choice look like a missing feature.
func (c *Conn) probe(ctx context.Context) {
	c.capabilities = model.NewCapabilities(capabilities()...)

	if _, err := c.client.Overview(); err != nil {
		for _, capability := range capabilities() {
			c.capabilities = c.capabilities.WithDegraded(capability, managementPluginMissing)
		}
	}
}

// managementPluginMissing is an i18n key: the renderer turns it into a
// sentence, because a reason the user has to act on should be in their
// language.
const managementPluginMissing = "mq.rabbitmq.degraded.managementPlugin"
