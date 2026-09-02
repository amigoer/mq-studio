package nats

import (
	"testing"

	"github.com/amigoer/mq-studio/internal/model"
)

func TestTheCensusCountsWhatTheAccountHolds(t *testing.T) {
	conn := monitorConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	declare(t, conn, "EVENTS", map[string]string{AttrSubjects: "events.>"})
	addConsumer(t, conn, "ORDERS", "worker", nil)

	census, err := conn.Census(testContext(t))
	if err != nil {
		t.Fatalf("Census: %v", err)
	}
	// Streams are this family's destinations, so they go where queues do.
	if census.Queues != 2 {
		t.Errorf("streams = %d, want 2", census.Queues)
	}
	if census.Consumers != 1 {
		t.Errorf("consumers = %d, want 1", census.Consumers)
	}
	if census.Version == "" {
		t.Error("the census reports no server version")
	}
}

/*
 * The message counts are absent, and this is the one worth pinning. JetStream
 * reports bytes stored per account and no message total anywhere, and no split
 * between deliverable and unacknowledged - "unacknowledged" is a property of a
 * consumer, not of an account. A zero would say the account holds nothing.
 */
func TestTheCensusReportsNoMessageTotalRatherThanZero(t *testing.T) {
	conn := monitorConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	fill(t, conn, "orders.created", 10)

	census, err := conn.Census(testContext(t))
	if err != nil {
		t.Fatalf("Census: %v", err)
	}
	for name, value := range map[string]int64{
		"total":          census.Total,
		"ready":          census.Ready,
		"unacknowledged": census.Unacknowledged,
	} {
		if value != model.UnknownMetric {
			t.Errorf("%s = %d, want UnknownMetric - JetStream reports no such figure", name, value)
		}
	}
}

/*
 * Exchanges and channels are zero rather than unknown, and the difference from
 * the message counts above is deliberate: those are figures NATS has and does
 * not report, and these are concepts it does not have. Zero is the true answer
 * to "how many exchanges" on a family with none.
 */
func TestConceptsNATSLacksAreZeroRatherThanUnknown(t *testing.T) {
	conn := monitorConn(t)
	census, err := conn.Census(testContext(t))
	if err != nil {
		t.Fatalf("Census: %v", err)
	}
	if census.Exchanges != 0 || census.Channels != 0 {
		t.Errorf("exchanges/channels = %d/%d, want 0 - NATS has neither",
			census.Exchanges, census.Channels)
	}
}

func TestUsageReadsTheAccountsMeters(t *testing.T) {
	conn := monitorConn(t)
	declare(t, conn, "ORDERS", map[string]string{AttrSubjects: "orders.>"})
	fill(t, conn, "orders.created", 20)

	usage, err := conn.Usage(testContext(t))
	if err != nil {
		t.Fatalf("Usage: %v", err)
	}
	if usage.StoreUsed <= 0 {
		t.Errorf("store used = %d, want more than nothing after 20 messages", usage.StoreUsed)
	}
	if usage.Streams != 1 {
		t.Errorf("streams = %d, want 1", usage.Streams)
	}
}

/*
 * The three health checks answer different questions, and an operator needs to
 * know which part is unhealthy: a server can be up and serving core NATS
 * perfectly while its JetStream assets are still being recovered.
 */
func TestHealthAsksTheServerThreeSeparateQuestions(t *testing.T) {
	conn := monitorConn(t)

	health, err := conn.Health(testContext(t))
	if err != nil {
		t.Fatalf("Health: %v", err)
	}
	if len(health.Checks) != 3 {
		t.Fatalf("ran %d checks, want 3", len(health.Checks))
	}
	seen := map[string]bool{}
	for _, check := range health.Checks {
		seen[check.ID] = true
		if !check.Passed {
			t.Errorf("%s failed on a healthy server: %s", check.ID, check.Reason)
		}
		if check.Unavailable {
			t.Errorf("%s was unavailable on a server with a monitoring endpoint", check.ID)
		}
	}
	for _, want := range []string{HealthCheckServer, HealthCheckJetStream, HealthCheckAssets} {
		if !seen[want] {
			t.Errorf("the %s check did not run", want)
		}
	}
}

// A check id is a key the renderer labels from, not a sentence.
func TestHealthCheckIdsAreKeysRatherThanSentences(t *testing.T) {
	for _, id := range []string{HealthCheckServer, HealthCheckJetStream, HealthCheckAssets} {
		if id == "" {
			t.Error("a health check has no id")
		}
		for _, char := range id {
			if char == ' ' || char == '.' {
				t.Errorf("check id %q reads as a sentence rather than a key", id)
			}
		}
	}
}

// Health needs the monitoring endpoint, and says which tier is missing rather
// than failing generically.
func TestHealthWithoutTheMonitoringEndpointSaysWhy(t *testing.T) {
	conn := jetStreamConn(t)
	_, err := conn.Health(testContext(t))
	if err == nil {
		t.Fatal("Health succeeded with no monitoring endpoint")
	}
	if err.Error() != monitorAbsent {
		t.Errorf("error = %q, want %q", err, monitorAbsent)
	}
}

func TestCensusWithoutJetStreamSaysWhy(t *testing.T) {
	conn := open(t, startServer(t, serverOptions{monitor: true}), true, false)
	if _, err := conn.Census(testContext(t)); err == nil {
		t.Fatal("Census succeeded on a server that stores nothing")
	} else if err.Error() != jetStreamDisabled {
		t.Errorf("error = %q, want %q", err, jetStreamDisabled)
	}
}

/*
 * An account the server withheld JetStream from is not a server without it,
 * and the census has to say which - it is the same pair the connection probe
 * separates, arriving through a different call.
 */
func TestCensusOnAnAccountWithoutJetStreamSaysWhich(t *testing.T) {
	fake := startServer(t, serverOptions{jetStream: true, monitor: true})
	conn := open(t, fake, true, false)

	_, err := conn.Census(testContext(t))
	if err == nil {
		t.Fatal("Census succeeded for an account without jetstream")
	}
	if err.Error() != jetStreamNoAccount {
		t.Errorf("error = %q, want %q", err, jetStreamNoAccount)
	}
}
