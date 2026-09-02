package resource

import "testing"

func TestWrap(t *testing.T) {
	cases := []struct {
		name      string
		namespace string
		resource  string
		want      string
	}{
		// The examples NamespaceUtil's own javadoc gives.
		{"plain topic", "MQ_INST_XX", "Topic_XXX", "MQ_INST_XX%Topic_XXX"},
		{"retry topic", "MQ_INST_XX", "%RETRY%GID_XXX", "%RETRY%MQ_INST_XX%GID_XXX"},
		{"dead letter topic", "MQ_INST_XX", "%DLQ%GID_XXX", "%DLQ%MQ_INST_XX%GID_XXX"},

		{"no namespace changes nothing", "", "orders", "orders"},
		{"empty name stays empty", "ns", "", ""},
		{"wrapping is idempotent", "ns", "ns%orders", "ns%orders"},
		{"retry wrapping is idempotent", "ns", "%RETRY%ns%GID", "%RETRY%ns%GID"},

		// A namespaced client addresses these under their bare names.
		{"auto-create topic", "ns", "TBW102", "TBW102"},
		{"scheduled topic", "ns", "SCHEDULE_TOPIC_XXXX", "SCHEDULE_TOPIC_XXXX"},
		{"lower-case system prefix", "ns", "rmq_sys_SYNC_BROKER_MEMBER_x", "rmq_sys_SYNC_BROKER_MEMBER_x"},
		{"system consumer group", "ns", "CID_RMQ_SYS_TRANS", "CID_RMQ_SYS_TRANS"},

		// A different namespace's name is still wrapped: it is a name like any
		// other until someone says which namespace it belongs to.
		{"foreign namespace", "ns", "other%orders", "ns%other%orders"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Wrap(tc.namespace, tc.resource); got != tc.want {
				t.Fatalf("Wrap(%q, %q) = %q, want %q", tc.namespace, tc.resource, got, tc.want)
			}
		})
	}
}

func TestUnwrap(t *testing.T) {
	cases := []struct {
		name      string
		namespace string
		resource  string
		want      string
	}{
		{"plain topic", "MQ_INST_XX", "MQ_INST_XX%Topic_XXX", "Topic_XXX"},
		{"retry topic", "MQ_INST_XX", "%RETRY%MQ_INST_XX%GID_XXX", "%RETRY%GID_XXX"},
		{"dead letter topic", "MQ_INST_XX", "%DLQ%MQ_INST_XX%GID_XXX", "%DLQ%GID_XXX"},

		{"no namespace changes nothing", "", "ns%orders", "ns%orders"},
		{"another namespace is left alone", "ns", "other%orders", "other%orders"},
		{"a bare name is left alone", "ns", "orders", "orders"},
		{"system resources are left alone", "ns", "TBW102", "TBW102"},

		// The case a blind cut at the first or last '%' gets wrong: '%' is a
		// legal topic character, so only our own prefix may be removed.
		{"percent inside our name survives", "ns", "ns%order%2026", "order%2026"},
		{"percent in a foreign name survives", "ns", "billing%order%2026", "billing%order%2026"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := Unwrap(tc.namespace, tc.resource); got != tc.want {
				t.Fatalf("Unwrap(%q, %q) = %q, want %q", tc.namespace, tc.resource, got, tc.want)
			}
		})
	}
}

func TestWrapUnwrapRoundTrip(t *testing.T) {
	names := []string{"orders", "%RETRY%GID_a", "%DLQ%GID_a", "order%2026", "TBW102"}
	for _, name := range names {
		if got := Unwrap("ns", Wrap("ns", name)); got != name {
			t.Fatalf("round trip of %q returned %q", name, got)
		}
	}
}

func TestIn(t *testing.T) {
	cases := []struct {
		namespace string
		resource  string
		want      bool
	}{
		{"", "anything", true},
		{"", "", true},
		{"ns", "", false},
		{"ns", "ns%orders", true},
		{"ns", "%RETRY%ns%GID", true},
		{"ns", "%DLQ%ns%GID", true},
		{"ns", "other%orders", false},
		{"ns", "orders", false},
		// Shared with every namespace rather than owned by one.
		{"ns", "TBW102", true},
		{"ns", "CID_RMQ_SYS_TRANS", true},
		// A namespace that is a prefix of another must not match it.
		{"ns", "nsx%orders", false},
	}
	for _, tc := range cases {
		if got := In(tc.namespace, tc.resource); got != tc.want {
			t.Fatalf("In(%q, %q) = %v, want %v", tc.namespace, tc.resource, got, tc.want)
		}
	}
}

func TestOf(t *testing.T) {
	cases := []struct {
		resource string
		want     string
	}{
		{"", ""},
		{"orders", ""},
		{"ns%orders", "ns"},
		{"%RETRY%ns%GID", "ns"},
		{"%DLQ%ns%GID", "ns"},
		{"TBW102", ""},
		{"ns%order%2026", "ns"},
	}
	for _, tc := range cases {
		if got := Of(tc.resource); got != tc.want {
			t.Fatalf("Of(%q) = %q, want %q", tc.resource, got, tc.want)
		}
	}
}
