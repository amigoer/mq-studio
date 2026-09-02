package nats

import (
	"strings"
	"testing"
	"time"

	natsclient "github.com/nats-io/nats.go"

	"github.com/amigoer/mq-studio/internal/model"
)

// spare opens a second client against the same fixture, so there is somebody
// to list and somebody to disconnect.
func spare(t *testing.T, fake *fakeServer, name string) *natsclient.Conn {
	t.Helper()
	nc, err := natsclient.Connect(fake.clientURL,
		natsclient.UserInfo(fakeUser, fakePassword),
		natsclient.Name(name),
	)
	if err != nil {
		t.Fatalf("connect %s: %v", name, err)
	}
	t.Cleanup(nc.Close)
	return nc
}

func TestConnectionsAreListedWithWhatTheyAreDoing(t *testing.T) {
	fake := startServer(t, serverOptions{
		jetStream: true, jetStreamAccount: true, monitor: true, systemAccount: true,
	})
	conn := open(t, fake, true, true)

	other := spare(t, fake, "an-application")
	if _, err := other.Subscribe("orders.>", func(*natsclient.Msg) {}); err != nil {
		t.Fatalf("Subscribe: %v", err)
	}
	if err := other.Flush(); err != nil {
		t.Fatalf("Flush: %v", err)
	}

	connections, err := conn.ListClientConnections(testContext(t), "")
	if err != nil {
		t.Fatalf("ListClientConnections: %v", err)
	}
	if len(connections) < 2 {
		t.Fatalf("listed %d connections, want at least this app and the other client", len(connections))
	}

	var found *model.ClientConnection
	for _, connection := range connections {
		if connection.ClientName == "an-application" {
			found = connection
		}
	}
	if found == nil {
		t.Fatal("the other client is not in the listing")
	}
	// The subjects are the only answer NATS has to "what is this client
	// doing": there is no consumer object outside JetStream to look it up in.
	if !strings.Contains(found.Attributes[AttrSubjectList], "orders.>") {
		t.Errorf("subjects = %q, want the subscription", found.Attributes[AttrSubjectList])
	}
	// A NATS connection has no second layer inside it, so this is not a count
	// that happens to be zero.
	if found.Channels != model.UnknownMetric {
		t.Errorf("channels = %d, want UnknownMetric - a NATS connection has none", found.Channels)
	}
}

/*
 * A connection is addressed by the server holding it and its client id.
 * Neither half is enough: a client id counts within one server, so two servers
 * in a cluster will each have a client 7 - and a key that was just the number
 * would disconnect the wrong one.
 */
func TestAConnectionIsNamedByItsServerAndClientId(t *testing.T) {
	conn := systemConn(t)
	connections, err := conn.ListClientConnections(testContext(t), "")
	if err != nil {
		t.Fatalf("ListClientConnections: %v", err)
	}
	if len(connections) == 0 {
		t.Fatal("no connections were listed")
	}

	server, cid, err := splitConnectionKey(connections[0].Name)
	if err != nil {
		t.Fatalf("the key %q does not split: %v", connections[0].Name, err)
	}
	if server == "" || cid == 0 {
		t.Errorf("key %q gave server %q and cid %d", connections[0].Name, server, cid)
	}
	if connections[0].Node != server {
		t.Errorf("node = %q but the key names %q", connections[0].Node, server)
	}
}

func TestAKeyThatIsNotAConnectionIsRefused(t *testing.T) {
	for _, name := range []string{"7", "", "nats-1/", "nats-1/seven"} {
		if _, _, err := splitConnectionKey(name); err == nil {
			t.Errorf("splitConnectionKey(%q) was accepted", name)
		}
	}
}

// The whole point of the button: a client that will not let go.
func TestClosingAConnectionDisconnectsIt(t *testing.T) {
	fake := startServer(t, serverOptions{
		jetStream: true, jetStreamAccount: true, monitor: true, systemAccount: true,
	})
	conn := open(t, fake, true, true)
	other := spare(t, fake, "the-one-to-close")

	ctx := testContext(t)
	connections, err := conn.ListClientConnections(ctx, "")
	if err != nil {
		t.Fatalf("ListClientConnections: %v", err)
	}
	var target string
	for _, connection := range connections {
		if connection.ClientName == "the-one-to-close" {
			target = connection.Name
		}
	}
	if target == "" {
		t.Fatal("the client to close is not in the listing")
	}

	if err := conn.CloseClientConnection(ctx, target, "test"); err != nil {
		t.Fatalf("CloseClientConnection: %v", err)
	}

	// The disconnect reaches the client asynchronously, so this waits rather
	// than asserting on the instant after the request returned.
	deadline := time.Now().Add(5 * time.Second)
	for other.IsConnected() && time.Now().Before(deadline) {
		time.Sleep(20 * time.Millisecond)
	}
	if other.IsConnected() {
		t.Error("the client is still connected after being closed")
	}
}

/*
 * The server answers a refused disconnect with an error object rather than a
 * transport failure, so a request that returned is not a request that worked.
 */
func TestClosingAConnectionThatIsNotThereIsReported(t *testing.T) {
	conn := systemConn(t)
	nodes, err := conn.ListNodes(testContext(t))
	if err != nil {
		t.Fatalf("ListNodes: %v", err)
	}

	err = conn.CloseClientConnection(testContext(t), nodes[0].Name+"/999999", "test")
	if err == nil {
		t.Fatal("closing a client that does not exist reported success")
	}
}

// NATS has no "disconnect this user" request, so an empty result has to be
// said rather than reported as a success that did nothing.
func TestClosingAUserWithNoConnectionsSaysSo(t *testing.T) {
	conn := systemConn(t)
	err := conn.CloseUserConnections(testContext(t), "nobody", "test")
	if err == nil {
		t.Fatal("closing a user with no connections reported success")
	}
	if !strings.Contains(err.Error(), "nobody") {
		t.Errorf("error %q does not name the user", err)
	}
}

/*
 * The monitoring endpoint is read-only by design, so there is no request to
 * make - and the refusal names the system account, because that operator is
 * one credential away from being able to do this.
 */
func TestClosingThroughAReadOnlyEndpointIsRefused(t *testing.T) {
	conn := monitorConn(t)
	err := conn.CloseClientConnection(testContext(t), "nats-1/7", "test")
	if err == nil {
		t.Fatal("a disconnect succeeded through a read-only endpoint")
	}
	if err.Error() != systemAbsent {
		t.Errorf("error = %q, want %q", err, systemAbsent)
	}
}

// A NATS connection has no channels, so this is an empty list rather than an
// error or a page that will not open.
func TestThereAreNoChannelsToList(t *testing.T) {
	channels, err := monitorConn(t).ListClientChannels(testContext(t), "")
	if err != nil {
		t.Fatalf("ListClientChannels: %v", err)
	}
	if len(channels) != 0 {
		t.Errorf("listed %d channels; a NATS connection has none", len(channels))
	}
}

func TestListingConnectionsWithNoSourceSaysWhy(t *testing.T) {
	conn := open(t, startServer(t, serverOptions{jetStream: true, jetStreamAccount: true}), false, false)
	if _, err := conn.ListClientConnections(testContext(t), ""); err == nil {
		t.Fatal("listing connections succeeded with neither tier")
	} else if err.Error() != systemAbsent {
		t.Errorf("error = %q, want %q", err, systemAbsent)
	}
}
