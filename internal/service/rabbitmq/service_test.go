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
