package redisstream

import (
	"context"
	"testing"
)

// A real CLIENT LIST reply. What Redis reports has grown steadily - tot-net-in
// arrived in 7.0, lib-name in 7.2 - so the parser keeps what it does not know
// and tolerates what is not there.
const liveClientList = "id=42 addr=10.2.0.44:51234 laddr=10.2.0.8:6379 fd=9 name=reporting-service " +
	"age=8402 idle=3 flags=N db=0 sub=0 psub=0 ssub=0 multi=-1 watch=0 qbuf=26 qbuf-free=20448 " +
	"argv-mem=10 multi-mem=0 tot-net-in=91204 tot-net-out=884210 rbs=1024 rbp=0 obl=0 oll=0 omem=0 " +
	"tot-mem=22298 events=r cmd=xrange user=mqstudio redir=-1 resp=3 lib-name=go-redis lib-ver=9.22.0 tot-cmds=1204\n" +
	"id=43 addr=[2001:db8::1]:51999 laddr=10.2.0.8:6379 fd=10 name= age=12 idle=0 flags=N db=3 " +
	"sub=2 psub=1 ssub=0 cmd=subscribe user=default resp=2\n"

func TestParseClientList(t *testing.T) {
	const now = int64(1756454646018)
	connections := parseClientList(liveClientList, now)
	if len(connections) != 2 {
		t.Fatalf("read %d connections, want 2", len(connections))
	}

	first := connections[0]
	// The id, not the address: Redis kills by either, and an address is reused
	// the moment its port is - so a client that reconnected between the page
	// being drawn and the button being pressed would be killed in place of the
	// one the operator meant.
	if first.Name != "42" {
		t.Errorf("name = %q, want the client id", first.Name)
	}
	if first.ClientName != "reporting-service" {
		t.Errorf("client name = %q", first.ClientName)
	}
	if first.PeerHost != "10.2.0.44" || first.PeerPort != 51234 {
		t.Errorf("peer = %q:%d", first.PeerHost, first.PeerPort)
	}
	if first.User != "mqstudio" {
		t.Errorf("user = %q", first.User)
	}
	if first.Namespace != "0" {
		t.Errorf("database = %q", first.Namespace)
	}
	// A RESP3 connection gets typed replies and push messages a RESP2 one does
	// not, which is worth seeing when a client behaves unlike its neighbours.
	if first.Protocol != "RESP3" {
		t.Errorf("protocol = %q", first.Protocol)
	}
	if first.RecvBytes != 91204 || first.SendBytes != 884210 {
		t.Errorf("bytes = %d/%d", first.RecvBytes, first.SendBytes)
	}
	// age is seconds since the connection opened; the model carries an
	// absolute timestamp, which is why now is passed in.
	if first.ConnectedAtMs != now-8402*1000 {
		t.Errorf("connected at = %d", first.ConnectedAtMs)
	}
	for key, want := range map[string]string{
		AttrClientID:     "42",
		AttrLastCommand:  "xrange",
		AttrIdleSeconds:  "3",
		AttrLibraryName:  "go-redis",
		AttrTotalCommand: "1204",
	} {
		if first.Attributes[key] != want {
			t.Errorf("attribute %s = %q, want %q", key, first.Attributes[key], want)
		}
	}
	// Nothing subscribed, so the attribute is absent rather than "0".
	if _, present := first.Attributes[AttrSubscribed]; present {
		t.Errorf("a connection subscribed to nothing carries a subscription count")
	}
}

// An IPv6 peer carries colons of its own, so the port is after the last one.
// Splitting on the first would report the address as "[2001" on a port that
// does not parse.
func TestParseClientListIPv6Peer(t *testing.T) {
	connections := parseClientList(liveClientList, 0)
	second := connections[1]
	if second.PeerHost != "[2001:db8::1]" || second.PeerPort != 51999 {
		t.Errorf("peer = %q:%d", second.PeerHost, second.PeerPort)
	}
	// Channel and pattern subscriptions together: the question a reader has is
	// whether this connection is a subscriber at all.
	if second.Attributes[AttrSubscribed] != "3" {
		t.Errorf("subscriptions = %q, want 3", second.Attributes[AttrSubscribed])
	}
	// An unnamed client is the common case - most libraries never call CLIENT
	// SETNAME - and the peer address stays the identifier.
	if second.ClientName != "" {
		t.Errorf("client name = %q, want empty", second.ClientName)
	}
	// Fields an older server does not send are absent, not zero.
	if _, present := second.Attributes[AttrTotalCommand]; present {
		t.Error("a field the server did not send was reported")
	}
	if second.RecvBytes != 0 {
		t.Errorf("recv = %d on a reply with no tot-net-in", second.RecvBytes)
	}
}

func TestParseClientListSkipsUnusableLines(t *testing.T) {
	// A line with no id names nothing a close request could act on, so it is
	// not a row.
	connections := parseClientList("addr=10.2.0.44:51234 name=x\n\n   \nnot a client line\n", 0)
	if len(connections) != 0 {
		t.Errorf("read %d connections from an unusable reply", len(connections))
	}
}

// Redis has no channels: one connection runs one command at a time and has
// nothing inside it to enumerate. Answering with none rather than not
// implementing the port is what lets the page say so.
func TestListClientChannelsIsEmpty(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	channels, err := conn.ListClientChannels(context.Background(), "")
	if err != nil {
		t.Fatalf("list channels: %v", err)
	}
	if len(channels) != 0 {
		t.Errorf("listed %d channels; redis has no such concept", len(channels))
	}
}

func TestCloseClientConnectionValidatesTheID(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	ctx := context.Background()
	// An address is not an id, and killing by one would be killing whatever
	// holds that port now.
	for _, name := range []string{"", "10.2.0.44:51234", "abc"} {
		if err := conn.CloseClientConnection(ctx, name, ""); err == nil {
			t.Errorf("closing %q succeeded", name)
		}
	}
}

func TestCloseUserConnectionsNeedsAUser(t *testing.T) {
	conn := fakeConn(t, fakeServer(t), nil, nil)
	if err := conn.CloseUserConnections(context.Background(), "  ", ""); err == nil {
		t.Fatal("closing the connections of no user succeeded")
	}
}
