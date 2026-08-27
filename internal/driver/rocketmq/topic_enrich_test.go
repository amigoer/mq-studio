package rocketmq

import (
	"testing"

	"github.com/amigoer/mq-studio/internal/model"
)

func TestApplyTopicConfigsReportsPerBrokerQueues(t *testing.T) {
	items := []*model.TopicItem{{Topic: "orders", ReadQueue: unknownMetric, WriteQueue: unknownMetric}}
	configs := map[string][]brokerTopicConfig{
		"orders": {
			{broker: masterBroker{cluster: "c1", name: "broker-a", addr: "10.0.0.1:10911"}, readQueue: 8, writeQueue: 8, perm: 6},
			{broker: masterBroker{cluster: "c1", name: "broker-b", addr: "10.0.0.2:10911"}, readQueue: 8, writeQueue: 8, perm: 6},
		},
	}

	applyTopicConfigs(items, configs)

	// The edit form writes this value back to one broker, so it must stay the
	// single-broker setting rather than the cluster-wide total of 16.
	if items[0].ReadQueue != 8 || items[0].WriteQueue != 8 {
		t.Fatalf("queues = %d/%d, want 8/8", items[0].ReadQueue, items[0].WriteQueue)
	}
	if items[0].Perm != model.PermRW {
		t.Fatalf("perm = %q, want %q", items[0].Perm, model.PermRW)
	}
	if items[0].Cluster != "c1" {
		t.Fatalf("cluster = %q, want %q", items[0].Cluster, "c1")
	}
}

func TestApplyTopicConfigsMarksOrderedTopics(t *testing.T) {
	items := []*model.TopicItem{
		{Topic: "ordered", MessageType: model.MessageTypeNormal},
		{Topic: "plain", MessageType: model.MessageTypeNormal},
		{Topic: "missing", MessageType: model.MessageTypeNormal, ReadQueue: unknownMetric},
	}
	configs := map[string][]brokerTopicConfig{
		"ordered": {
			{broker: masterBroker{name: "broker-a"}, order: false},
			{broker: masterBroker{name: "broker-b"}, order: true},
		},
		"plain": {{broker: masterBroker{name: "broker-a"}, order: false}},
	}

	applyTopicConfigs(items, configs)

	if items[0].MessageType != model.MessageTypeFIFO {
		t.Fatalf("ordered topic type = %q, want %q", items[0].MessageType, model.MessageTypeFIFO)
	}
	if items[1].MessageType != model.MessageTypeNormal {
		t.Fatalf("plain topic type = %q, want %q", items[1].MessageType, model.MessageTypeNormal)
	}
	// A topic no broker reported keeps its unknown sentinel instead of a zero.
	if items[2].ReadQueue != unknownMetric {
		t.Fatalf("unreported topic queue = %d, want %d", items[2].ReadQueue, unknownMetric)
	}
}

func TestTpsOrUnknownSeparatesIdleFromUnmeasured(t *testing.T) {
	if got := tpsOrUnknown(0, false); got != unknownMetric {
		t.Fatalf("no broker answered = %d, want %d", got, unknownMetric)
	}
	if got := tpsOrUnknown(0, true); got != 0 {
		t.Fatalf("idle topic = %d, want 0", got)
	}
	if got := tpsOrUnknown(12.6, true); got != 13 {
		t.Fatalf("rounded rate = %d, want 13", got)
	}
}

func TestBrokerAddressesSkipsBrokersWithoutAddress(t *testing.T) {
	entries := []brokerTopicConfig{
		{broker: masterBroker{name: "broker-a", addr: "10.0.0.1:10911"}},
		{broker: masterBroker{name: "broker-b"}},
	}

	addresses := brokerAddresses(entries)

	if len(addresses) != 1 || addresses[0] != "10.0.0.1:10911" {
		t.Fatalf("addresses = %#v, want [10.0.0.1:10911]", addresses)
	}
}
