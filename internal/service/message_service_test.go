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
