package mqtt

import "testing"

// The broker already matched these; they are matched again here because one
// connection holds several streams and a delivery says which topic it was
// published to, not which stream asked for it.
func TestMatchesFilterFollowsTheSpecification(t *testing.T) {
	tests := []struct {
		filter string
		topic  string
		want   bool
	}{
		{filter: "sport/tennis/player1", topic: "sport/tennis/player1", want: true},
		{filter: "sport/tennis/player1", topic: "sport/tennis/player2"},

		// + matches exactly one level, never more and never none.
		{filter: "sport/+/player1", topic: "sport/tennis/player1", want: true},
		{filter: "sport/+", topic: "sport/tennis/player1"},
		{filter: "sport/+", topic: "sport"},
		{filter: "sport/+", topic: "sport/", want: true},
		{filter: "+/tennis/#", topic: "sport/tennis/player1", want: true},

		// # matches the rest, including no levels at all.
		{filter: "sport/#", topic: "sport/tennis/player1", want: true},
		{filter: "sport/#", topic: "sport", want: true},
		{filter: "#", topic: "sport/tennis/player1", want: true},
		// The parent level counts: "sport/tennis/#" matches "sport/tennis"
		// itself, not only what is published below it.
		{filter: "sport/tennis/#", topic: "sport/tennis", want: true},

		// # is only a wildcard as the last level.
		{filter: "sport/#/player1", topic: "sport/tennis/player1"},

		/*
		 * The rule that keeps $SYS out of the workbench.
		 *
		 * A filter starting with a wildcard must not match a topic starting
		 * with $. Without it, subscribing to # fills the live view with the
		 * broker's own telemetry and the $SYS reader sees its own tree twice.
		 */
		{filter: "#", topic: "$SYS/broker/uptime"},
		{filter: "+/broker/uptime", topic: "$SYS/broker/uptime"},
		{filter: "$SYS/#", topic: "$SYS/broker/uptime", want: true},
		{filter: "$SYS/+/uptime", topic: "$SYS/broker/uptime", want: true},

		// A shared subscription matches on the filter inside it.
		{filter: "$share/console/sport/#", topic: "sport/tennis", want: true},
		{filter: "$share/console/sport/#", topic: "weather/today"},

		{filter: "", topic: "a"},
		{filter: "a", topic: ""},
	}

	for _, test := range tests {
		t.Run(test.filter+" vs "+test.topic, func(t *testing.T) {
			if got := matchesFilter(test.filter, test.topic); got != test.want {
				t.Errorf("matchesFilter(%q, %q) = %v, want %v",
					test.filter, test.topic, got, test.want)
			}
		})
	}
}

func TestSplitSharedSeparatesTheGroup(t *testing.T) {
	tests := []struct {
		filter     string
		wantGroup  string
		wantFilter string
	}{
		{filter: "sport/#", wantFilter: "sport/#"},
		{filter: "$share/console/sport/#", wantGroup: "console", wantFilter: "sport/#"},
		{filter: "$share/console/#", wantGroup: "console", wantFilter: "#"},
		// A group with no filter after it is not a subscription. Left whole so
		// the broker refuses it and says so, rather than being silently
		// rewritten into a subscription to something else.
		{filter: "$share/console", wantFilter: "$share/console"},
	}

	for _, test := range tests {
		t.Run(test.filter, func(t *testing.T) {
			group, filter := splitShared(test.filter)
			if group != test.wantGroup || filter != test.wantFilter {
				t.Errorf("splitShared(%q) = %q, %q; want %q, %q",
					test.filter, group, filter, test.wantGroup, test.wantFilter)
			}
		})
	}
}

// Some brokers answer an invalid filter by closing the connection rather than
// refusing it, which reads as an unstable network rather than as a typo.
func TestValidFilterRejectsWhatABrokerWould(t *testing.T) {
	valid := []string{"#", "+", "sport/#", "sport/+/player1", "$SYS/#", "$share/g/sport/#", "a/b/c"}
	for _, filter := range valid {
		if !validFilter(filter) {
			t.Errorf("validFilter(%q) = false, want true", filter)
		}
	}

	invalid := []string{"", "sport/#/player1", "sport+", "sport/tennis#", "$share/g"}
	for _, filter := range invalid {
		if validFilter(filter) {
			t.Errorf("validFilter(%q) = true, want false", filter)
		}
	}
}
