package rabbitmq

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	rabbithole "github.com/michaelklishin/rabbit-hole/v3"

	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * The management API reports a stream connection's port as a number on some
 * builds and a quoted string on others, and the peer address is the only
 * thing a reader can use to recognise which of their applications this is.
 */
func TestStreamPeerAddressSurvivesEitherPortShape(t *testing.T) {
	for _, body := range []string{
		`[{"name":"conn-1","peer_host":"10.0.0.4","peer_port":51234,"user":"app"}]`,
		`[{"name":"conn-1","peer_host":"10.0.0.4","peer_port":"51234","user":"app"}]`,
	} {
		var connections []rabbithole.StreamConnectionInfo
		if err := json.Unmarshal([]byte(body), &connections); err != nil {
			t.Fatalf("decode %s: %v", body, err)
		}
		if len(connections) != 1 {
			t.Fatalf("decoded %d connections", len(connections))
		}
		if got := connections[0].PeerHost; got != "10.0.0.4" {
			t.Errorf("peer host = %q", got)
		}
		if got := connections[0].PeerPort; got != 51234 {
			t.Errorf("peer port = %d", got)
		}
	}
}

// streamServer answers the three stream endpoints with the JSON the broker
// sends, and nothing else - so a call to any other endpoint is a test failure
// rather than a silent empty result.
func streamServer(t *testing.T, connections, publishers, consumers string) *Conn {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasPrefix(r.URL.Path, "/api/stream/connections"):
			_, _ = w.Write([]byte(connections))
		case strings.HasPrefix(r.URL.Path, "/api/stream/publishers"):
			_, _ = w.Write([]byte(publishers))
		case strings.HasPrefix(r.URL.Path, "/api/stream/consumers"):
			_, _ = w.Write([]byte(consumers))
		default:
			_, _ = w.Write([]byte(`{}`))
		}
	}))
	t.Cleanup(server.Close)

	return &Conn{mgmt: testMgmt(server.URL)}
}

/*
 * A publisher and a consumer both name their connection and nothing else about
 * it, so the peer host and user come from the connection listing - which host
 * and which user is behind a client is the part an operator needs.
 */
func TestStreamClientsResolveTheirPeer(t *testing.T) {
	conn := streamServer(t,
		`[{"name":"conn-1","peer_host":"10.0.0.4","peer_port":51234,"user":"app","node":"rabbit@one"}]`,
		`[{"connection_name":"conn-1","stream":"events","reference":"writer","messages_published":90210,"messages_confirmed":90210,"messages_errored":2,"node":"rabbit@one"}]`,
		`[{"connection_name":"conn-1","stream":"events","offset":88000,"offset_lag":2210,"messages_consumed":88000,"credits":10,"active":true,"node":"rabbit@one"}]`)

	clients, err := conn.StreamClients(context.Background(),
		model.DestinationRef{Namespace: "/", Name: "events"})
	if err != nil {
		t.Fatalf("StreamClients: %v", err)
	}
	if len(clients.Publishers) != 1 || len(clients.Consumers) != 1 {
		t.Fatalf("got %d publishers and %d consumers",
			len(clients.Publishers), len(clients.Consumers))
	}

	publisher := clients.Publishers[0]
	if publisher.PeerHost != "10.0.0.4:51234" {
		t.Errorf("publisher peer = %q", publisher.PeerHost)
	}
	if publisher.User != "app" {
		t.Errorf("publisher user = %q", publisher.User)
	}
	if publisher.Published != 90210 || publisher.Confirmed != 90210 || publisher.Errored != 2 {
		t.Errorf("publisher counts = %d/%d/%d",
			publisher.Published, publisher.Confirmed, publisher.Errored)
	}

	consumer := clients.Consumers[0]
	if consumer.PeerHost != "10.0.0.4:51234" || consumer.User != "app" {
		t.Errorf("consumer peer = %q as %q", consumer.PeerHost, consumer.User)
	}
	// Lag is the only thing that says a stream consumer is behind: a stream
	// keeps its messages after they are read, so there is no depth to fall
	// behind on.
	if consumer.Offset != 88000 || consumer.Lag != 2210 {
		t.Errorf("consumer is at %d, %d behind", consumer.Offset, consumer.Lag)
	}
	if !consumer.Active {
		t.Error("an active consumer was reported as standby")
	}
}

/*
 * There is no per-stream endpoint for consumers, so the vhost's are read and
 * filtered here. A missing filter would attribute every stream's readers to
 * whichever queue happened to be open.
 */
func TestStreamConsumersAreFilteredToTheirStream(t *testing.T) {
	conn := streamServer(t, `[]`, `[]`,
		`[{"connection_name":"c1","stream":"events","offset":10},
		  {"connection_name":"c2","stream":"audit","offset":20}]`)

	clients, err := conn.StreamClients(context.Background(),
		model.DestinationRef{Namespace: "/", Name: "events"})
	if err != nil {
		t.Fatalf("StreamClients: %v", err)
	}
	if len(clients.Consumers) != 1 {
		t.Fatalf("got %d consumers, want only the one on events", len(clients.Consumers))
	}
	if clients.Consumers[0].Offset != 10 {
		t.Errorf("the wrong stream's consumer came back: offset %d", clients.Consumers[0].Offset)
	}
}

/*
 * A record whose connection is not in the listing must still appear. The
 * counts are the point, and losing a publisher because its connection closed
 * between two calls would be worse than an empty peer column.
 */
func TestStreamRecordsSurviveAnUnknownConnection(t *testing.T) {
	conn := streamServer(t, `[]`,
		`[{"connection_name":"gone","stream":"events","messages_published":7}]`, `[]`)

	clients, err := conn.StreamClients(context.Background(),
		model.DestinationRef{Namespace: "/", Name: "events"})
	if err != nil {
		t.Fatalf("StreamClients: %v", err)
	}
	if len(clients.Publishers) != 1 {
		t.Fatalf("a publisher was dropped with its connection")
	}
	if clients.Publishers[0].PeerHost != "" {
		t.Errorf("peer host = %q, want empty", clients.Publishers[0].PeerHost)
	}
	if clients.Publishers[0].Published != 7 {
		t.Errorf("published = %d", clients.Publishers[0].Published)
	}
}

/*
 * The connection listing is best effort: it costs the peer column, not the
 * page. A broker that answers about publishers but not connections still has
 * to report who is publishing.
 */
func TestStreamClientsSurviveAnUnreadableConnectionListing(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/stream/connections") {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if strings.HasPrefix(r.URL.Path, "/api/stream/publishers") {
			_, _ = w.Write([]byte(`[{"connection_name":"c1","stream":"events","reference":"writer"}]`))
			return
		}
		_, _ = w.Write([]byte(`[]`))
	}))
	t.Cleanup(server.Close)
	conn := &Conn{mgmt: testMgmt(server.URL)}

	clients, err := conn.StreamClients(context.Background(),
		model.DestinationRef{Namespace: "/", Name: "events"})
	if err != nil {
		t.Fatalf("StreamClients: %v", err)
	}
	if len(clients.Publishers) != 1 || clients.Publishers[0].Reference != "writer" {
		t.Errorf("publishers = %+v", clients.Publishers)
	}
}
