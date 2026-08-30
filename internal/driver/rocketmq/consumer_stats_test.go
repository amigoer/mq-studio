package rocketmq

import "testing"

// The offset table is keyed by a MessageQueue object, which the library hands
// back as the JSON text of that object once its Fastjson fixer has quoted it.
func TestParseMessageQueueKey(t *testing.T) {
	queue := parseMessageQueueKey(`{"brokerName":"broker-a","queueId":3,"topic":"orders"}`)
	if queue.Topic != "orders" || queue.BrokerName != "broker-a" || queue.QueueID != 3 {
		t.Fatalf("unexpected queue: %+v", queue)
	}
}

// A key the fixer did not manage still has real offsets behind it, so the row
// survives with a queue id that cannot be mistaken for queue 0.
func TestParseMessageQueueKeyUnreadable(t *testing.T) {
	queue := parseMessageQueueKey(`{brokerName:broker-a`)
	if queue.QueueID != -1 || queue.Topic != "" {
		t.Fatalf("unreadable key should not decode: %+v", queue)
	}
}

func TestSortQueueRows(t *testing.T) {
	rows := []map[string]interface{}{
		{"topic": "orders", "brokerName": "broker-b", "queueId": 0},
		{"topic": "orders", "brokerName": "broker-a", "queueId": 2},
		{"topic": "orders", "brokerName": "broker-a", "queueId": 0},
		{"topic": "audit", "brokerName": "broker-a", "queueId": 1},
	}
	sortQueueRows(rows)

	want := []struct {
		topic  string
		broker string
		queue  int
	}{
		{"audit", "broker-a", 1},
		{"orders", "broker-a", 0},
		{"orders", "broker-a", 2},
		{"orders", "broker-b", 0},
	}
	for index, expected := range want {
		row := rows[index]
		if row["topic"] != expected.topic || row["brokerName"] != expected.broker ||
			row["queueId"] != expected.queue {
			t.Fatalf("row %d: got %+v, want %+v", index, row, expected)
		}
	}
}
