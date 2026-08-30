package rabbitmq

import (
	"context"
	"errors"
	"net/http"
	"strings"

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
		return
	}
	reason := degradeReason(err)
	for _, capability := range capabilities() {
		c.capabilities = c.capabilities.WithDegraded(capability, reason)
	}
}

// degradeReason names why this endpoint cannot serve the admin plane.
//
// All of these look the same to a caller - every capability goes away - but
// they are fixed in completely different places, and only one of them is fixed
// by touching the broker's plugins. Reporting a typo'd password as "enable the
// management plugin" sent people to reconfigure a broker that was fine.
func degradeReason(err error) string {
	switch statusOf(err) {
	case http.StatusUnauthorized:
		return credentialsRejected
	case http.StatusForbidden:
		return credentialsForbidden
	case http.StatusNotFound:
		return managementPluginMissing
	}
	if errors.Is(err, context.DeadlineExceeded) || isTimeout(err) {
		return endpointTimedOut
	}
	return endpointUnreachable
}

// statusOf reads the HTTP status back out of a rabbit-hole error, or 0 when
// the call never got a response at all.
func statusOf(err error) int {
	var response rabbithole.ErrorResponse
	if errors.As(err, &response) {
		return response.StatusCode
	}
	// rabbit-hole short-circuits 401 into a bare errors.New before it builds
	// an ErrorResponse, so that one can only be read out of the text.
	if strings.Contains(err.Error(), "401 Unauthorized") {
		return http.StatusUnauthorized
	}
	return 0
}

func isTimeout(err error) bool {
	var timeout interface{ Timeout() bool }
	return errors.As(err, &timeout) && timeout.Timeout()
}

// browseCaveat is an i18n key. Browsing a queue is a POST that alters queue
// state even when the message is requeued, so the UI says so rather than
// letting an operator find out afterwards.
const browseCaveat = "mq.rabbitmq.caveat.browseAltersQueue"

// The reasons a connection reports when the admin plane is unavailable. They
// are i18n keys rather than sentences: the renderer turns them into the user's
// own language, because each one asks the user to go and do something.
const (
	// credentialsRejected is a 401. The password is wrong.
	credentialsRejected = "mq.rabbitmq.degraded.credentials"
	// credentialsForbidden is a 403. The password is right and the user has no
	// management tag, which is a different fix in a different place.
	credentialsForbidden = "mq.rabbitmq.degraded.forbidden"
	// managementPluginMissing is a 404: something answered, but the API is not
	// mounted there.
	managementPluginMissing = "mq.rabbitmq.degraded.managementPlugin"
	// endpointTimedOut is a host that accepted the connection and went quiet.
	endpointTimedOut = "mq.rabbitmq.degraded.timeout"
	// endpointUnreachable is nothing answering at all. The wording names both
	// causes on purpose: with the plugin off nothing listens on the management
	// port, so from here that is indistinguishable from a wrong address.
	endpointUnreachable = "mq.rabbitmq.degraded.unreachable"
)
