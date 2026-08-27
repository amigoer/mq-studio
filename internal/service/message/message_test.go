package message

import (
	"testing"

	"github.com/amigoer/mq-studio/internal/model"

	admin "github.com/amigoer/rocketmq-admin-go"
)

func TestContainsExactMessageKey(t *testing.T) {
	if !containsExactMessageKey("order-1 trace-2", "order-1") {
		t.Fatal("an exact key must match")
	}
	if containsExactMessageKey("order-10 trace-2", "order-1") {
		t.Fatal("a key substring must not match")
	}
	if !containsExactMessageKey("solo", "solo") {
		t.Fatal("a single exact key must match")
	}
	if containsExactMessageKey("", "x") {
		t.Fatal("empty keys must not match")
	}
}

func TestQueryMessageByIDValidation(t *testing.T) {
	service := New(nil)
	for _, test := range []struct {
		name      string
		topic     string
		messageID string
	}{
		{name: "empty topic", topic: "", messageID: "id"},
		{name: "empty message ID", topic: "topic", messageID: "  "},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := service.QueryMessageByID(test.topic, test.messageID)
			if err == nil || err.Error() != "查询消息失败: Topic 和 Message ID 不能为空" {
				t.Fatalf("validation error = %v", err)
			}
		})
	}
}

func TestQueryMessagesValidation(t *testing.T) {
	service := New(nil)
	tests := []struct {
		name      string
		topic     string
		startTime int64
		endTime   int64
		wantError string
	}{
		{
			name:      "empty topic",
			topic:     "",
			startTime: 0,
			endTime:   0,
			wantError: "查询消息失败: Topic 不能为空",
		},
		{
			name:      "reversed time range",
			topic:     "topic",
			startTime: 200,
			endTime:   100,
			wantError: "查询消息失败: 开始时间不能晚于结束时间",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := service.QueryMessages(test.topic, "", "", 10, test.startTime, test.endTime)
			if err == nil || err.Error() != test.wantError {
				t.Fatalf("validation error = %v, want %q", err, test.wantError)
			}
		})
	}
}

func TestConvertRetryMessageMetadata(t *testing.T) {
	service := New(nil)
	item := service.convertMessageExt(&admin.MessageExt{
		Topic: "%RETRY%orders-group",
		Properties: map[string]string{
			"RECONSUME_TIME": "3",
			"RETRY_TOPIC":    "orders",
		},
	})
	if item.Status != model.MsgRetry || item.RetryTimes != 3 {
		t.Fatalf("retry metadata: status=%s retryTimes=%d", item.Status, item.RetryTimes)
	}
}

func TestConvertMessageExtPrefersClientMessageID(t *testing.T) {
	service := New(nil)
	item := service.convertMessageExt(&admin.MessageExt{
		MsgId:       "client-message-id",
		OffsetMsgId: "offset-message-id",
	})
	if item.MessageID != "client-message-id" {
		t.Fatalf("MessageID = %q, want client-message-id", item.MessageID)
	}
}

func TestConvertMessageExtFallsBackToOffsetMessageID(t *testing.T) {
	service := New(nil)
	item := service.convertMessageExt(&admin.MessageExt{OffsetMsgId: "offset-message-id"})
	if item.MessageID != "offset-message-id" {
		t.Fatalf("MessageID = %q, want offset-message-id", item.MessageID)
	}
}

func TestMessageMatchesID(t *testing.T) {
	message := &admin.MessageExt{
		MsgId:       "client-id",
		OffsetMsgId: "offset-id",
		Properties:  map[string]string{"UNIQ_KEY": "unique-id"},
	}
	for _, messageID := range []string{"client-id", "offset-id", "unique-id"} {
		if !messageMatchesID(message, messageID) {
			t.Fatalf("message ID %q must match", messageID)
		}
	}
	if messageMatchesID(message, "other-id") {
		t.Fatal("an unrelated message ID must not match")
	}
}

func TestMatchesMessageQueueKey(t *testing.T) {
	tests := []struct {
		name string
		key  string
		want bool
	}{
		{name: "JSON", key: `{"brokerName":"broker-a","queueId":2,"topic":"orders"}`, want: true},
		{name: "Java", key: "MessageQueue [topic=orders, brokerName=broker-a, queueId=2]", want: true},
		{name: "simple", key: "orders-broker-a-2", want: true},
		{name: "wrong queue", key: "orders-broker-a-3", want: false},
		{name: "topic prefix collision", key: "orders-v2-broker-a-2", want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := matchesMessageQueueKey(test.key, "orders", "broker-a", 2); got != test.want {
				t.Fatalf("matchesMessageQueueKey() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestConvertMessageExtStatuses(t *testing.T) {
	service := New(nil)
	dlq := service.convertMessageExt(&admin.MessageExt{
		Topic: "%DLQ%gid",
		MsgId: "m1",
		Body:  []byte("x"),
	})
	if dlq.Status != model.MsgDLQ {
		t.Fatalf("DLQ status = %s", dlq.Status)
	}
	normal := service.convertMessageExt(&admin.MessageExt{
		Topic: "orders",
		MsgId: "m2",
		Body:  []byte(`{"a":1}`),
		Properties: map[string]string{
			"TAGS": "t",
			"KEYS": "k",
		},
	})
	if normal.Status != model.MsgNormal || normal.Tags != "t" || normal.Keys != "k" {
		t.Fatalf("normal conversion failed: %#v", normal)
	}
}
