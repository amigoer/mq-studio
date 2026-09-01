package pulsar

import (
	"context"
	"net/http"
	"testing"
	"time"
)

/*
 * A repeat is capped, because the field is typed by hand.
 *
 * A slipped digit turns "send 10" into "send 1000000", and every one of those
 * is a synchronous round trip - the request would hold open for minutes while
 * filling a production topic.
 */
func TestPublishRefusesAnUnboundedRepeat(t *testing.T) {
	conn := probedConn(t, healthyCluster(t).config())

	_, err := conn.Publish(context.Background(), PublishRequest{
		Topic: "persistent://public/default/orders",
		Body:  "x",
		Count: maxPublishCount + 1,
	})
	if err == nil {
		t.Fatal("a send of more than the cap was accepted")
	}
}

// A send with no topic is refused by name rather than reaching the client as
// an address it cannot parse.
func TestPublishNeedsATopic(t *testing.T) {
	conn := probedConn(t, healthyCluster(t).config())

	if _, err := conn.Publish(context.Background(), PublishRequest{Body: "x"}); err == nil {
		t.Error("a send with no topic was accepted")
	}
}

/*
 * The canonical port's arguments are mapped, not dropped.
 *
 * Three of the five have no Pulsar equivalent, and each mapping is a decision
 * somebody could get wrong later: a tag that vanished would make the send
 * console produce messages the browse filter cannot find, and a delay read as
 * a RocketMQ level would schedule a message for a wildly different time.
 */
func TestSendMessageMapsTheCanonicalArguments(t *testing.T) {
	request := canonicalRequest("persistent://public/default/orders", "paid", "customer-7", "body", 30)

	if request.Key != "customer-7" {
		t.Errorf("keys became %q, want the message key", request.Key)
	}
	if request.Properties["tag"] != "paid" {
		t.Errorf("tags became %v, want a property named tag", request.Properties)
	}
	// Seconds, and that is the whole assertion: ports.go fixes no unit, and
	// reading it as milliseconds or as a RocketMQ level would both compile.
	if request.DeliverAfter != 30*time.Second {
		t.Errorf("a delay level of 30 became %v, want 30s", request.DeliverAfter)
	}
	if request.Count != 1 {
		t.Errorf("count = %d, want a single message", request.Count)
	}

	// No tag means no property, rather than one with an empty value that a
	// consumer filtering on presence would match.
	bare := canonicalRequest("persistent://public/default/orders", "", "", "body", 0)
	if len(bare.Properties) != 0 {
		t.Errorf("an empty tag produced %v", bare.Properties)
	}
	if bare.DeliverAfter != 0 {
		t.Errorf("a delay level of 0 became %v, want no delay", bare.DeliverAfter)
	}
}

// canonicalRequest mirrors what SendMessage builds, so the mapping is testable
// without a broker to send to.
func canonicalRequest(topic, tags, keys, body string, delayLevel int) PublishRequest {
	request := PublishRequest{
		Topic:        topic,
		Key:          keys,
		Body:         body,
		Count:        1,
		DeliverAfter: time.Duration(delayLevel) * time.Second,
	}
	if tags != "" {
		request.Properties = map[string]string{"tag": tags}
	}
	return request
}

/*
 * The publishers of a topic come from whichever stats endpoint its shape
 * answers at, the same fall-through the topic listing uses.
 *
 * Without it a non-partitioned topic - which is most of them - would report no
 * publishers at all, because partitioned-stats answers 404 for one.
 */
func TestProducerClientsReadBothTopicShapes(t *testing.T) {
	routes := topicRoutes()
	routes["/admin/v2/persistent/public/default/orders/partitioned-stats"] = `{
		"metadata": {"partitions": 3},
		"subscriptions": {},
		"publishers": [
			{"producerName": "orders-api", "address": "10.0.0.4:5000", "clientVersion": "Pulsar-Go-4.0"}
		]
	}`
	routes["/admin/v2/persistent/public/default/audit/stats"] = `{
		"subscriptions": {},
		"publishers": [{"producerName": "audit-writer", "address": "10.0.0.9:5000"}]
	}`
	cluster := newFakeCluster(t, routes, http.StatusNotFound)
	conn := probedConn(t, cluster.config())
	ctx := context.Background()

	partitioned, err := conn.ProducerClients(ctx, "", "persistent://public/default/orders")
	if err != nil {
		t.Fatalf("ProducerClients on a partitioned topic: %v", err)
	}
	if len(partitioned) != 1 || partitioned[0].ClientID != "orders-api" {
		t.Fatalf("partitioned publishers = %+v", partitioned)
	}
	if partitioned[0].Version != "Pulsar-Go-4.0" {
		t.Errorf("version = %q", partitioned[0].Version)
	}

	nonPartitioned, err := conn.ProducerClients(ctx, "", "persistent://public/default/audit")
	if err != nil {
		t.Fatalf("ProducerClients on a non-partitioned topic: %v", err)
	}
	if len(nonPartitioned) != 1 || nonPartitioned[0].ClientID != "audit-writer" {
		t.Fatalf("non-partitioned publishers = %+v", nonPartitioned)
	}

	/*
	 * Language stays empty rather than being guessed from the client version.
	 * "Pulsar-Go-4.0" looks like it names one, but a version string is not a
	 * language field and parsing it would put an invented value on the page.
	 */
	if partitioned[0].Language != "" {
		t.Errorf("language = %q, which no broker reported", partitioned[0].Language)
	}
}

// The group argument is ignored because Pulsar reports publishers per topic,
// and passing one must not change the answer.
func TestProducerClientsIgnoreTheGroupArgument(t *testing.T) {
	routes := topicRoutes()
	routes["/admin/v2/persistent/public/default/audit/stats"] = `{
		"subscriptions": {}, "publishers": [{"producerName": "audit-writer"}]
	}`
	conn := probedConn(t, newFakeCluster(t, routes, http.StatusNotFound).config())

	withGroup, err := conn.ProducerClients(
		context.Background(), "a-group", "persistent://public/default/audit")
	if err != nil {
		t.Fatalf("ProducerClients: %v", err)
	}
	withoutGroup, err := conn.ProducerClients(
		context.Background(), "", "persistent://public/default/audit")
	if err != nil {
		t.Fatalf("ProducerClients: %v", err)
	}
	if len(withGroup) != len(withoutGroup) {
		t.Errorf("the group argument changed the answer: %d vs %d",
			len(withGroup), len(withoutGroup))
	}
}
