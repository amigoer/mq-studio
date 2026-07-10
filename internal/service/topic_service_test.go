package service

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
		{name: "简写", key: "broker-c-5", wantBroker: "broker-c", wantQueue: 5},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			broker, queue := parseMQKey(tt.key)
			if broker != tt.wantBroker || queue != tt.wantQueue {
				t.Fatalf("parseMQKey(%q) = (%q, %d)，期望 (%q, %d)", tt.key, broker, queue, tt.wantBroker, tt.wantQueue)
			}
		})
	}
}
