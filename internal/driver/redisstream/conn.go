package redisstream

import (
	"context"
	"errors"
	"net"
	"sync"

	"github.com/redis/go-redis/v9"

	"github.com/amigoer/mq-studio/internal/model"
)

// Conn is one live Redis connection.
//
// There is one client, not two. Redis administers itself over the same
// connection that carries XADD, so unlike RabbitMQ there is no second plane to
// dial and no way for the admin half to answer while the data half does not.
type Conn struct {
	client redis.UniversalClient

	// config is kept for what the commands need beyond the client: the stream
	// filter the listing scans with, and the deployment, which decides whether
	// a call may be made once for the whole keyspace or has to be made per
	// node.
	config clientConfig

	capabilities model.Capabilities
	closeOnce    sync.Once
}

// newConn wraps an already-built client. Tests hand it one pointed at an
// in-process server; Open hands it one built from a profile.
func newConn(client redis.UniversalClient, config clientConfig) *Conn {
	return &Conn{client: client, config: config}
}

// Kind identifies the family.
func (c *Conn) Kind() model.MQKind { return model.KindRedisStream }

// Ping asks the server, over the wire, every time.
//
// go-redis connects lazily, so this is also the first thing that authenticates:
// a profile with a wrong password builds a client without complaint and fails
// here. That is what makes it the right question for the probe to ask.
func (c *Conn) Ping(ctx context.Context) error {
	return c.client.Ping(ctx).Err()
}

// Capabilities is what this endpoint can do.
func (c *Conn) Capabilities() model.Capabilities { return c.capabilities }

// Close releases the connection pool. The registry closes on both disconnect
// and shutdown, so the second call has to be the one that does nothing.
func (c *Conn) Close() error {
	var err error
	c.closeOnce.Do(func() { err = c.client.Close() })
	return err
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
		model.CapDestinationDelete,
	}
}

// probe narrows the family's best case to what this endpoint actually answers.
//
// Everything goes at once because in Redis everything is one connection: a
// server that will not answer PING will not list a stream either. What differs
// between the failures is only the reason, and that is the part worth getting
// right - a rejected password and an unreachable host send an operator to
// completely different places.
func (c *Conn) probe(ctx context.Context) {
	c.capabilities = model.NewCapabilities(capabilities()...)

	if err := c.Ping(ctx); err != nil {
		reason := degradeReason(err)
		for _, capability := range capabilities() {
			c.capabilities = c.capabilities.WithDegraded(capability, reason)
		}
	}
}

// degradeReason names why this endpoint cannot be administered.
//
// The cases look identical to a caller - every capability goes away - and are
// fixed in six different places. Collapsing any two of them sends an operator
// to the wrong one.
//
// Every Redis-reply case is matched with HasErrorPrefix rather than with the
// IsAuthError family beside it. Those read the error through errors.As against
// a concrete type inside the library, which nothing outside it can construct -
// so a table test would have had to assert a classification it could not
// actually run, and the only coverage left would have been a live broker.
// HasErrorPrefix matches on the exported redis.Error interface and on the same
// prefixes the server sends, so the unit tests exercise this function rather
// than a paraphrase of it.
func degradeReason(err error) string {
	switch {
	case err == nil:
		return ""
	// Ordered before the wrong-password cases on purpose: a password sent to a
	// server that has none is an authentication failure by Redis's reckoning,
	// and reporting it as a wrong password sends someone to correct a
	// credential they should be deleting.
	case redis.HasErrorPrefix(err, "Client sent AUTH"):
		return credentialsNotRequired
	case redis.HasErrorPrefix(err, "NOAUTH"), redis.HasErrorPrefix(err, "WRONGPASS"):
		return credentialsRejected
	case redis.HasErrorPrefix(err, "NOPERM"):
		return credentialsForbidden
	// Not a failure so much as a "not yet": a server reading its dataset back
	// off disk answers this and then starts working on its own. Reporting it
	// as unreachable would have people restarting a server that is recovering.
	case redis.HasErrorPrefix(err, "LOADING"):
		return serverLoading
	case errors.Is(err, context.DeadlineExceeded), isTimeout(err):
		return endpointTimedOut
	default:
		return endpointUnreachable
	}
}

func isTimeout(err error) bool {
	var timeout net.Error
	return errors.As(err, &timeout) && timeout.Timeout()
}

// The reasons a connection reports when the server is unavailable. They are
// i18n keys rather than sentences: the renderer turns them into the user's own
// language, because each one asks the user to go and do something.
const (
	// credentialsRejected is NOAUTH or WRONGPASS. The password or the username
	// is wrong, or the server wants one and the form gave none.
	credentialsRejected = "mq.redis-stream.degraded.credentials"
	// credentialsNotRequired is the opposite mistake: a password was supplied
	// to a server that has none configured. The connection is refused all the
	// same, and the fix is to clear the field rather than to correct it.
	credentialsNotRequired = "mq.redis-stream.degraded.credentialsNotRequired"
	// credentialsForbidden is NOPERM - the credential is right and its ACL
	// does not allow the command. A different fix, on the server rather than
	// in this form.
	credentialsForbidden = "mq.redis-stream.degraded.forbidden"
	// serverLoading is a server reading its dataset back into memory. It
	// starts answering on its own, so the pages say to wait rather than
	// showing an error that reads like a fault.
	serverLoading = "mq.redis-stream.degraded.loading"
	// endpointTimedOut is a host that accepted the connection and went quiet.
	endpointTimedOut = "mq.redis-stream.degraded.timeout"
	// endpointUnreachable is nothing answering at all. It also covers a
	// plaintext client against a TLS-only server, which from here is
	// indistinguishable: the handshake simply never produces a reply the
	// client understands.
	endpointUnreachable = "mq.redis-stream.degraded.unreachable"
)
