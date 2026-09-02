package redisstream

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/amigoer/mq-studio/internal/model"
)

// Connection attribute keys. A contract with frontend/src/mq/redis/clients.ts.
const (
	AttrLastCommand  = "lastCommand"
	AttrIdleSeconds  = "idleSeconds"
	AttrAgeSeconds   = "ageSeconds"
	AttrFlags        = "flags"
	AttrLibraryName  = "libraryName"
	AttrSubscribed   = "subscriptions"
	AttrTotalCommand = "totalCommands"
	AttrClientID     = "clientId"
)

/*
 * ListClientConnections reads CLIENT LIST.
 *
 * The namespace argument is ignored: it is RabbitMQ's virtual host, and a
 * Redis connection's database is a property of the connection rather than a
 * scope the listing can be narrowed to. It travels as the namespace on each
 * row instead, which is what it is.
 */
func (c *Conn) ListClientConnections(ctx context.Context, _ string) ([]*model.ClientConnection, error) {
	raw, err := c.client.ClientList(ctx).Result()
	if err != nil {
		return nil, fmt.Errorf("list the client connections: %w", err)
	}

	now := time.Now().UnixMilli()
	connections := parseClientList(raw, now)
	sort.Slice(connections, func(left, right int) bool {
		return connections[left].Name < connections[right].Name
	})
	return connections, nil
}

// ListClientChannels is empty, and that is the family rather than a gap.
//
// A channel is a session multiplexed inside a connection, which AMQP has and
// Redis does not: one Redis connection runs one command at a time and has
// nothing inside it to enumerate. Returning nothing rather than not
// implementing the interface is what lets the page say "there are none" - the
// port is one interface, and the connections half is real.
func (c *Conn) ListClientChannels(context.Context, string) ([]*model.ClientChannel, error) {
	return nil, nil
}

/*
 * CloseClientConnection disconnects one client.
 *
 * It takes the connection's id rather than its address. Redis will kill by
 * either, but an address is reused the moment the port is: a client that
 * reconnected between the page being drawn and the button being pressed would
 * be killed in place of the one the operator meant. The id never repeats.
 *
 * The reason is not sent. Redis has nowhere to put one - unlike AMQP, which
 * carries it in the close frame - so it is dropped here rather than pretended
 * about.
 */
func (c *Conn) CloseClientConnection(ctx context.Context, name, _ string) error {
	id, err := strconv.ParseInt(strings.TrimSpace(name), 10, 64)
	if err != nil {
		return fmt.Errorf("%q is not a client id", name)
	}
	killed, err := c.client.ClientKillByFilter(ctx, "ID", strconv.FormatInt(id, 10)).Result()
	if err != nil {
		return fmt.Errorf("close client %d: %w", id, err)
	}
	if killed == 0 {
		// Killing an id that has already gone succeeds and closes nothing.
		// Reporting that as done would have the row disappear from a page
		// while the connection it named was closed by somebody else.
		return fmt.Errorf("client %d is no longer connected", id)
	}
	return nil
}

// CloseUserConnections disconnects every connection one identity holds, which
// is how an application with several instances is actually evicted.
func (c *Conn) CloseUserConnections(ctx context.Context, username, _ string) error {
	user := strings.TrimSpace(username)
	if user == "" {
		return fmt.Errorf("closing a user's connections needs the user")
	}
	killed, err := c.client.ClientKillByFilter(ctx, "USER", user).Result()
	if err != nil {
		return fmt.Errorf("close the connections of %q: %w", user, err)
	}
	if killed == 0 {
		return fmt.Errorf("%q holds no connections", user)
	}
	return nil
}

/*
 * parseClientList reads the CLIENT LIST reply.
 *
 * One line per connection, each a space-separated list of key=value pairs.
 * What Redis reports has grown steadily - lib-name and lib-ver arrived in 7.2,
 * tot-net-in and tot-net-out in 7.0 - so unknown keys are kept and missing
 * ones are simply absent rather than a reason to skip the row.
 *
 * now is passed in rather than read here so the derived connect time can be
 * tested: age is seconds since the connection opened, and the model carries an
 * absolute timestamp.
 */
func parseClientList(raw string, nowMillis int64) []*model.ClientConnection {
	lines := strings.Split(raw, "\n")
	connections := make([]*model.ClientConnection, 0, len(lines))

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		fields := map[string]string{}
		for _, pair := range strings.Fields(line) {
			key, value, found := strings.Cut(pair, "=")
			if found {
				fields[key] = value
			}
		}
		id := fields["id"]
		if id == "" {
			continue
		}

		host, port := splitAddr(fields["addr"])
		connection := &model.ClientConnection{
			// The id, because it is what a close names and an address is
			// reused the moment a port is.
			Name:       id,
			ClientName: fields["name"],
			Namespace:  fields["db"],
			User:       fields["user"],
			Node:       fields["laddr"],
			PeerHost:   host,
			PeerPort:   port,
			Protocol:   respVersion(fields["resp"]),
			State:      fields["flags"],
			Attributes: map[string]string{AttrClientID: id},
		}
		if value, err := strconv.ParseInt(fields["tot-net-in"], 10, 64); err == nil {
			connection.RecvBytes = value
		}
		if value, err := strconv.ParseInt(fields["tot-net-out"], 10, 64); err == nil {
			connection.SendBytes = value
		}
		if age, err := strconv.ParseInt(fields["age"], 10, 64); err == nil {
			connection.ConnectedAtMs = nowMillis - age*1000
			connection.Attributes[AttrAgeSeconds] = fields["age"]
		}

		for attribute, key := range map[string]string{
			AttrLastCommand:  "cmd",
			AttrIdleSeconds:  "idle",
			AttrFlags:        "flags",
			AttrLibraryName:  "lib-name",
			AttrTotalCommand: "tot-cmds",
		} {
			if value := fields[key]; value != "" {
				connection.Attributes[attribute] = value
			}
		}
		// Channel and pattern subscriptions together, because the question a
		// reader has is whether this connection is a subscriber at all.
		if subscribed := countOf(fields["sub"]) + countOf(fields["psub"]) + countOf(fields["ssub"]); subscribed > 0 {
			connection.Attributes[AttrSubscribed] = strconv.Itoa(subscribed)
		}

		connections = append(connections, connection)
	}
	return connections
}

// splitAddr separates the peer's host and port. An IPv6 address carries colons
// of its own, so the split is on the last one.
func splitAddr(addr string) (string, int) {
	if addr == "" {
		return "", 0
	}
	index := strings.LastIndex(addr, ":")
	if index < 0 {
		return addr, 0
	}
	port, err := strconv.Atoi(addr[index+1:])
	if err != nil {
		return addr, 0
	}
	return addr[:index], port
}

// respVersion names the wire protocol. A connection speaking RESP3 gets typed
// replies and push messages the other does not, which is worth seeing when a
// client is behaving unlike its neighbours.
func respVersion(value string) string {
	switch value {
	case "":
		return ""
	case "3":
		return "RESP3"
	case "2":
		return "RESP2"
	default:
		return "RESP" + value
	}
}

func countOf(value string) int {
	count, err := strconv.Atoi(value)
	if err != nil || count < 0 {
		return 0
	}
	return count
}
