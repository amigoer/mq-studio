package topic

import "testing"

func TestParseMQKeyFormats(t *testing.T) {
	tests := []struct {
		name       string
		key        string
		wantBroker string
		wantQueue  int
	}{
		{name: "JSON", key: `{"brokerName":"broker-a","queueId":3,"topic":"orders"}`, wantBroker: "broker-a", wantQueue: 3},
		{name: "Java", key: "MessageQueue [topic=orders, brokerName=broker-b, queueId=4]", wantBroker: "broker-b", wantQueue: 4},
		{name: "shorthand", key: "broker-c-5", wantBroker: "broker-c", wantQueue: 5},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			broker, queue := parseMQKey(test.key)
			if broker != test.wantBroker || queue != test.wantQueue {
				t.Fatalf("parseMQKey(%q) = (%q, %d), want (%q, %d)", test.key, broker, queue, test.wantBroker, test.wantQueue)
			}
		})
	}
}
