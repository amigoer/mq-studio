package driver

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/amigoer/mq-studio/internal/model"
)

type fakeConn struct {
	kind         model.MQKind
	capabilities model.Capabilities

	mu     sync.Mutex
	closed int
}

func (c *fakeConn) Kind() model.MQKind               { return c.kind }
func (c *fakeConn) Ping(context.Context) error       { return nil }
func (c *fakeConn) Capabilities() model.Capabilities { return c.capabilities }
func (c *fakeConn) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closed++
	return nil
}
func (c *fakeConn) closeCount() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.closed
}

// destinationConn implements DestinationAdmin so conformance has something to
// assert against.
type destinationConn struct{ fakeConn }

func (c *destinationConn) ListDestinations(context.Context) ([]*model.Destination, error) {
	return nil, nil
}
func (c *destinationConn) DestinationDetail(context.Context, model.DestinationRef) (*model.Destination, error) {
	return nil, nil
}
func (c *destinationConn) CreateDestination(context.Context, model.DestinationSpec) error { return nil }
func (c *destinationConn) UpdateDestination(context.Context, model.DestinationSpec) error { return nil }
func (c *destinationConn) RemoveDestination(context.Context, model.DestinationRef) error  { return nil }

type fakeDriver struct {
	kind    model.MQKind
	conn    Conn
	openErr error
}

func (d *fakeDriver) Kind() model.MQKind { return d.kind }
func (d *fakeDriver) Descriptor() model.DriverDescriptor {
	return model.DriverDescriptor{Kind: d.kind}
}
func (d *fakeDriver) Open(context.Context, model.ConnectionProfile) (Conn, error) {
	if d.openErr != nil {
		return nil, d.openErr
	}
	return d.conn, nil
}

func registerForTest(t *testing.T, d Driver) {
	t.Helper()
	Register(d)
	t.Cleanup(func() {
		catalogMu.Lock()
		delete(catalog, d.Kind())
		catalogMu.Unlock()
	})
}

func TestOpenRejectsAnUnregisteredKind(t *testing.T) {
	registry := NewRegistry()

	err := registry.Open(context.Background(), model.ConnectionProfile{ID: 1, Kind: "nope"})

	if !errors.Is(err, ErrUnknownKind) {
		t.Fatalf("err = %v; want ErrUnknownKind", err)
	}
}

// Reopening a profile after the user edits it must not leak the old client.
func TestOpenClosesTheConnectionItReplaces(t *testing.T) {
	first := &fakeConn{kind: model.KindRocketMQ}
	second := &fakeConn{kind: model.KindRocketMQ}
	d := &fakeDriver{kind: model.KindRocketMQ, conn: first}
	registerForTest(t, d)
	registry := NewRegistry()
	profile := model.ConnectionProfile{ID: 7, Kind: model.KindRocketMQ}

	if err := registry.Open(context.Background(), profile); err != nil {
		t.Fatalf("first open: %v", err)
	}
	d.conn = second
	if err := registry.Open(context.Background(), profile); err != nil {
		t.Fatalf("second open: %v", err)
	}

	if first.closeCount() != 1 {
		t.Errorf("replaced connection closed %d times; want 1", first.closeCount())
	}
	conn, ok := registry.Get(7)
	if !ok || conn != second {
		t.Error("registry did not keep the newer connection")
	}
}

func TestSetActiveRequiresAnOpenConnection(t *testing.T) {
	registry := NewRegistry()

	if err := registry.SetActive(3); !errors.Is(err, ErrNotConnected) {
		t.Fatalf("err = %v; want ErrNotConnected", err)
	}
}

// The collector reads HasActive to decide whether to sample; it must go false
// the moment the user closes the connection, or sampling would redial one they
// deliberately shut.
func TestClosingTheActiveConnectionClearsIt(t *testing.T) {
	conn := &fakeConn{kind: model.KindRocketMQ}
	registerForTest(t, &fakeDriver{kind: model.KindRocketMQ, conn: conn})
	registry := NewRegistry()
	if err := registry.Open(context.Background(), model.ConnectionProfile{ID: 4, Kind: model.KindRocketMQ}); err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := registry.SetActive(4); err != nil {
		t.Fatalf("set active: %v", err)
	}

	registry.Close(4)

	if registry.HasActive() {
		t.Error("registry still reports an active connection")
	}
	if registry.ActiveID() != 0 {
		t.Errorf("ActiveID = %d; want 0", registry.ActiveID())
	}
	if conn.closeCount() != 1 {
		t.Errorf("connection closed %d times; want 1", conn.closeCount())
	}
}

func TestConformanceAcceptsAMatchingConnection(t *testing.T) {
	conn := &destinationConn{fakeConn{
		kind:         model.KindRocketMQ,
		capabilities: model.NewCapabilities(model.CapDestinationList),
	}}

	if problems := CheckConformance(conn); len(problems) != 0 {
		t.Errorf("CheckConformance = %v; want none", problems)
	}
}

// The failure this guards against is a control the UI renders and the driver
// cannot service.
func TestConformanceCatchesADeclaredButUnimplementedCapability(t *testing.T) {
	conn := &fakeConn{
		kind:         model.KindRabbitMQ,
		capabilities: model.NewCapabilities(model.CapDestinationList),
	}

	problems := CheckConformance(conn)

	if len(problems) != 1 || !strings.Contains(problems[0].Error(), "DestinationAdmin") {
		t.Fatalf("CheckConformance = %v; want one DestinationAdmin problem", problems)
	}
}

// The mirror failure: work the driver can do that the UI never offers.
func TestConformanceCatchesAnUndeclaredImplementation(t *testing.T) {
	conn := &destinationConn{fakeConn{
		kind:         model.KindKafka,
		capabilities: model.NewCapabilities(),
	}}

	problems := CheckConformance(conn)

	if len(problems) != 1 || !strings.Contains(problems[0].Error(), "declares none") {
		t.Fatalf("CheckConformance = %v; want one undeclared-implementation problem", problems)
	}
}

func TestConformanceCatchesSupportedAndDegradedAtOnce(t *testing.T) {
	conn := &destinationConn{fakeConn{
		kind: model.KindRocketMQ,
		capabilities: model.Capabilities{
			Supported: []model.Capability{model.CapDestinationList},
			Degraded:  map[model.Capability]string{model.CapDestinationList: "proxy endpoint"},
		},
	}}

	problems := CheckConformance(conn)

	if len(problems) != 1 || !strings.Contains(problems[0].Error(), "both supported and degraded") {
		t.Fatalf("CheckConformance = %v; want one contradiction problem", problems)
	}
}

func TestUnsupportedCarriesTheDegradedReason(t *testing.T) {
	conn := &fakeConn{
		kind: model.KindRocketMQ,
		capabilities: model.NewCapabilities().
			WithDegraded(model.CapDestinationList, "proxy endpoint is a data plane only"),
	}

	err := Unsupported(conn, model.CapDestinationList)

	var unsupported *UnsupportedError
	if !errors.As(err, &unsupported) {
		t.Fatalf("err = %T; want *UnsupportedError", err)
	}
	if unsupported.Reason != "proxy endpoint is a data plane only" {
		t.Errorf("Reason = %q; want the driver's explanation", unsupported.Reason)
	}
}
