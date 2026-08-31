package rabbitmq

import (
	"context"
	"fmt"
	"net/url"
	"strings"
)

// defaultCloseReason is what the client is told when nobody said why.
const defaultCloseReason = "Closed from mq-studio"

// CloseClientConnection disconnects one connection.
//
// The reason travels to the client being disconnected and into the broker's
// log, which is the difference between an application finding "connection
// forced" in its logs and finding out who closed it and why. rabbit-hole's own
// close sends no headers, so this one is written by hand.
//
// Channels cannot be closed on their own: RabbitMQ has no endpoint for it, and
// the closest thing is closing the connection they belong to. The page says so
// rather than offering a button that would have to close more than it named.
func (c *Conn) CloseClientConnection(ctx context.Context, name, reason string) error {
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("closing a connection needs its name")
	}
	if strings.TrimSpace(reason) == "" {
		reason = defaultCloseReason
	}
	path := "/api/connections/" + url.PathEscape(name)
	if err := c.mgmt.deleteWith(ctx, path, map[string]string{"X-Reason": reason}); err != nil {
		return fmt.Errorf("close connection %q: %w", name, err)
	}
	return nil
}

// CloseUserConnections disconnects every connection one user holds.
//
// It exists because that is how an application is actually evicted: one
// deployment opens a connection per instance, and closing them one at a time
// races the ones reconnecting behind it.
func (c *Conn) CloseUserConnections(ctx context.Context, username, reason string) error {
	if strings.TrimSpace(username) == "" {
		return fmt.Errorf("closing connections needs a username")
	}
	if strings.TrimSpace(reason) == "" {
		reason = defaultCloseReason
	}
	path := "/api/connections/username/" + url.PathEscape(username)
	if err := c.mgmt.deleteWith(ctx, path, map[string]string{"X-Reason": reason}); err != nil {
		return fmt.Errorf("close connections of %q: %w", username, err)
	}
	return nil
}
