package app

import (
	"fmt"

	"github.com/amigoer/mq-studio/internal/driver"
)

// newConnSource resolves a profile id to a live connection.
//
// The contract is by id, and it is now honoured: the registry holds one
// connection per open profile, so two tabs pointed at two clusters read their
// own. It used to hand every caller the one process-wide default client, which
// meant the id argument every bridge method takes decided nothing.
//
// Id zero used to mean "whichever connection is active", for the collector's
// benefit. The collector resolves the active id itself now - it has to, so the
// TPS history it records is filed under the connection the pages read it back
// by - and nothing else ever wanted it. An unresolvable id is an error rather
// than a silent fallback: with several connections open, answering the wrong
// one is worse than answering nothing.
func newConnSource(registry *driver.Registry) func(int) (driver.Conn, error) {
	return func(connID int) (driver.Conn, error) {
		conn, ok := registry.Get(connID)
		if !ok {
			return nil, fmt.Errorf("%w: %d", driver.ErrNotConnected, connID)
		}
		return conn, nil
	}
}
