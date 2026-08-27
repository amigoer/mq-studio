package model

import "testing"

func TestCapabilitiesHasReportsOnlySupported(t *testing.T) {
	capabilities := NewCapabilities(CapDestinationList, CapPublish)

	if !capabilities.Has(CapDestinationList) {
		t.Error("declared capability reported as unsupported")
	}
	if capabilities.Has(CapOffsetReset) {
		t.Error("undeclared capability reported as supported")
	}
}

func TestWithDegradedDropsTheCapabilityFromSupported(t *testing.T) {
	capabilities := NewCapabilities(CapDestinationList, CapPublish).
		WithDegraded(CapDestinationList, "proxy endpoint is a data plane only")

	if capabilities.Has(CapDestinationList) {
		t.Error("degraded capability is still reported as supported")
	}
	if !capabilities.Has(CapPublish) {
		t.Error("degrading one capability dropped another")
	}
	reason, ok := capabilities.DegradedReason(CapDestinationList)
	if !ok || reason != "proxy endpoint is a data plane only" {
		t.Errorf("degraded reason = %q, %v; want the stored reason", reason, ok)
	}
}

// A caveat annotates something that works, so it must not remove support.
// Browsing a RabbitMQ queue is the real case: it succeeds, but it mutates
// queue state.
func TestWithCaveatKeepsTheCapabilitySupported(t *testing.T) {
	capabilities := NewCapabilities(CapMessageQuery).
		WithCaveat(CapMessageQuery, "basic.get alters queue state")

	if !capabilities.Has(CapMessageQuery) {
		t.Error("a caveat removed support")
	}
	caveat, ok := capabilities.Caveat(CapMessageQuery)
	if !ok || caveat != "basic.get alters queue state" {
		t.Errorf("caveat = %q, %v; want the stored caveat", caveat, ok)
	}
}

// The With* helpers return copies so a driver can derive a narrowed set from
// a shared base without corrupting it for the next connection.
func TestWithDegradedDoesNotMutateTheReceiver(t *testing.T) {
	base := NewCapabilities(CapDestinationList).WithCaveat(CapDestinationList, "slow")

	narrowed := base.WithDegraded(CapDestinationList, "unavailable here")

	if !base.Has(CapDestinationList) {
		t.Error("deriving a narrowed set mutated the base")
	}
	if _, ok := base.DegradedReason(CapDestinationList); ok {
		t.Error("the base picked up the derived set's degraded entry")
	}
	if _, ok := narrowed.Caveat(CapDestinationList); !ok {
		t.Error("the derived set lost the base's caveat")
	}
}

func TestConfiguredSecretsSkipsEmptyAndSorts(t *testing.T) {
	profile := &ConnectionProfile{Secrets: map[string]string{
		"secretKey": "ENC:def",
		"accessKey": "ENC:abc",
		"token":     "",
	}}

	configured := profile.ConfiguredSecrets()

	want := []string{"accessKey", "secretKey"}
	if len(configured) != len(want) {
		t.Fatalf("configured = %v; want %v", configured, want)
	}
	for i, key := range want {
		if configured[i] != key {
			t.Fatalf("configured = %v; want %v", configured, want)
		}
	}
}
