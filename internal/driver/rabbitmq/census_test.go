package rabbitmq

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/amigoer/mq-studio/internal/model"
)

// overviewServer answers the two calls Census makes.
func censusServer(t *testing.T, overview, clusterName string) *Conn {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/overview":
			_, _ = w.Write([]byte(overview))
		case "/api/cluster-name/":
			_, _ = w.Write([]byte(clusterName))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(server.Close)

	profile := model.ConnectionProfile{
		Kind:       model.KindRabbitMQ,
		Endpoints:  server.URL,
		TimeoutSec: 2,
		Options:    map[string]string{OptionAMQPEndpoint: "127.0.0.1:1"},
		Secrets:    map[string]string{SecretUsername: "guest", SecretPassword: "guest"},
	}
	conn, err := New().Open(context.Background(), profile)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn.(*Conn)
}

const fullOverview = `{
  "rabbitmq_version": "4.1.2",
  "erlang_version": "27.2",
  "node": "rabbit@one",
  "object_totals": {"consumers": 7, "queues": 46, "exchanges": 12, "connections": 128, "channels": 342},
  "queue_totals": {"messages": 1155, "messages_ready": 1139, "messages_unacknowledged": 16},
  "message_stats": {
    "publish_details": {"rate": 2980.5},
    "deliver_get_details": {"rate": 2975.25},
    "ack_details": {"rate": 2970.0},
    "redeliver_details": {"rate": 4.5},
    "return_unroutable_details": {"rate": 1.5},
    "drop_unroutable_details": {"rate": 0.5}
  }
}`

func TestCensusReadsTheBrokersOwnTotals(t *testing.T) {
	conn := censusServer(t, fullOverview, `{"name": "rabbit-prod"}`)

	census, err := conn.Census(context.Background())
	if err != nil {
		t.Fatalf("Census: %v", err)
	}

	// The cluster name is its own endpoint. Overview carries the node that
	// answered, which on a cluster of three is not the cluster's name.
	if census.ClusterName != "rabbit-prod" {
		t.Errorf("clusterName = %q, want the cluster endpoint's answer", census.ClusterName)
	}
	if census.Version != "4.1.2" || census.RuntimeVersion != "27.2" {
		t.Errorf("versions = %q / %q", census.Version, census.RuntimeVersion)
	}
	if census.Queues != 46 || census.Exchanges != 12 || census.Consumers != 7 {
		t.Errorf("object totals = %d queues, %d exchanges, %d consumers",
			census.Queues, census.Exchanges, census.Consumers)
	}
	if census.Connections != 128 || census.Channels != 342 {
		t.Errorf("connections/channels = %d / %d", census.Connections, census.Channels)
	}
	if census.Ready != 1139 || census.Unacknowledged != 16 || census.Total != 1155 {
		t.Errorf("depth = %d ready, %d unacked, %d total",
			census.Ready, census.Unacknowledged, census.Total)
	}
}

func TestCensusReadsTheRates(t *testing.T) {
	conn := censusServer(t, fullOverview, `{"name": "x"}`)
	census, err := conn.Census(context.Background())
	if err != nil {
		t.Fatalf("Census: %v", err)
	}

	if census.Rates.Publish != 2980.5 {
		t.Errorf("publish rate = %v", census.Rates.Publish)
	}
	// deliver_get, not deliver: a message read with basic.get has still left
	// the broker, and counting only push delivery understates a queue that is
	// being polled.
	if census.Rates.Deliver != 2975.25 {
		t.Errorf("deliver rate = %v, want deliver_get", census.Rates.Deliver)
	}
	if census.Rates.Ack != 2970 || census.Rates.Redeliver != 4.5 {
		t.Errorf("ack/redeliver = %v / %v", census.Rates.Ack, census.Rates.Redeliver)
	}
	// Returned and dropped are the same event seen from two sides: whether the
	// publisher asked to hear about it. An operator wants the total.
	if census.Rates.Unroutable != 2 {
		t.Errorf("unroutable = %v, want returned plus dropped", census.Rates.Unroutable)
	}
}

// A broker that has done nothing since boot omits message_stats entirely.
// Nothing moving is a real zero, not a missing measurement.
func TestCensusTreatsAnIdleBrokerAsZeroRates(t *testing.T) {
	conn := censusServer(t, `{
	  "rabbitmq_version": "4.1.2",
	  "object_totals": {"queues": 0, "exchanges": 7},
	  "queue_totals": {}
	}`, `{"name": "fresh"}`)

	census, err := conn.Census(context.Background())
	if err != nil {
		t.Fatalf("Census: %v", err)
	}
	if census.Rates.Publish != 0 || census.Rates.Deliver != 0 {
		t.Errorf("an idle broker reported rates %v / %v", census.Rates.Publish, census.Rates.Deliver)
	}
	// The default exchanges exist on any vhost, so this is a real count.
	if census.Exchanges != 7 {
		t.Errorf("exchanges = %d", census.Exchanges)
	}
}

func TestCensusHonoursTheDeadline(t *testing.T) {
	conn := censusServer(t, fullOverview, `{"name": "x"}`)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if _, err := conn.Census(ctx); err == nil {
		t.Fatal("Census ran against a cancelled context")
	}
}
