package mqtt

import (
	"context"
	"testing"
	"time"

	"github.com/amigoer/mq-studio/internal/model"
)

func listTopics(t *testing.T, conn *Conn) map[string]*model.Destination {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	destinations, err := conn.ListDestinations(ctx, model.DestinationFilter{})
	if err != nil {
		t.Fatalf("list destinations: %v", err)
	}

	byName := make(map[string]*model.Destination, len(destinations))
	for _, destination := range destinations {
		byName[destination.Ref.Name] = destination
	}
	return byName
}

// The listing answers "which topics hold a value", because that is the only
// question MQTT can answer. Both protocol versions have to answer it the same.
func TestListDestinationsFindsRetainedTopics(t *testing.T) {
	for _, version := range []string{protocol5, protocol311} {
		t.Run("mqtt"+version, func(t *testing.T) {
			server, address := fakeBrokerServer(t)
			publishFromBroker(t, server, "devices/a19f/status", "online", true)
			publishFromBroker(t, server, "devices/b22c/status", "offline", true)

			conn := openProfile(t, testProfile(address, version, nil))
			topics := listTopics(t, conn)

			for _, name := range []string{"devices/a19f/status", "devices/b22c/status"} {
				topic, found := topics[name]
				if !found {
					t.Fatalf("%q is not in the listing: %v", name, topics)
				}
				// The attribute is the caveat: this topic is listed because it
				// holds a retained value, not because the broker was asked
				// what exists.
				if topic.Attributes[AttrSource] != sourceRetained {
					t.Errorf("%q says its source is %q", name, topic.Attributes[AttrSource])
				}
			}
			if got := topics["devices/a19f/status"].Attributes[AttrRetainedBytes]; got != "6" {
				t.Errorf("retained bytes = %q, want 6", got)
			}
		})
	}
}

// A topic published to without the retain flag is invisible to this listing,
// and that has to stay true: reporting it would mean claiming the listing
// enumerates topics, which is the thing MQTT cannot do.
func TestListDestinationsOmitsWhatIsNotRetained(t *testing.T) {
	server, address := fakeBrokerServer(t)
	publishFromBroker(t, server, "devices/a19f/status", "online", true)
	publishFromBroker(t, server, "sensors/room-1/temperature", "21.5", false)

	conn := openProfile(t, testProfile(address, protocol5, nil))
	topics := listTopics(t, conn)

	if _, found := topics["devices/a19f/status"]; !found {
		t.Error("the retained topic is missing")
	}
	if _, found := topics["sensors/room-1/temperature"]; found {
		t.Error("a topic with no retained value was listed as if it held one")
	}
}

// Every count MQTT has no concept of has to read as "not reported" rather than
// as zero. A drawn zero beside a real figure is a different claim.
func TestListDestinationsReportsNoCountItCannotKnow(t *testing.T) {
	server, address := fakeBrokerServer(t)
	publishFromBroker(t, server, "devices/a19f/status", "online", true)

	conn := openProfile(t, testProfile(address, protocol5, nil))
	topic := listTopics(t, conn)["devices/a19f/status"]
	if topic == nil {
		t.Fatal("the retained topic is missing")
	}

	unknown := map[string]int64{
		"partitions":  int64(topic.Partitions),
		"subscribers": int64(topic.Subscribers),
		"depth":       topic.Depth,
		"rateIn":      int64(topic.RateIn),
		"rateOut":     int64(topic.RateOut),
	}
	for name, value := range unknown {
		if value != int64(model.UnknownMetric) {
			t.Errorf("%s = %d, want the not-reported marker", name, value)
		}
	}
}

// The $SYS tree is the broker's own telemetry and belongs on the overview, not
// in a list of the topics an operator's devices publish to.
func TestListDestinationsLeavesSysOutOfTheTopicList(t *testing.T) {
	server, address := fakeBrokerServer(t)
	publishFromBroker(t, server, "$SYS/broker/version", "test", true)
	publishFromBroker(t, server, "devices/a19f/status", "online", true)

	conn := openProfile(t, testProfile(address, protocol5, nil))
	topics := listTopics(t, conn)

	if _, found := topics["$SYS/broker/version"]; found {
		t.Error("the topic list drained the broker's own telemetry tree")
	}
	if _, found := topics["devices/a19f/status"]; !found {
		t.Error("the retained topic is missing")
	}
}

func TestDestinationDetailReadsOneRetainedValue(t *testing.T) {
	server, address := fakeBrokerServer(t)
	publishFromBroker(t, server, "devices/a19f/status", "online", true)

	conn := openProfile(t, testProfile(address, protocol5, nil))

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	topic, err := conn.DestinationDetail(ctx, model.DestinationRef{Name: "devices/a19f/status"})
	if err != nil {
		t.Fatalf("destination detail: %v", err)
	}
	if topic.Ref.Name != "devices/a19f/status" {
		t.Errorf("detail is for %q", topic.Ref.Name)
	}

	// A topic with no retained value is not an error about a missing topic:
	// it may be perfectly live and simply publish without the flag.
	if _, err := conn.DestinationDetail(ctx, model.DestinationRef{Name: "devices/none"}); err == nil {
		t.Error("a topic with no retained value reported a detail anyway")
	}
	if _, err := conn.DestinationDetail(ctx, model.DestinationRef{Name: "devices/#"}); err == nil {
		t.Error("a wildcard was accepted as a topic name")
	}
}

// A listing subscribes to # and has to give it back. Leaving it behind would
// keep delivering the whole broker to this session for as long as it is open.
func TestListDestinationsDoesNotLeaveTheWildcardSubscribed(t *testing.T) {
	server, address := fakeBrokerServer(t)
	publishFromBroker(t, server, "devices/a19f/status", "online", true)

	conn := openProfile(t, testProfile(address, protocol5, nil))
	listTopics(t, conn)

	// Nothing is streaming, so a message published now must not reach any
	// buffer - the only way to see that is to start a stream afterwards and
	// find it holds only what arrived after it started.
	subscription := startStream(t, conn, "devices/#")
	publishFromBroker(t, server, "devices/c33d/status", "online", false)

	batch := drain(t, conn, subscription.ID, 1)
	for _, message := range batch.Messages {
		if message.Destination == "devices/a19f/status" && message.Attributes[AttrRetained] != "true" {
			t.Error("a live message from before the stream started reached it")
		}
	}
}

// Create, update and delete have nothing to mean here, and have to say so
// rather than appear to work.
func TestDestinationWritesAreRefused(t *testing.T) {
	address := fakeBroker(t)
	conn := openProfile(t, testProfile(address, protocol5, nil))
	ctx := context.Background()

	if err := conn.CreateDestination(ctx, model.DestinationSpec{}); err == nil {
		t.Error("creating a topic reported success")
	}
	if err := conn.UpdateDestination(ctx, model.DestinationSpec{}); err == nil {
		t.Error("updating a topic reported success")
	}
	if err := conn.RemoveDestination(ctx, model.DestinationRef{Name: "a/b"}); err == nil {
		t.Error("removing a topic reported success")
	}
}
