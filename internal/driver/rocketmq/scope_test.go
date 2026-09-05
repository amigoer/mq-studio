package rocketmq

import (
	"testing"
)

// The switcher's options are read out of the names themselves, so what the
// tally does with each shape of name is the whole feature.
func TestScopeTallyCountsWhatCarriesANamespace(t *testing.T) {
	tally := newScopeTally()
	for _, topic := range []string{
		// Unscoped: not a namespace, the absence of one.
		"orders",
		// Two in one namespace, and a third carrying the same base name.
		"ns%orders", "ns%audit", "other%orders",
		// A namespaced client still writes to TBW102 under its bare name.
		"TBW102",
		// The namespace goes after the retry marker, not in front of it.
		"%RETRY%ns%GID_a",
	} {
		tally.addDestination(topic)
	}
	for _, group := range []string{"GID_a", "ns%GID_a", "ns%GID_a", "CID_RMQ_SYS_x"} {
		tally.addSubscription(group)
	}

	scopes := tally.scopes()
	if len(scopes) != 2 {
		t.Fatalf("scopes = %+v, want ns and other", scopes)
	}
	// Sorted, so the list holds still between reads.
	if scopes[0].Name != "ns" || scopes[1].Name != "other" {
		t.Fatalf("scopes are not sorted by name: %+v", scopes)
	}
	// ns%orders, ns%audit and the retry topic; ns%TBW102 is a system topic.
	if scopes[0].Destinations != 3 {
		t.Errorf("ns destinations = %d, want 3", scopes[0].Destinations)
	}
	// The repeat is the same group seen on a second broker.
	if scopes[0].Subscriptions != 1 {
		t.Errorf("ns subscriptions = %d, want 1", scopes[0].Subscriptions)
	}
	if scopes[1].Destinations != 1 || scopes[1].Subscriptions != 0 {
		t.Errorf("other = %+v, want one destination and no subscription", scopes[1])
	}
}

// A cluster nobody has namespaced answers with nothing, rather than with an
// entry for the names that carry no prefix.
func TestScopeTallyOnAnUnnamespacedCluster(t *testing.T) {
	tally := newScopeTally()
	tally.addDestination("orders")
	tally.addSubscription("GID_orders")
	if scopes := tally.scopes(); len(scopes) != 0 {
		t.Fatalf("scopes = %+v, want none", scopes)
	}
}

func TestValidateScopeMatchesTheDialRule(t *testing.T) {
	conn := namespacedConn("current")
	// Unscoped is a real choice and must not be refused.
	if err := conn.ValidateScope(""); err != nil {
		t.Errorf("ValidateScope(\"\") = %v, want nil", err)
	}
	if err := conn.ValidateScope("  MQ_INST_1  "); err != nil {
		t.Errorf("ValidateScope() rejected a padded name: %v", err)
	}
	// The separator is what configOf refuses, and storing one would leave a
	// profile that no longer opens.
	if err := conn.ValidateScope("bad%ns"); err == nil {
		t.Error("a name carrying the separator must be refused before it is stored")
	}
}
