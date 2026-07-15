package service

import (
	"testing"

	"rocket-leaf/internal/model"

	admin "github.com/amigoer/rocketmq-admin-go"
)

func TestContainsExactMessageKey(t *testing.T) {
	if !containsExactMessageKey("order-1 trace-2", "order-1") {
		t.Fatal("应匹配完整 Key")
	}
	if containsExactMessageKey("order-10 trace-2", "order-1") {
		t.Fatal("不得使用子串误匹配 Key")
	}
	if !containsExactMessageKey("solo", "solo") {
		t.Fatal("单 key 应匹配")
	}
	if containsExactMessageKey("", "x") {
		t.Fatal("空 keys 不应匹配")
	}
}

func TestQueryMessageByIDValidation(t *testing.T) {
	s := NewMessageService(nil)
	if _, err := s.QueryMessageByID("", "id"); err == nil {
		t.Fatal("空 topic 应失败")
	}
	if _, err := s.QueryMessageByID("t", "  "); err == nil {
		t.Fatal("空 msg id 应失败")
	}
}

func TestQueryMessagesValidation(t *testing.T) {
	s := NewMessageService(nil)
	if _, err := s.QueryMessages("", "", "", 10, 0, 0); err == nil {
		t.Fatal("空 topic 应失败")
	}
	if _, err := s.QueryMessages("t", "", "", 10, 200, 100); err == nil {
		t.Fatal("开始晚于结束应失败")
	}
}

func TestConvertRetryMessageMetadata(t *testing.T) {
	service := NewMessageService(nil)
	item := service.convertMessageExt(&admin.MessageExt{
		Topic: "%RETRY%orders-group",
		Properties: map[string]string{
			"RECONSUME_TIME": "3",
			"RETRY_TOPIC":    "orders",
		},
	})
	if item.Status != model.MsgRetry || item.RetryTimes != 3 {
		t.Fatalf("重试消息元数据解析错误: status=%s retryTimes=%d", item.Status, item.RetryTimes)
	}
}

func TestConvertMessageExtPrefersClientMessageID(t *testing.T) {
	service := NewMessageService(nil)
	item := service.convertMessageExt(&admin.MessageExt{
		MsgId:       "client-message-id",
		OffsetMsgId: "offset-message-id",
	})
	if item.MessageID != "client-message-id" {
		t.Fatalf("MessageID = %q, want client-message-id", item.MessageID)
	}
}

func TestConvertMessageExtFallsBackToOffsetMessageID(t *testing.T) {
	service := NewMessageService(nil)
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
	for _, id := range []string{"client-id", "offset-id", "unique-id"} {
		if !messageMatchesID(message, id) {
			t.Fatalf("应匹配消息 ID %q", id)
		}
	}
	if messageMatchesID(message, "other-id") {
		t.Fatal("不应匹配无关消息 ID")
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
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := matchesMessageQueueKey(tt.key, "orders", "broker-a", 2); got != tt.want {
				t.Fatalf("matchesMessageQueueKey() = %v, want %v", got, tt.want)
			}
		})
	}
}
