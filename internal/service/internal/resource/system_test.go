package resource

import "testing"

func TestIsSystemTopic(t *testing.T) {
	cases := []struct {
		topic string
		want  bool
	}{
		{"", true},
		{"orders", false},
		{"%RETRY%gid", false},
		{"%DLQ%gid", false},
		{"%SYS%internal", true},
		{"RMQ_SYS_TRACE_TOPIC", true},
		{"SCHEDULE_TOPIC_XXXX", true},
		{"TBW102", true},
		{"BenchmarkTest", true},
		{"business_topic", false},
	}
	for _, tc := range cases {
		if got := IsSystemTopic(tc.topic); got != tc.want {
			t.Fatalf("IsSystemTopic(%q) = %v, want %v", tc.topic, got, tc.want)
		}
	}
}

func TestIsSystemGroup(t *testing.T) {
	if !IsSystemGroup("TOOLS_CONSUMER") {
		t.Fatal("TOOLS_CONSUMER must be a system group")
	}
	if !IsSystemGroup("CID_ONSAPI_FOO") {
		t.Fatal("CID_ONSAPI prefixes must be system groups")
	}
	if IsSystemGroup("orders-consumer") {
		t.Fatal("business groups must remain visible")
	}
}
