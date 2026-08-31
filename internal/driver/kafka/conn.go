package kafka

import (
	"context"
	"errors"
	"io"
	"net"
	"sync"
	"syscall"

	"github.com/twmb/franz-go/pkg/kadm"
	"github.com/twmb/franz-go/pkg/kerr"
	"github.com/twmb/franz-go/pkg/kgo"

	"github.com/amigoer/mq-studio/internal/model"
)

// Conn is one live Kafka connection.
//
// There is one client, not two. Kafka administers itself over the same
// protocol and the same sockets that carry records, so unlike RabbitMQ there
// is no second plane to dial and no way for one half to be reachable while the
// other is not.
type Conn struct {
	client *kgo.Client
	admin  *kadm.Client
	seeds  []string

	// config is kept because reading records needs a second client: franz-go
	// fixes what a client consumes when it is created, so a browse builds one
	// of its own from the same profile and closes it again.
	config clientConfig

	// authenticating records that the profile carries a SASL mechanism. It is
	// what lets a dropped connection be told apart from an unreachable one:
	// see degradeReason.
	authenticating bool

	capabilities model.Capabilities
	closeOnce    sync.Once
}

// newConn wraps an already-built client. Tests hand it a client pointed at an
// in-process cluster; Open hands it one built from a profile.
func newConn(client *kgo.Client, admin *kadm.Client, config clientConfig) *Conn {
	return &Conn{
		client:         client,
		admin:          admin,
		seeds:          config.Seeds,
		config:         config,
		authenticating: config.Mechanism != "" && config.Mechanism != model.AuthNone,
	}
}

// Kind identifies the family.
func (c *Conn) Kind() model.MQKind { return model.KindKafka }

// Ping asks a broker to describe itself, over the wire, every time.
//
// kgo.Ping rather than kadm.BrokerMetadata: the latter answers from the
// metadata cache, so it returns success against a cluster that died a minute
// ago and even on a context that was already cancelled. A "test connection"
// button that passes without touching the broker is worse than no button.
func (c *Conn) Ping(ctx context.Context) error {
	return c.client.Ping(ctx)
}

// topologyChanged is called after this app alters the cluster.
//
// It nudges the client's own metadata, which routes produce and fetch, so a
// record sent right after a topic is created does not go looking for a leader
// that was not there a moment ago. Reads do not depend on it - they go through
// fresh below.
func (c *Conn) topologyChanged() {
	c.client.ForceMetadataRefresh()
}

/*
 * fresh asks for metadata that has not been cached.
 *
 * Every kadm listing reads through franz-go's metadata cache, and a console
 * cannot use one. Deleting a topic whose detail panel was open left the topic
 * listed and its detail readable: the panel had populated the cache moments
 * earlier, the delete does not invalidate it, and the entry outlived the thing
 * it described. An operator seeing that deletes it again.
 *
 * WithAuthorizedOps is the only exported way to make kadm bypass the cache -
 * it marks the context so metadata is requested directly rather than served.
 * Asking for authorized operations along the way is harmless; kadm already
 * requests them at the cluster level on every call, and this adds the
 * per-topic ones.
 */
func fresh(ctx context.Context) context.Context {
	return kadm.WithAuthorizedOps(ctx)
}

// Capabilities is what this endpoint can do.
func (c *Conn) Capabilities() model.Capabilities { return c.capabilities }

// Close drops every broker connection. franz-go's Close is not documented as
// repeatable and the registry closes on both disconnect and shutdown, so the
// second call has to be the one that does nothing.
func (c *Conn) Close() error {
	c.closeOnce.Do(func() { c.client.Close() })
	return nil
}

// capabilities is the family's best case.
//
// It grows one port at a time: CheckConformance fails a capability with no
// interface behind it, so each one arrives in the commit that implements it
// rather than as a promise the connection cannot keep.
func capabilities() []model.Capability {
	return []model.Capability{
		model.CapDestinationList,
		model.CapDestinationCreate,
		model.CapDestinationUpdate,
		model.CapDestinationDelete,
		model.CapPartitions,
		model.CapDestinationPurge,
		model.CapQueueRebalance,
		model.CapReassign,

		model.CapSubscriptionList,
		model.CapSubscriptionDelete,
		model.CapSubscriptionLag,
		model.CapOffsetReset,
		model.CapOffsetClone,
		model.CapQueueOffset,

		model.CapMessageQuery,
		model.CapMessageByID,
		model.CapMessageLiveTail,
		model.CapPublish,

		model.CapClusterTopology,
		model.CapClusterMetrics,
		model.CapNodeConfig,
		model.CapLogDirs,

		model.CapAccessDirectory,
		model.CapQuotaList,
		model.CapQuotaAdmin,
	}
}

// probe narrows the family's best case to what this cluster actually answers.
//
// Everything goes at once because in Kafka everything is one connection: a
// cluster that will not describe itself will not list a topic either. What
// differs between the failures is only the reason, and that is the part worth
// getting right - "wrong password" and "wrong address" send an operator to
// completely different places.
func (c *Conn) probe(ctx context.Context) {
	c.capabilities = model.NewCapabilities(capabilities()...)

	if err := c.Ping(ctx); err != nil {
		reason := degradeReason(err, c.authenticating)
		for _, capability := range capabilities() {
			c.capabilities = c.capabilities.WithDegraded(capability, reason)
		}
		return
	}

	// A cluster with no authorizer answers SECURITY_DISABLED to every ACL
	// call. That is a deployment choice rather than a failure, so the page is
	// still drawn and says why it is empty - which is more use than an error
	// that reads like the cluster is broken.
	if enabled, err := c.DirectoryEnabled(ctx); err != nil || !enabled {
		c.capabilities = c.capabilities.WithDegraded(model.CapAccessDirectory, accessControlDisabled)
	}
}

// degradeReason names why this cluster cannot be administered.
//
// The cases are indistinguishable to a caller - every capability goes away -
// and are fixed in completely different places. Reporting a rejected
// credential as "cluster unreachable" sends people to check firewalls.
//
// authenticating is what makes a dropped connection readable. A broker that
// refuses a SASL exchange is allowed to answer with SASL_AUTHENTICATION_FAILED
// or to simply close the socket, and both happen: Kafka returns the code over
// SaslAuthenticate v1 and up, and closes the connection otherwise. A bare EOF
// therefore means "the credential" on a profile that authenticates and
// "nothing usable is listening there" on one that does not.
func degradeReason(err error, authenticating bool) string {
	switch {
	case err == nil:
		return ""
	case errors.Is(err, kerr.SaslAuthenticationFailed),
		errors.Is(err, kerr.UnsupportedSaslMechanism),
		errors.Is(err, kerr.IllegalSaslState):
		return credentialsRejected
	case errors.Is(err, kerr.ClusterAuthorizationFailed):
		return credentialsForbidden
	case errors.Is(err, context.DeadlineExceeded), isTimeout(err):
		return endpointTimedOut
	case authenticating && isConnectionDropped(err):
		return credentialsRejected
	default:
		return endpointUnreachable
	}
}

func isTimeout(err error) bool {
	var timeout net.Error
	return errors.As(err, &timeout) && timeout.Timeout()
}

// isConnectionDropped is the broker hanging up mid-conversation, as opposed to
// never accepting the connection at all. Refusing to dial is a different
// outcome and must not land here, or a wrong port would be reported as a wrong
// password.
func isConnectionDropped(err error) bool {
	return errors.Is(err, io.EOF) ||
		errors.Is(err, io.ErrUnexpectedEOF) ||
		errors.Is(err, syscall.ECONNRESET)
}

// The reasons a connection reports when the cluster is unavailable. They are
// i18n keys rather than sentences: the renderer turns them into the user's own
// language, because each one asks the user to go and do something.
const (
	// credentialsRejected is the broker refusing the SASL exchange. The
	// mechanism being wrong lands here too, because from the user's side both
	// are the credential half of the form - and because a broker that closes
	// the connection instead of answering leaves no way to tell them apart.
	credentialsRejected = "mq.kafka.degraded.credentials"
	// credentialsForbidden is a credential the cluster accepted and an ACL
	// that does not let it describe the cluster - a different fix, on the
	// broker rather than in this form.
	credentialsForbidden = "mq.kafka.degraded.forbidden"
	// endpointTimedOut is a host that accepted the connection and went quiet.
	endpointTimedOut = "mq.kafka.degraded.timeout"
	// accessControlDisabled is a cluster running without an authorizer. Its
	// ACL calls all answer SECURITY_DISABLED, which is a deployment choice
	// rather than a fault, so the page explains itself instead of failing.
	accessControlDisabled = "mq.kafka.degraded.accessControl"

	// endpointUnreachable is nothing answering at all. It also covers a
	// listener reached over the wrong security protocol, which from here is
	// indistinguishable: a plaintext client against a TLS listener simply
	// never gets a reply it understands.
	endpointUnreachable = "mq.kafka.degraded.unreachable"
)
