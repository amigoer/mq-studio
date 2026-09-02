package pulsar

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"sync"

	pulsarclient "github.com/apache/pulsar-client-go/pulsar"
	pulsaradmin "github.com/apache/pulsar-client-go/pulsaradmin/pkg/admin"
	"github.com/apache/pulsar-client-go/pulsaradmin/pkg/rest"

	"github.com/amigoer/mq-studio/internal/model"
)

// Conn is one live Pulsar connection.
//
// There are two clients because Pulsar has two planes. The admin client
// answers every listing and mutation over HTTP; the data client publishes and
// reads over the binary protocol. They fail independently, which is why they
// are probed independently.
type Conn struct {
	admin  pulsaradmin.Client
	client pulsarclient.Client
	config clientConfig
	// transport is the admin plane's, kept so Close can release its sockets.
	transport http.RoundTripper

	// producerCache holds one producer per topic. Reuse is not an
	// optimisation: every producer registers a name the broker holds until it
	// is closed, so one per send would exhaust maxProducersPerTopic.
	producerCache

	capabilities model.Capabilities
	closeOnce    sync.Once
}

// newConn wraps already-built clients. Tests hand it nil ones; Open hands it
// clients built from a profile.
func newConn(
	admin pulsaradmin.Client,
	client pulsarclient.Client,
	transport http.RoundTripper,
	config clientConfig,
) *Conn {
	return &Conn{admin: admin, client: client, transport: transport, config: config}
}

// Kind identifies the family.
func (c *Conn) Kind() model.MQKind { return model.KindPulsar }

// Ping checks both planes.
//
// It is only ever the "test connection" button - nothing polls it - so it is
// worth checking both: a profile whose admin API answers and whose broker port
// does not is a connection that will fail the first time anyone sends a
// message, and finding that out at test time is the whole point.
func (c *Conn) Ping(ctx context.Context) error {
	if err := c.pingAdmin(ctx); err != nil {
		return err
	}
	return c.pingDataPlane(ctx)
}

// pingAdmin is the one call every admin health check goes through.
//
// Listing the tenant's namespaces rather than the clusters, because it answers
// three questions at once: something is listening, the credential is accepted,
// and the tenant the profile is scoped to exists. A cluster listing would pass
// against a tenant that was deleted last week and leave every page empty with
// no explanation.
func (c *Conn) pingAdmin(ctx context.Context) error {
	_, err := c.admin.Namespaces().GetNamespacesWithContext(ctx, c.config.Tenant)
	return err
}

// pingDataPlane checks that the broker's binary listener is reachable.
//
// It is a dial and not a topic lookup on purpose. A lookup is the natural
// check, but on a broker with auto-creation left on it creates the topic it
// asks about, and a "test connection" button must not leave anything behind.
// So this proves the port answers and the credential is left to be judged the
// first time a real read or send needs it.
func (c *Conn) pingDataPlane(ctx context.Context) error {
	address, err := serviceAddress(c.config.ServiceURL)
	if err != nil {
		return err
	}
	dialer := net.Dialer{Timeout: c.config.Timeout}
	socket, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return err
	}
	return socket.Close()
}

// serviceAddress is the host:port a pulsar:// URL dials.
func serviceAddress(serviceURL string) (string, error) {
	parsed, err := url.Parse(serviceURL)
	if err != nil {
		return "", err
	}
	if parsed.Port() != "" {
		return parsed.Host, nil
	}
	return net.JoinHostPort(parsed.Hostname(), defaultPort), nil
}

// Capabilities is what this endpoint can do.
func (c *Conn) Capabilities() model.Capabilities { return c.capabilities }

// Close drops both clients.
//
// The registry closes on both disconnect and shutdown, so the second call has
// to be the one that does nothing: pulsar-client-go's Close is not documented
// as repeatable, and the admin transport holds sockets for reuse that a
// disconnected profile should not be holding.
func (c *Conn) Close() error {
	c.closeOnce.Do(func() {
		// Producers first: closing the client underneath them would leave the
		// broker holding their registered names until it times them out.
		c.closeProducers()
		if c.client != nil {
			c.client.Close()
		}
		c.closeIdleAdminConnections()
	})
	return nil
}

// closeIdleAdminConnections releases the sockets the admin transport keeps.
// The client is an interface with no accessor for its transport, so this
// reaches the one this package installed rather than the library's.
func (c *Conn) closeIdleAdminConnections() {
	if transport, ok := c.transport.(*http.Transport); ok {
		transport.CloseIdleConnections()
	}
}

// capabilities is the family's best case.
//
// It grows one port at a time: CheckConformance fails a capability with no
// interface behind it, so each one arrives in the commit that implements it
// rather than as a promise the connection cannot keep.
func capabilities() []model.Capability {
	return []model.Capability{
		model.CapClusterTopology,
		model.CapClusterMetrics,
		model.CapNodeConfig,
		model.CapClusterHealth,
		model.CapNamespaceList,
		model.CapNamespaceAdmin,
		model.CapNamespaceLimits,
		model.CapDestinationList,
		model.CapDestinationCreate,
		model.CapDestinationUpdate,
		model.CapDestinationDelete,
		model.CapPartitions,
		model.CapSubscriptionList,
		model.CapSubscriptionCreate,
		model.CapSubscriptionDelete,
		model.CapSubscriptionLag,
		model.CapSubscriptionRuntime,
		model.CapOffsetReset,
		model.CapMessageQuery,
		model.CapMessageByID,
		model.CapMessageLiveTail,
		model.CapDeadLetterTopology,
		model.CapPublish,
		model.CapDelayedDelivery,
		model.CapProducerInspect,
		model.CapIdentityPermissions,
	}
}

// dataPlaneCapabilities are the ones the binary protocol carries. Everything
// else is admin and survives a data plane that is down.
func dataPlaneCapabilities() []model.Capability {
	return []model.Capability{
		model.CapMessageQuery,
		model.CapMessageLiveTail,
		model.CapPublish,
		model.CapDelayedDelivery,
	}
}

// probe narrows the family's best case to what this endpoint actually answers.
//
// A cluster that rejects the token, or one scoped to a tenant that does not
// exist, fails every admin call. Reporting that as "unsupported" without a
// reason would make a fixable configuration mistake look like a missing
// feature.
func (c *Conn) probe(ctx context.Context) {
	c.capabilities = model.NewCapabilities(capabilities()...)

	if err := c.pingAdmin(ctx); err != nil {
		reason := degradeReason(err)
		for _, capability := range capabilities() {
			c.capabilities = c.capabilities.WithDegraded(capability, reason)
		}
		return
	}

	// A cluster whose load manager publishes nothing has no rates to draw, and
	// that is a configuration rather than a fault: NoopLoadManager is what the
	// standalone image ships with. Degrading with the reason keeps the page in
	// the sidebar and says why it is empty, instead of an alerts page that
	// silently never fires.
	if c.loadReport(ctx) == nil {
		c.capabilities = c.capabilities.WithDegraded(
			model.CapClusterMetrics, loadReportUnavailable)
	}

	// The data plane is probed separately because it fails separately. A
	// broker whose web service is behind an ingress and whose binary port is
	// not is a routine deployment, and reporting it at connect time is better
	// than a send console that only fails when a user presses the button.
	if err := c.pingDataPlane(ctx); err != nil {
		for _, capability := range dataPlaneCapabilities() {
			c.capabilities = c.capabilities.WithDegraded(capability, dataPlaneUnreachable)
		}
	}
}

// degradeReason names why this endpoint cannot serve the admin plane.
//
// All of these look the same to a caller - every capability goes away - but
// they are fixed in four different places, and only one of them is fixed by
// touching the cluster. Reporting a deleted tenant as "unreachable" sends
// someone to check a network that was fine.
func degradeReason(err error) string {
	switch statusOf(err) {
	case http.StatusUnauthorized:
		return credentialsRejected
	case http.StatusForbidden:
		return credentialsForbidden
	case http.StatusNotFound:
		// The probe asks for one tenant's namespaces, so the only thing a 404
		// can mean here is that the tenant is not there.
		return tenantMissing
	}
	if errors.Is(err, context.DeadlineExceeded) || isTimeout(err) {
		return endpointTimedOut
	}
	return endpointUnreachable
}

// statusOf reads the HTTP status back out of a pulsaradmin error, or 0 when
// the call never got a response at all.
func statusOf(err error) int {
	var response rest.Error
	if errors.As(err, &response) {
		return response.Code
	}
	return 0
}

func isTimeout(err error) bool {
	var timeout interface{ Timeout() bool }
	return errors.As(err, &timeout) && timeout.Timeout()
}

// The reasons a connection reports when a plane is unavailable. They are i18n
// keys rather than sentences: the renderer turns them into the user's own
// language, because each one asks the user to go and do something.
const (
	// credentialsRejected is a 401. The token is wrong or expired.
	credentialsRejected = "mq.pulsar.degraded.credentials"
	// credentialsForbidden is a 403. The token is valid and its role has no
	// permission on the tenant, which is a different fix in a different place.
	credentialsForbidden = "mq.pulsar.degraded.forbidden"
	// tenantMissing is a 404 from the tenant probe: the cluster answered and
	// the tenant this profile is scoped to is not on it.
	tenantMissing = "mq.pulsar.degraded.tenantMissing"
	// endpointTimedOut is a host that accepted the connection and went quiet.
	endpointTimedOut = "mq.pulsar.degraded.timeout"
	// endpointUnreachable is nothing answering the web service address at all.
	endpointUnreachable = "mq.pulsar.degraded.unreachable"
	// dataPlaneUnreachable is the admin API answering while the broker's
	// binary port does not, which is what a half-configured ingress looks
	// like from here.
	dataPlaneUnreachable = "mq.pulsar.degraded.dataPlaneUnreachable"
	// loadReportUnavailable is a load manager that publishes no figures. Not a
	// failure: NoopLoadManager is a valid choice and the standalone default,
	// and this is what tells an operator why the rates are missing.
	loadReportUnavailable = "mq.pulsar.degraded.loadReport"
)
