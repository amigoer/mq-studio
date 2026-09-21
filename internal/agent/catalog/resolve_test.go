package catalog

import (
	"context"
	"testing"

	"github.com/amigoer/mq-studio/internal/model"
)

// fakeConn is a connection that declares whatever a test needs and connects to
// nothing. Resolution is a question about the declared capabilities, so it is
// answerable with no broker, which is the same reason every driver's
// conformance test has an offline connection of its own.
type fakeConn struct {
	capabilities model.Capabilities
}

func (c *fakeConn) Kind() model.MQKind               { return model.KindRocketMQ }
func (c *fakeConn) Ping(_ context.Context) error     { return nil }
func (c *fakeConn) Capabilities() model.Capabilities { return c.capabilities }
func (c *fakeConn) Close() error                     { return nil }

func TestForReturnsOnlyWhatTheConnectionSupports(t *testing.T) {
	conn := &fakeConn{capabilities: model.NewCapabilities(
		model.CapDestinationList, model.CapDestinationPurge)}

	ids := make(map[string]bool)
	for _, resolved := range For(conn) {
		ids[resolved.ID] = true
		if resolved.Capability != model.CapDestinationList &&
			resolved.Capability != model.CapDestinationPurge {
			t.Errorf("%s came back for %s, which was not declared", resolved.ID, resolved.Capability)
		}
	}

	// One capability, several operations: the list and the detail read are
	// both gated on destination.list, and dropping a batch is gated on purge.
	for _, want := range []string{"destination.list", "destination.detail", "destination.purge", "destination.drop"} {
		if !ids[want] {
			t.Errorf("%s is missing from a connection that declares its capability", want)
		}
	}
	if ids["destination.delete"] {
		t.Error("destination.delete came back for a connection that cannot delete")
	}
}

// The caveat is the endpoint's, not the operation's. A browse that takes the
// message away on one family and leaves it on another is the same operation
// with the same blast radius, and the difference is only knowable here.
func TestForCarriesTheConnectionsOwnCaveat(t *testing.T) {
	const caveat = "browsing goes through basic.get, which alters queue state"
	conn := &fakeConn{capabilities: model.NewCapabilities(model.CapMessageQuery).
		WithCaveat(model.CapMessageQuery, caveat)}

	resolved := For(conn)
	if len(resolved) == 0 {
		t.Fatal("a connection declaring message.query got no operations")
	}
	for _, operation := range resolved {
		if operation.Caveat != caveat {
			t.Errorf("%s carries caveat %q, want the connection's own", operation.ID, operation.Caveat)
		}
	}

	// The same operation on an endpoint that declared nothing says nothing,
	// rather than repeating another family's warning.
	plain := &fakeConn{capabilities: model.NewCapabilities(model.CapMessageQuery)}
	for _, operation := range For(plain) {
		if operation.Caveat != "" {
			t.Errorf("%s invented a caveat: %q", operation.ID, operation.Caveat)
		}
	}
}

func TestCheckCoverageAcceptsACompleteConnection(t *testing.T) {
	conn := &fakeConn{capabilities: model.NewCapabilities(
		model.CapDestinationList, model.CapPublish, model.CapClusterHealth)}
	if problems := CheckCoverage(conn); len(problems) != 0 {
		for _, problem := range problems {
			t.Error(problem)
		}
	}
}

// A degraded capability has to yield nothing. The UI explains its absence
// where the control would be; a caller with no UI would be handed an operation
// the endpoint answers with an error.
func TestCheckCoverageRefusesOperationsOnADegradedCapability(t *testing.T) {
	conn := &fakeConn{capabilities: model.NewCapabilities(model.CapDestinationList).
		WithDegraded(model.CapDestinationList, "a Proxy endpoint has no topic listing")}

	// WithDegraded drops it from Supported, so nothing resolves and nothing is
	// reported: the connection and the catalogue agree it is unreachable.
	if resolved := For(conn); len(resolved) != 0 {
		t.Errorf("a degraded capability resolved to %d operations", len(resolved))
	}
	if problems := CheckCoverage(conn); len(problems) != 0 {
		for _, problem := range problems {
			t.Error(problem)
		}
	}
}

/*
 * Two ports carry no capability of their own and ride on another, which means
 * CheckConformance never asserts them. Twelve families declare
 * CapSubscriptionLag and three implement SubscriptionStats: for the other nine
 * the backlog arrives with the subscription listing and there is no
 * per-partition call to make.
 *
 * Offering those nine the operation anyway would be the exact thing this
 * application exists not to do - a control that fails when used.
 */
func TestARiderNeedsItsPortAndNotJustTheCapability(t *testing.T) {
	lagOnly := &fakeConn{capabilities: model.NewCapabilities(model.CapSubscriptionLag)}
	for _, operation := range For(lagOnly) {
		if operation.ID == "subscription.lag" {
			t.Error("subscription.lag was offered to a connection with no SubscriptionStats")
		}
	}

	withPort := &statsConn{fakeConn: fakeConn{
		capabilities: model.NewCapabilities(model.CapSubscriptionLag)}}
	offered := false
	for _, operation := range For(withPort) {
		if operation.ID == "subscription.lag" {
			offered = true
		}
	}
	if !offered {
		t.Error("subscription.lag was withheld from a connection that implements the port")
	}

	// The capability is still covered: CheckCoverage asks whether the
	// catalogue has an operation for it at all, not whether this endpoint
	// resolved one. A family that answers through its listing is not a gap.
	if problems := CheckCoverage(lagOnly); len(problems) != 0 {
		for _, problem := range problems {
			t.Error(problem)
		}
	}
}

// statsConn is a connection that also implements the rider port.
type statsConn struct {
	fakeConn
}

func (c *statsConn) SubscriptionStats(
	context.Context, model.SubscriptionRef,
) (map[string]interface{}, error) {
	return map[string]interface{}{}, nil
}
