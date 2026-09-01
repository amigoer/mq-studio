package mqtt

import "strings"

// sharedPrefix marks a shared subscription: $share/<group>/<filter>. The
// broker load-balances matching messages across the group rather than giving
// every member a copy. It is 5.0 only.
const sharedPrefix = "$share/"

// splitShared separates a shared subscription's group from the filter it
// wraps. A plain filter comes back with an empty group.
func splitShared(filter string) (group, topicFilter string) {
	if !strings.HasPrefix(filter, sharedPrefix) {
		return "", filter
	}
	rest := filter[len(sharedPrefix):]
	slash := strings.IndexByte(rest, '/')
	if slash < 0 {
		// A group with no filter after it is not a subscription. Left whole so
		// the broker refuses it and says so, rather than being silently
		// rewritten into something that would subscribe to the wrong thing.
		return "", filter
	}
	return rest[:slash], rest[slash+1:]
}

/*
 * matchesFilter reports whether a topic name matches a topic filter.
 *
 * The broker already did this - it only delivers what matched. It has to be
 * done again here because one connection can hold several streams and the
 * delivery says which topic it was published to, not which stream asked for
 * it. Under 5.0 the subscription identifier would answer that; 3.1.1 has none,
 * so both versions go through this.
 *
 * The rules are the specification's, and the third is the one worth naming:
 *
 *   + matches exactly one level, # matches the rest including none, and a
 *   filter beginning with either must not match a topic beginning with $.
 *
 * That last rule is why subscribing to # does not drain $SYS. Without it the
 * live workbench would fill with the broker's own telemetry the moment someone
 * watched everything, and the $SYS reader would see its own tree twice.
 */
func matchesFilter(filter, topic string) bool {
	if filter == "" || topic == "" {
		return false
	}
	_, filter = splitShared(filter)

	filterLevels := strings.Split(filter, "/")
	topicLevels := strings.Split(topic, "/")

	if strings.HasPrefix(topic, "$") &&
		(filterLevels[0] == "#" || filterLevels[0] == "+") {
		return false
	}

	for i, level := range filterLevels {
		if level == "#" {
			// # is only a wildcard as the filter's last level. Anywhere else
			// it is an ordinary - and invalid - level name.
			return i == len(filterLevels)-1
		}
		if i >= len(topicLevels) {
			return false
		}
		if level == "+" {
			continue
		}
		if level != topicLevels[i] {
			return false
		}
	}
	return len(filterLevels) == len(topicLevels)
}

// validFilter rejects what a broker would refuse, before it is sent.
//
// Some brokers answer an invalid filter by closing the connection rather than
// with a SUBACK failure, which reads as an unstable network rather than as a
// typo in the box the user just typed in.
func validFilter(filter string) bool {
	if filter == "" {
		return false
	}
	// $share/<group> with nothing after it is a group name, not a
	// subscription. splitShared leaves it whole rather than guess, so the
	// malformed case has to be caught by name here.
	shared := strings.HasPrefix(filter, sharedPrefix)
	group, filter := splitShared(filter)
	if filter == "" || (shared && group == "") {
		return false
	}

	levels := strings.Split(filter, "/")
	for i, level := range levels {
		switch {
		case level == "#":
			if i != len(levels)-1 {
				return false
			}
		case level == "+":
		case strings.ContainsAny(level, "+#"):
			// A wildcard has to be the whole level: "sport+" is not a filter.
			return false
		}
	}
	return true
}
