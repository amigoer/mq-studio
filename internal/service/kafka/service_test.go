package kafka

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

// fakeConn implements only what a test asks it to. The service decides what it
// can do by asserting on interfaces, so a connection that cannot do something
// has to be a real Go type that does not implement it.
type fakeConn struct {
	capabilities model.Capabilities
}

func (c *fakeConn) Kind() model.MQKind               { return model.KindKafka }
func (c *fakeConn) Ping(context.Context) error       { return nil }
func (c *fakeConn) Capabilities() model.Capabilities { return c.capabilities }
func (c *fakeConn) Close() error                     { return nil }

// txnConn reports transactions and records the context it was handed.
type txnConn struct {
	fakeConn
	gotDeadline bool
	err         error
}

func (c *txnConn) ListTransactions(ctx context.Context) ([]*model.Transaction, error) {
	_, c.gotDeadline = ctx.Deadline()
	if c.err != nil {
		return nil, c.err
	}
	return []*model.Transaction{{ID: "orders-writer", State: "Ongoing", Holding: true}}, nil
}

// logDirConn is the second read used here, to show the not-connected rule is
// the service's and not one method's.
type logDirConn struct{ fakeConn }

func (c *logDirConn) LogDirs(context.Context) ([]*model.LogDirSummary, error) {
	return []*model.LogDirSummary{{Broker: 1, Path: "/var/lib/kafka"}}, nil
}

func (c *logDirConn) LogDirPartitions(context.Context, int) ([]*model.LogDirPartition, error) {
	return []*model.LogDirPartition{}, nil
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

/*
 * Nothing dialled is not a failure.
 *
 * Every board draws its own not-connected state, and these reads return an
 * empty slice with no error so that a page shows that state rather than an
 * error banner repeating it.
 */
func TestReadsAreEmptyWhenNothingIsConnected(t *testing.T) {
	service := serviceWith(nil)
	ctx := context.Background()

	transactions, err := service.Transactions(ctx, 1)
	if err != nil {
		t.Fatalf("Transactions: %v", err)
	}
	// Empty, not nil: a nil slice crosses the bridge as JSON null and the
	// board then has to guard on it.
	if transactions == nil || len(transactions) != 0 {
		t.Errorf("transactions = %v, want an empty slice", transactions)
	}

	dirs, err := service.LogDirs(ctx, 1)
	if err != nil {
		t.Fatalf("LogDirs: %v", err)
	}
	if dirs == nil || len(dirs) != 0 {
		t.Errorf("dirs = %v, want an empty slice", dirs)
	}

	quotas, err := service.Quotas(ctx, 1)
	if err != nil {
		t.Fatalf("Quotas: %v", err)
	}
	if quotas == nil || len(quotas) != 0 {
		t.Errorf("quotas = %v, want an empty slice", quotas)
	}
}

// A write, by contrast, must fail loudly: silently doing nothing while a
// dialog reports success is the worst answer available.
func TestWritesRefuseWhenNothingIsConnected(t *testing.T) {
	err := serviceWith(nil).DeleteTopic(context.Background(), 1, "orders")
	if !errors.Is(err, driver.ErrNotConnected) {
		t.Fatalf("err = %v, want ErrNotConnected", err)
	}
}

// The capability is checked before the type assertion, so what comes back
// names the capability rather than a Go type the user has never heard of.
func TestTransactionsRefusesAConnectionThatDoesNotDeclareIt(t *testing.T) {
	conn := &txnConn{fakeConn: fakeConn{capabilities: supporting(model.CapDestinationList)}}

	if _, err := serviceWith(conn).Transactions(context.Background(), 1); err != nil {
		var unsupported *driver.UnsupportedError
		if !errors.As(err, &unsupported) {
			t.Fatalf("err = %v, want an UnsupportedError", err)
		}
		if unsupported.Capability != model.CapTransactions {
			t.Errorf("capability = %q, want %q", unsupported.Capability, model.CapTransactions)
		}
		return
	}
	t.Fatal("a connection that does not declare transactions was allowed to list them")
}

// The opposite mistake: declared but not implemented. The driver's conformance
// test should catch it, but the service must not panic on it either.
func TestTransactionsRefusesAConnectionThatDeclaresItWithoutImplementingIt(t *testing.T) {
	conn := &fakeConn{capabilities: supporting(model.CapTransactions)}

	_, err := serviceWith(conn).Transactions(context.Background(), 1)
	var unsupported *driver.UnsupportedError
	if !errors.As(err, &unsupported) {
		t.Fatalf("err = %v, want an UnsupportedError", err)
	}
}

// Drivers are told the context already carries the deadline. Nothing checks
// that from the driver side, so it is checked here.
func TestTransactionsInjectsTheRequestDeadline(t *testing.T) {
	conn := &txnConn{fakeConn: fakeConn{capabilities: supporting(model.CapTransactions)}}

	transactions, err := serviceWith(conn).Transactions(context.Background(), 1)
	if err != nil {
		t.Fatalf("Transactions: %v", err)
	}
	if !conn.gotDeadline {
		t.Error("the driver was called with a context carrying no deadline")
	}
	if len(transactions) != 1 || !transactions[0].Holding {
		t.Errorf("transactions = %+v", transactions)
	}
}

// A cluster that answers with an error is not the same as one with nothing to
// report, and the empty-when-not-connected rule must not swallow it.
func TestATransactionListingThatFailedIsReported(t *testing.T) {
	failure := errors.New("coordinator not available")
	conn := &txnConn{
		fakeConn: fakeConn{capabilities: supporting(model.CapTransactions)},
		err:      failure,
	}

	if _, err := serviceWith(conn).Transactions(context.Background(), 1); !errors.Is(err, failure) {
		t.Fatalf("err = %v, want the driver's", err)
	}
}

// The connected path, to show the empty answers above come from the gate and
// not from the service always returning nothing.
func TestLogDirsPassThroughWhatTheDriverReports(t *testing.T) {
	conn := &logDirConn{fakeConn{capabilities: supporting(model.CapLogDirs)}}

	dirs, err := serviceWith(conn).LogDirs(context.Background(), 1)
	if err != nil {
		t.Fatalf("LogDirs: %v", err)
	}
	if len(dirs) != 1 || dirs[0].Path != "/var/lib/kafka" {
		t.Errorf("dirs = %+v", dirs)
	}
}
