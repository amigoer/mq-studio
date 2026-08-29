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
// Id zero means "whichever connection is active", which is correct for exactly
// one caller - the background collector, which samples on its own timer with
// no page to name a connection.
func newConnSource(registry *driver.Registry) func(int) (driver.Conn, error) {
	return func(connID int) (driver.Conn, error) {
		if connID == 0 {
			if conn, ok := registry.Active(); ok {
				return conn, nil
			}
			return nil, driver.ErrNotConnected
		}
		conn, ok := registry.Get(connID)
		if !ok {
			return nil, fmt.Errorf("%w: %d", driver.ErrNotConnected, connID)
		}
		return conn, nil
	}
}
