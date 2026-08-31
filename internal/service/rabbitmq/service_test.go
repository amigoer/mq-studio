package rabbitmq

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

type fakeSettings struct{ timeout time.Duration }

func (s fakeSettings) GetRequestTimeout() time.Duration { return s.timeout }

// fakeConn implements only what a test asks it to, which is the point: the
// service decides what to do by asserting on interfaces, so a connection that
// does not implement one has to be a real Go type that does not.
type fakeConn struct {
	capabilities model.Capabilities
}

func (c *fakeConn) Kind() model.MQKind               { return model.KindRabbitMQ }
func (c *fakeConn) Ping(context.Context) error       { return nil }
func (c *fakeConn) Capabilities() model.Capabilities { return c.capabilities }
func (c *fakeConn) Close() error                     { return nil }

// censusConn also reports, and records the context it was handed.
type censusConn struct {
	fakeConn
	gotDeadline bool
}

func (c *censusConn) Census(ctx context.Context) (*model.BrokerCensus, error) {
	_, c.gotDeadline = ctx.Deadline()
	return &model.BrokerCensus{ClusterName: "test"}, nil
}

func serviceWith(conn driver.Conn) *Service {
	return New(func(int) (driver.Conn, error) {
		if conn == nil {
			return nil, driver.ErrNotConnected
		}
		return conn, nil
	}, fakeSettings{timeout: 5 * time.Second})
}

func supporting(capabilities ...model.Capability) model.Capabilities {
	return model.NewCapabilities(capabilities...)
}

// A page that loads while nothing is dialled draws its own not-connected
// state. Returning an error here would put a banner on top of it saying the
// same thing again.
func TestCensusIsNilWhenNothingIsConnected(t *testing.T) {
	census, err := serviceWith(nil).Census(context.Background(), 1)
	if err != nil {
		t.Fatalf("Census: %v", err)
	}
	if census != nil {
		t.Errorf("census = %+v, want nil", census)
	}
}

// The capability check comes before the type assertion so the reason names the
// capability rather than a Go type the user has never heard of.
func TestCensusRefusesAConnectionThatDoesNotDeclareIt(t *testing.T) {
	conn := &censusConn{fakeConn: fakeConn{capabilities: supporting(model.CapDestinationList)}}

	_, err := serviceWith(conn).Census(context.Background(), 1)
	var unsupported *driver.UnsupportedError
	if !errors.As(err, &unsupported) {
		t.Fatalf("err = %v, want an UnsupportedError", err)
	}
	if unsupported.Capability != model.CapClusterCensus {
		t.Errorf("capability = %q, want %q", unsupported.Capability, model.CapClusterCensus)
	}
}

// The opposite mistake: declared but not implemented. It should be caught by
// the driver's conformance test, but the service must not panic on it either.
func TestCensusRefusesAConnectionThatDeclaresItWithoutImplementingIt(t *testing.T) {
	conn := &fakeConn{capabilities: supporting(model.CapClusterCensus)}

	_, err := serviceWith(conn).Census(context.Background(), 1)
	var unsupported *driver.UnsupportedError
	if !errors.As(err, &unsupported) {
		t.Fatalf("err = %v, want an UnsupportedError", err)
	}
}

// Drivers are told the context already carries the deadline. Nothing checks
// that from the driver side, so it is checked here.
func TestCensusInjectsTheRequestDeadline(t *testing.T) {
	conn := &censusConn{fakeConn: fakeConn{capabilities: supporting(model.CapClusterCensus)}}

	if _, err := serviceWith(conn).Census(context.Background(), 1); err != nil {
		t.Fatalf("Census: %v", err)
	}
	if !conn.gotDeadline {
		t.Error("the driver was called with a context carrying no deadline")
	}
}

// replicationConn is the read half of the shovel and federation page.
type replicationConn struct {
	fakeConn
	gotDeadline bool
	deleted     string
}

func (c *replicationConn) ListShovels(ctx context.Context) ([]*model.Shovel, error) {
	_, c.gotDeadline = ctx.Deadline()
	return []*model.Shovel{{Name: "orders-to-archive"}}, nil
}

func (c *replicationConn) RemoveShovel(_ context.Context, _, name string) error {
	c.deleted = name
	return nil
}

func (c *replicationConn) ListFederationUpstreams(context.Context) ([]*model.FederationUpstream, error) {
	return []*model.FederationUpstream{{Name: "eu-west"}}, nil
}

func (c *replicationConn) RemoveFederationUpstream(_ context.Context, _, name string) error {
	c.deleted = name
	return nil
}

/*
 * A broker without the shovel plugin is a deployment choice, not a failure.
 * The capability is absent, the sidebar says why, and a page that loads anyway
 * gets an empty list rather than an error banner on top of the explanation.
 */
func TestShovelsAreEmptyWhenNothingIsConnected(t *testing.T) {
	shovels, err := serviceWith(nil).Shovels(context.Background(), 1)
	if err != nil {
		t.Fatalf("Shovels: %v", err)
	}
	if len(shovels) != 0 {
		t.Errorf("shovels = %v, want none", shovels)
	}
}

func TestShovelsRefuseABrokerWithoutTheCapability(t *testing.T) {
	conn := &replicationConn{fakeConn: fakeConn{capabilities: supporting(model.CapDestinationList)}}

	_, err := serviceWith(conn).Shovels(context.Background(), 1)
	var unsupported *driver.UnsupportedError
	if !errors.As(err, &unsupported) {
		t.Fatalf("err = %v, want an UnsupportedError", err)
	}
	if unsupported.Capability != model.CapReplication {
		t.Errorf("capability = %q, want %q", unsupported.Capability, model.CapReplication)
	}
}

// Deleting is the destructive half, and it must be refused for the same reason
// rather than reaching a driver that cannot service it.
func TestDeletingAShovelIsRefusedWithoutTheCapability(t *testing.T) {
	conn := &replicationConn{fakeConn: fakeConn{capabilities: supporting(model.CapDestinationList)}}

	err := serviceWith(conn).DeleteShovel(context.Background(), 1, "/", "orders-to-archive")
	var unsupported *driver.UnsupportedError
	if !errors.As(err, &unsupported) {
		t.Fatalf("err = %v, want an UnsupportedError", err)
	}
	if conn.deleted != "" {
		t.Errorf("the driver deleted %q despite the refusal", conn.deleted)
	}
}

func TestReplicationInjectsTheRequestDeadline(t *testing.T) {
	conn := &replicationConn{fakeConn: fakeConn{capabilities: supporting(model.CapReplication)}}

	if _, err := serviceWith(conn).Shovels(context.Background(), 1); err != nil {
		t.Fatalf("Shovels: %v", err)
	}
	if !conn.gotDeadline {
		t.Error("the driver was called with a context carrying no deadline")
	}
}

func TestFederationUpstreamsReachTheDriverWhenSupported(t *testing.T) {
	conn := &replicationConn{fakeConn: fakeConn{capabilities: supporting(model.CapReplication)}}

	upstreams, err := serviceWith(conn).FederationUpstreams(context.Background(), 1)
	if err != nil {
		t.Fatalf("FederationUpstreams: %v", err)
	}
	if len(upstreams) != 1 || upstreams[0].Name != "eu-west" {
		t.Errorf("upstreams = %v", upstreams)
	}

	if err := serviceWith(conn).DeleteFederationUpstream(context.Background(), 1, "/", "eu-west"); err != nil {
		t.Fatalf("DeleteFederationUpstream: %v", err)
	}
	if conn.deleted != "eu-west" {
		t.Errorf("deleted = %q, want eu-west", conn.deleted)
	}
}

// streamConn answers about the clients attached over a protocol of its own.
type streamConn struct {
	fakeConn
	gotRef model.DestinationRef
}

func (c *streamConn) StreamClients(_ context.Context, ref model.DestinationRef) (*model.StreamClients, error) {
	c.gotRef = ref
	return &model.StreamClients{Consumers: []*model.StreamConsumer{{Offset: 42}}}, nil
}

/*
 * The panel sits inside a queue detail that is otherwise complete, so a broker
 * that cannot answer leaves one section explaining itself rather than failing
 * the queue around it.
 */
func TestStreamClientsAreNilWhenNothingIsConnected(t *testing.T) {
	clients, err := serviceWith(nil).StreamClients(context.Background(), 1, "/", "events")
	if err != nil {
		t.Fatalf("StreamClients: %v", err)
	}
	if clients != nil {
		t.Errorf("clients = %+v, want nil", clients)
	}
}

// The stream management plugin being off is a deployment choice, and the
// refusal has to name the capability so the panel can explain which one.
func TestStreamClientsAreRefusedWithoutTheCapability(t *testing.T) {
	conn := &streamConn{fakeConn: fakeConn{capabilities: supporting(model.CapDestinationList)}}

	_, err := serviceWith(conn).StreamClients(context.Background(), 1, "/", "events")
	var unsupported *driver.UnsupportedError
	if !errors.As(err, &unsupported) {
		t.Fatalf("err = %v, want an UnsupportedError", err)
	}
	if unsupported.Capability != model.CapStreamClients {
		t.Errorf("capability = %q, want %q", unsupported.Capability, model.CapStreamClients)
	}
}

// The vhost and the queue name are two arguments across the bridge and one
// ref below it, and swapping them would silently report another queue's
// clients.
func TestStreamClientsReachTheDriverWithTheirRef(t *testing.T) {
	conn := &streamConn{fakeConn: fakeConn{capabilities: supporting(model.CapStreamClients)}}

	clients, err := serviceWith(conn).StreamClients(context.Background(), 1, "orders", "events")
	if err != nil {
		t.Fatalf("StreamClients: %v", err)
	}
	if conn.gotRef.Namespace != "orders" || conn.gotRef.Name != "events" {
		t.Errorf("ref = %+v", conn.gotRef)
	}
	if len(clients.Consumers) != 1 || clients.Consumers[0].Offset != 42 {
		t.Errorf("clients = %+v", clients)
	}
}
