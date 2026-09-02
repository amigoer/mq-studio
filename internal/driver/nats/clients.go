package nats

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/amigoer/mq-studio/internal/model"
)

// Attribute keys a connection carries beyond the canonical fields.
const (
	AttrCID          = "cid"
	AttrLanguage     = "language"
	AttrLibVersion   = "libVersion"
	AttrIdleTime     = "idle"
	AttrLastActivity = "lastActivity"
	AttrPendingBytes = "pendingBytes"
	AttrInMsgs       = "inMsgs"
	AttrOutMsgs      = "outMsgs"
	AttrRTT          = "rtt"
	AttrSubjectList  = "subjectList"
	AttrAccount      = "account"
	AttrKind         = "kind"
)

// maxConnections bounds one listing. The endpoint pages, and a server with
// more connections than this is one where a list was never the useful view.
const maxConnections = 1024

// ListClientConnections enumerates the sockets open against the cluster.
//
// Through the system account where there is one, for the same reason the
// server listing is: /connz answers for the one server it belongs to, and a
// client connected to any other server in the cluster simply does not appear.
// On a three-server cluster that is two thirds of the connections missing,
// with nothing on the page to say so.
//
// The namespace argument is the account to narrow to. Empty means every
// account the credentials can see, which for the monitoring endpoint is all of
// them and for the system account is likewise.
func (c *Conn) ListClientConnections(ctx context.Context, namespace string) ([]*model.ClientConnection, error) {
	if err := c.requireClusterSource(); err != nil {
		return nil, err
	}

	query := url.Values{
		// Subscriptions are the useful part of a connection here: NATS has no
		// consumer object outside JetStream, so what a client is subscribed to
		// is the only answer to "what is this connection doing".
		"subs":  {"true"},
		"limit": {strconv.Itoa(maxConnections)},
	}
	if account := strings.TrimSpace(namespace); account != "" {
		query.Set("acc", account)
	}

	if c.system != nil {
		replies, err := c.system.pingWithBody(ctx, endpointConnz, connzRequest(namespace), 0)
		if err == nil && len(replies) > 0 {
			return connectionsFromReplies(replies)
		}
		if c.monitor == nil {
			return nil, err
		}
	}

	var response connzResponse
	if err := c.monitor.get(ctx, pathConnz, query, &response); err != nil {
		return nil, err
	}
	return connectionsOf(response.Server.Name, SourceMonitor, response.Connections), nil
}

// ListClientChannels is empty, and that is a fact rather than a gap.
//
// A NATS connection has no second layer inside it. AMQP multiplexes channels
// over one socket and RabbitMQ's pages are built around that; here a
// connection is one client, and its subscriptions are not channels - they have
// no state, no flow control and no independent lifetime.
func (c *Conn) ListClientChannels(ctx context.Context, namespace string) ([]*model.ClientChannel, error) {
	return []*model.ClientChannel{}, nil
}

// CloseClientConnection disconnects one client.
//
// The system account only. There is no way to close a connection through the
// monitoring endpoint - it is read-only by design - so an endpoint with only
// that reports the capability as degraded rather than offering a button that
// cannot work.
func (c *Conn) CloseClientConnection(ctx context.Context, name, reason string) error {
	if c.system == nil {
		return &driverUnsupported{reason: c.systemReasonOr()}
	}
	serverName, cid, err := splitConnectionKey(name)
	if err != nil {
		return err
	}
	return c.system.kick(ctx, serverName, cid)
}

// CloseUserConnections closes every connection one identity holds.
//
// NATS has no request for this: KICK takes a client id on a named server, and
// there is no "disconnect this user" call anywhere in $SYS. So this lists,
// filters and kicks each - which is what an operator would do by hand, and is
// worth doing here because an application with several instances is otherwise
// evicted one row at a time.
func (c *Conn) CloseUserConnections(ctx context.Context, username, reason string) error {
	if c.system == nil {
		return &driverUnsupported{reason: c.systemReasonOr()}
	}
	connections, err := c.ListClientConnections(ctx, "")
	if err != nil {
		return err
	}

	var closed int
	for _, connection := range connections {
		if connection.User != username {
			continue
		}
		serverName, cid, err := splitConnectionKey(connection.Name)
		if err != nil {
			continue
		}
		if err := c.system.kick(ctx, serverName, cid); err != nil {
			return err
		}
		closed++
	}
	if closed == 0 {
		return fmt.Errorf("no connection is open as %q", username)
	}
	return nil
}

func (c *Conn) systemReasonOr() string {
	if c.tiers.systemReason != "" {
		return c.tiers.systemReason
	}
	return systemAbsent
}

/*
 * A connection is addressed by the server holding it and its client id.
 *
 * Neither half is enough on its own: a client id counts within one server, so
 * two servers in a cluster will each have a client 7. The canonical model has
 * one Name field and it is what a close request names, so the two are joined -
 * and split again on the way back out.
 */
func connectionKey(server string, cid uint64) string {
	return fmt.Sprintf("%s/%d", server, cid)
}

func splitConnectionKey(name string) (string, uint64, error) {
	server, raw, found := strings.Cut(name, "/")
	if !found {
		return "", 0, fmt.Errorf(
			"%q does not name a connection; a NATS connection is a server and a client id", name)
	}
	cid, err := strconv.ParseUint(raw, 10, 64)
	if err != nil {
		return "", 0, fmt.Errorf("%q does not end in a client id", name)
	}
	return server, cid, nil
}

// connzResponse is the subset of /connz this driver reads.
type connzResponse struct {
	Server struct {
		Name string `json:"server_name"`
		ID   string `json:"server_id"`
	} `json:"server"`
	Now         string            `json:"now"`
	Total       int               `json:"total"`
	Connections []connzConnection `json:"connections"`
}

type connzConnection struct {
	CID        uint64   `json:"cid"`
	Kind       string   `json:"kind"`
	Type       string   `json:"type"`
	IP         string   `json:"ip"`
	Port       int      `json:"port"`
	Start      string   `json:"start"`
	LastActive string   `json:"last_activity"`
	RTT        string   `json:"rtt"`
	Uptime     string   `json:"uptime"`
	Idle       string   `json:"idle"`
	Pending    int      `json:"pending_bytes"`
	InMsgs     int64    `json:"in_msgs"`
	OutMsgs    int64    `json:"out_msgs"`
	InBytes    int64    `json:"in_bytes"`
	OutBytes   int64    `json:"out_bytes"`
	NumSubs    uint32   `json:"subscriptions"`
	Name       string   `json:"name"`
	Lang       string   `json:"lang"`
	Version    string   `json:"version"`
	TLSVersion string   `json:"tls_version"`
	TLSCipher  string   `json:"tls_cipher_suite"`
	Account    string   `json:"account"`
	User       string   `json:"authorized_user"`
	SubsList   []string `json:"subscriptions_list"`
}

// connzRequest is the body a $SYS CONNZ request takes.
//
// The field is "subscriptions" here and "subs" on the monitoring endpoint's
// query string. They are the same option, and the two spellings are the
// server's rather than a choice made here - sending the query string's name in
// the body is accepted and silently ignored, which is how this was first
// written and why the subject column came back empty.
func connzRequest(namespace string) any {
	request := map[string]any{
		"subscriptions": true,
		"limit":         maxConnections,
	}
	if account := strings.TrimSpace(namespace); account != "" {
		request["acc"] = account
	}
	return request
}

func connectionsFromReplies(replies []systemReply) ([]*model.ClientConnection, error) {
	connections := make([]*model.ClientConnection, 0, 16)
	for _, reply := range replies {
		var response connzResponse
		if err := json.Unmarshal(reply.Data, &response); err != nil {
			return nil, fmt.Errorf("$SYS CONNZ answered something unexpected: %w", err)
		}
		server := response.Server.Name
		if server == "" {
			server = reply.Server.Name
		}
		connections = append(connections, connectionsOf(server, SourceSystem, response.Connections)...)
	}
	sort.Slice(connections, func(i, j int) bool { return connections[i].Name < connections[j].Name })
	return connections, nil
}

func connectionsOf(server, source string, raw []connzConnection) []*model.ClientConnection {
	connections := make([]*model.ClientConnection, 0, len(raw))
	for _, item := range raw {
		connections = append(connections, connectionOf(server, source, item))
	}
	return connections
}

// connectionOf maps one connection onto the canonical model.
//
// The source travels with the row rather than being inferred once for the
// page, because it decides what can be done to that particular connection:
// a row read through the monitoring endpoint cannot be closed at all - that
// endpoint is read-only by design - and a button that was always going to be
// refused is worse than one that is not there.
func connectionOf(server, source string, raw connzConnection) *model.ClientConnection {
	connection := &model.ClientConnection{
		Name:       connectionKey(server, raw.CID),
		ClientName: raw.Name,
		Namespace:  raw.Account,
		User:       raw.User,
		Node:       server,
		PeerHost:   raw.IP,
		PeerPort:   raw.Port,
		// The transport, which on a NATS server can be any of four: a client
		// may arrive over TCP, TLS, WebSocket or MQTT, and treating them alike
		// would misreport all of them.
		Protocol: connectionProtocol(raw),
		State:    "running",
		// A NATS connection has no second layer inside it, so this is not a
		// count that happens to be zero - there is nothing to count.
		Channels:  model.UnknownMetric,
		TLS:       raw.TLSVersion != "",
		Cipher:    raw.TLSCipher,
		RecvBytes: raw.InBytes,
		SendBytes: raw.OutBytes,
		// NATS reports totals rather than rates. A per-second figure would be
		// two samples divided by the time between them.
		RecvByteRate: -1,
		SendByteRate: -1,
		// Heartbeats are the server's ping interval rather than something the
		// two sides negotiate, and /connz does not report it per connection.
		HeartbeatSec: model.UnknownMetric,
		Attributes:   map[string]string{},
	}

	if started, err := time.Parse(time.RFC3339Nano, raw.Start); err == nil {
		connection.ConnectedAtMs = started.UnixMilli()
	}

	set := func(key, value string) {
		if value != "" {
			connection.Attributes[key] = value
		}
	}
	set(AttrSource, source)
	set(AttrCID, strconv.FormatUint(raw.CID, 10))
	set(AttrKind, raw.Kind)
	set(AttrLanguage, raw.Lang)
	set(AttrLibVersion, raw.Version)
	set(AttrIdleTime, raw.Idle)
	set(AttrLastActivity, raw.LastActive)
	set(AttrRTT, raw.RTT)
	set(AttrPendingBytes, strconv.Itoa(raw.Pending))
	set(AttrInMsgs, strconv.FormatInt(raw.InMsgs, 10))
	set(AttrOutMsgs, strconv.FormatInt(raw.OutMsgs, 10))
	set(AttrAccount, raw.Account)
	// What the connection is subscribed to, which is the only answer NATS has
	// to "what is this client doing": there is no consumer object outside
	// JetStream to look it up in.
	set(AttrSubjectList, strings.Join(raw.SubsList, ", "))
	return connection
}

// connectionProtocol names the transport a client arrived over.
func connectionProtocol(raw connzConnection) string {
	switch {
	case raw.Type != "":
		return raw.Type
	case raw.TLSVersion != "":
		return "tls"
	default:
		return "nats"
	}
}
