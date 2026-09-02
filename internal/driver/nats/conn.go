package nats

import (
	"context"
	"errors"
	"sync"

	natsclient "github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"

	"github.com/amigoer/mq-studio/internal/model"
)

// errConnectionDown is the connection having dropped, as opposed to a request
// failing. The two lead somewhere different - one is the network, the other is
// the server's answer - so they must not arrive as the same error.
var errConnectionDown = errors.New("nats connection is not open")

// Conn is one live NATS connection.
//
// Two sockets, not one. An account is an isolation boundary, so $SYS.REQ.* is
// unreachable from the account the pages read through: asking the cluster
// about itself means a second connection under the system account's own
// credentials, and where none were configured there simply is no second one.
type Conn struct {
	nc     *natsclient.Conn
	js     jetstream.JetStream
	config clientConfig

	// monitor is the server's HTTP monitoring endpoint, set when one answered.
	// Nil is ordinary rather than a failure: it is off unless the operator
	// started the server with -m, and nothing in the protocol replaces it.
	monitor *monitorClient

	// system is the connection under the system account. Nil is ordinary for
	// the same reason - most profiles will not carry those credentials.
	system *systemClient

	tiers        tiers
	capabilities model.Capabilities
	closeOnce    sync.Once
}

// Kind identifies the family.
func (c *Conn) Kind() model.MQKind { return model.KindNATS }

// Ping asks the server to answer over the wire, every time.
//
// A round trip rather than the library's IsConnected flag: that reports what
// the client last believed, and a connection whose server has gone away keeps
// saying yes until the next ping interval - which is two minutes by default,
// and two minutes of a page insisting a dead cluster is healthy.
func (c *Conn) Ping(ctx context.Context) error {
	if c.nc == nil {
		return errConnectionDown
	}
	if err := c.nc.FlushWithContext(ctx); err != nil {
		return err
	}
	if !c.nc.IsConnected() {
		return errConnectionDown
	}
	return nil
}

// Capabilities is what this endpoint can do.
func (c *Conn) Capabilities() model.Capabilities { return c.capabilities }

// Close releases both connections. The registry closes on disconnect and on
// shutdown, so the second call has to be the one that does nothing.
func (c *Conn) Close() error {
	c.closeOnce.Do(func() {
		if c.system != nil {
			c.system.close()
		}
		if c.nc != nil {
			c.nc.Close()
		}
	})
	return nil
}

// The capabilities, grouped by the tier that answers them.
//
// Grouped rather than listed flat because the grouping is this driver's whole
// shape: which tier a capability belongs to is what decides whether a
// connection keeps it, and a flat list plus a separate degrade table would be
// two places to add a capability and one place to forget.
var (
	// protocolCapabilities need nothing but a connection, so they never
	// degrade: a connection that opened can do them.
	protocolCapabilities = []model.Capability{}

	// jetStreamCapabilities go when the persistence layer does.
	jetStreamCapabilities = []model.Capability{
		model.CapDestinationList,
		model.CapDestinationCreate,
		model.CapDestinationUpdate,
		model.CapDestinationDelete,
		model.CapPartitions,
		model.CapStreamTrim,
		model.CapSubscriptionList,
		model.CapSubscriptionCreate,
		model.CapSubscriptionDelete,
		model.CapSubscriptionLag,
		model.CapMessageQuery,
		model.CapMessageByID,
		model.CapMessageLiveTail,
	}

	// clusterCapabilities are answered by the monitoring endpoint or by the
	// system account, so they survive either one being absent and go only when
	// both are.
	clusterCapabilities = []model.Capability{}
)

// capabilities is the family's best case.
//
// It grows one port at a time: CheckConformance fails a capability with no
// interface behind it, so each one arrives in the commit that implements it
// rather than as a promise the connection cannot keep.
func capabilities() []model.Capability {
	all := make([]model.Capability, 0,
		len(protocolCapabilities)+len(jetStreamCapabilities)+len(clusterCapabilities))
	all = append(all, protocolCapabilities...)
	all = append(all, jetStreamCapabilities...)
	all = append(all, clusterCapabilities...)
	return all
}

// tiers is which of the four sources answered, and why the others did not.
//
// The protocol tier is not here because it cannot be absent: this struct is
// only ever filled in after a connection opened, and a connection that opened
// can publish, subscribe and make requests. What differs between endpoints is
// everything built on top of that.
type tiers struct {
	jetStream       bool
	jetStreamReason string
	monitor         bool
	monitorReason   string
	system          bool
	systemReason    string
}

// probe narrows the family's best case to what this endpoint actually answers.
//
// Three tiers are asked, in an order that matters at the end rather than the
// start: JetStream and the system account are independent, but the monitoring
// endpoint and the system account answer the same cluster questions by
// different means, so which of them is present decides whether a missing one
// costs anything.
func (c *Conn) probe(ctx context.Context) {
	c.tiers = tiers{}
	c.probeJetStream(ctx)
	c.probeSystem(ctx)
	c.probeMonitor(ctx)
	c.capabilities = c.declare()
}

// declare turns the probe's findings into what the UI gates on.
//
// Separate from probe so the mapping can be tested against a tiers value
// rather than against a broker: the interesting cases are combinations, and
// standing up a server for each of eight would be slow and would still not
// cover the ones no server can produce.
func (c *Conn) declare() model.Capabilities {
	declared := model.NewCapabilities(capabilities()...)

	// Degraded rather than absent, and that distinction is the whole point of
	// the middle state: a server without JetStream still has streams as a
	// concept, so the page stays in the sidebar and says why it is empty. A
	// page that vanished would read as an app that had lost a feature.
	if !c.tiers.jetStream {
		for _, capability := range jetStreamCapabilities {
			declared = declared.WithDegraded(capability, c.tiers.jetStreamReason)
		}
	}

	// The cluster pages take whichever of the two sources answered. The
	// reason reported when neither did is the system account's, because that
	// is the one that would answer for the whole cluster - the monitoring
	// endpoint would answer for one server, and telling somebody to configure
	// the lesser of the two first is the wrong order to fix it in.
	if !c.tiers.system && !c.tiers.monitor {
		for _, capability := range clusterCapabilities {
			declared = declared.WithDegraded(capability, c.tiers.systemReason)
		}
	}
	return declared
}

// probeJetStream asks the account what its JetStream limits are, which is the
// only request that distinguishes the two ways it can be missing.
//
// A server built without JetStream and an account not permitted to use it are
// different problems with different fixes - one is how the server was started,
// the other is how the account was written - and the API answers them with
// different error codes. Collapsing them into one sentence would send half the
// readers to the wrong file.
func (c *Conn) probeJetStream(ctx context.Context) {
	if c.js == nil {
		c.tiers.jetStreamReason = jetStreamDisabled
		return
	}
	if _, err := c.js.AccountInfo(ctx); err != nil {
		switch {
		case errors.Is(err, jetstream.ErrJetStreamNotEnabledForAccount):
			c.tiers.jetStreamReason = jetStreamNoAccount
		default:
			c.tiers.jetStreamReason = jetStreamDisabled
		}
		return
	}
	c.tiers.jetStream = true
}

// probeSystem opens the second connection and asks the cluster to name itself.
//
// Credentials that were never given and credentials the server refused are
// reported apart: the first is a form to fill in, the second is an account to
// check, and an operator handed one message for both would try the wrong one
// first.
func (c *Conn) probeSystem(ctx context.Context) {
	if c.config.SystemUser == "" && c.config.SystemPassword == "" {
		c.tiers.systemReason = systemAbsent
		return
	}
	system, err := dialSystem(ctx, c.config)
	if err != nil {
		c.tiers.systemReason = systemForbidden
		return
	}
	c.system = system
	c.tiers.system = true
}

// probeMonitor checks that the endpoint the form named is really there.
//
// An address nobody entered and an address that does not answer are different
// states, and the second is the one worth interrupting somebody for: it means
// they configured something that is not working, rather than something they
// chose not to configure.
func (c *Conn) probeMonitor(ctx context.Context) {
	if c.config.MonitorURL == "" {
		c.tiers.monitorReason = monitorAbsent
		return
	}
	monitor := newMonitorClient(c.config.MonitorURL, c.config.DialTimeout)
	if _, err := monitor.varz(ctx); err != nil {
		c.tiers.monitorReason = monitorUnreachable
		return
	}
	c.monitor = monitor
	c.tiers.monitor = true
}

// The reasons a connection reports for a tier it cannot read. They are i18n
// keys rather than sentences: the renderer turns them into the user's own
// language, because each one asks the user to go and do something.
//
// They are duplicated in frontend/src/i18n/degradedReasons.test.ts. Nothing in
// either language ties a Go string to a JSON key, so a second copy that goes
// red is the only thing that can catch a rename.
const (
	// jetStreamDisabled is a server started without JetStream. There is
	// nothing to grant; the subsystem is not running.
	jetStreamDisabled = "mq.nats.degraded.jetstreamDisabled"
	// jetStreamNoAccount is a server that has JetStream and an account that
	// may not use it. The fix is in the account, not in how the server was
	// started.
	jetStreamNoAccount = "mq.nats.degraded.jetstreamNoAccount"
	// monitorAbsent is no monitoring address on the connection form. The
	// server may well be serving one; nobody said where.
	monitorAbsent = "mq.nats.degraded.monitorAbsent"
	// monitorUnreachable is an address that was given and did not answer,
	// which is a working configuration somebody has to repair.
	monitorUnreachable = "mq.nats.degraded.monitorUnreachable"
	// systemAbsent is no system-account credentials on the form.
	systemAbsent = "mq.nats.degraded.systemAbsent"
	// systemForbidden is credentials that were given and refused - usually an
	// ordinary account's, which cannot reach $SYS however valid it is.
	systemForbidden = "mq.nats.degraded.systemForbidden"
)
