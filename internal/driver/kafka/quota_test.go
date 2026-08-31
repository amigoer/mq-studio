package kafka

import (
	"testing"

	"github.com/twmb/franz-go/pkg/kadm"

	"github.com/amigoer/mq-studio/internal/model"
)

func named(value string) *string { return &value }

/*
 * A null entity name is the default every unmatched client inherits, and it is
 * not the same row as a quota on the client whose name happens to be empty.
 * Rendering both as an empty string would hide which one an operator is about
 * to edit.
 */
func TestADefaultQuotaIsNotAnEmptyName(t *testing.T) {
	fallback := quotaFrom(kadm.DescribedClientQuota{
		Entity: kadm.ClientQuotaEntity{{Type: QuotaUser, Name: nil}},
	})
	empty := quotaFrom(kadm.DescribedClientQuota{
		Entity: kadm.ClientQuotaEntity{{Type: QuotaUser, Name: named("")}},
	})

	if !fallback.Entity[0].Default {
		t.Error("a null name was not read as the default")
	}
	if empty.Entity[0].Default {
		t.Error("an empty name was read as the default")
	}
	if quotaKey(fallback) == quotaKey(empty) {
		t.Error("the default and an empty name share an identity")
	}
}

func TestQuotaValuesAndEntityAreRead(t *testing.T) {
	quota := quotaFrom(kadm.DescribedClientQuota{
		// Deliberately out of order: two equal quotas must read the same.
		Entity: kadm.ClientQuotaEntity{
			{Type: QuotaClientID, Name: named("importer")},
			{Type: QuotaUser, Name: named("alice")},
		},
		Values: kadm.ClientQuotaValues{
			{Key: "producer_byte_rate", Value: 1048576},
			{Key: "request_percentage", Value: 50},
		},
	})

	if len(quota.Entity) != 2 {
		t.Fatalf("entity = %v", quota.Entity)
	}
	if quota.Entity[0].Type != QuotaClientID || quota.Entity[1].Type != QuotaUser {
		t.Errorf("entity is not sorted: %v", quota.Entity)
	}
	if quota.Limits["producer_byte_rate"] != 1048576 {
		t.Errorf("producer_byte_rate = %v", quota.Limits["producer_byte_rate"])
	}
	if quota.Limits["request_percentage"] != 50 {
		t.Errorf("request_percentage = %v", quota.Limits["request_percentage"])
	}
	if quotaKey(quota) != "client-id=importer,user=alice" {
		t.Errorf("key = %q", quotaKey(quota))
	}
}

func TestAlterQuotaRefusesAnIncompleteRequest(t *testing.T) {
	conn := newConn(nil, nil, clientConfig{})

	if err := conn.AlterQuota(t.Context(), nil, map[string]float64{"a": 1}, nil); err == nil {
		t.Error("a quota with no entity was accepted")
	}
	if err := conn.AlterQuota(t.Context(),
		[]model.QuotaEntity{{Type: QuotaUser, Name: "alice"}}, nil, nil); err == nil {
		t.Error("a quota that sets and removes nothing was accepted")
	}
	if err := conn.AlterQuota(t.Context(),
		[]model.QuotaEntity{{Type: "team"}}, map[string]float64{"a": 1}, nil); err == nil {
		t.Error("an unknown entity type was accepted")
	}
	// A named entity with no name is a row nothing matches; the default flag
	// is how an operator asks for the fallback.
	if err := conn.AlterQuota(t.Context(),
		[]model.QuotaEntity{{Type: QuotaUser, Name: "  "}}, map[string]float64{"a": 1}, nil); err == nil {
		t.Error("a named entity with a blank name was accepted")
	}
	if err := conn.RemoveQuota(t.Context(),
		[]model.QuotaEntity{{Type: QuotaUser, Name: "alice"}}, nil); err == nil {
		t.Error("removing no limits was accepted")
	}
}

/*
 * Kafka refuses an entity combining an IP with a user or client id: an IP
 * quota throttles connections before anybody has authenticated, so there is no
 * identity to combine it with. Saying so names the problem instead of passing
 * INVALID_REQUEST to the user.
 */
func TestAnIPQuotaCannotBeCombinedWithAnIdentity(t *testing.T) {
	if err := checkQuotaEntityCombination([]model.QuotaEntity{
		{Type: QuotaIP, Name: "10.0.0.1"}, {Type: QuotaUser, Name: "alice"},
	}); err == nil {
		t.Error("an IP combined with a user was accepted")
	}
	// A user and a client id do compose: "this application, run by this user".
	if err := checkQuotaEntityCombination([]model.QuotaEntity{
		{Type: QuotaUser, Name: "alice"}, {Type: QuotaClientID, Name: "importer"},
	}); err != nil {
		t.Errorf("a user and a client id were refused: %v", err)
	}
	if err := checkQuotaEntityCombination([]model.QuotaEntity{
		{Type: QuotaIP, Name: "10.0.0.1"},
	}); err != nil {
		t.Errorf("an IP on its own was refused: %v", err)
	}
}

// The named keys are a convenience, not a closed set: a cluster knows keys
// this build has never heard of, and refusing them would make the page less
// capable than kafka-configs.sh.
func TestTheNamedQuotaLimitsAreTheFourWorthNaming(t *testing.T) {
	limits := KnownQuotaLimits()
	if len(limits) != 4 {
		t.Fatalf("limits = %v", limits)
	}
	for _, want := range []string{"producer_byte_rate", "consumer_byte_rate", "request_percentage"} {
		found := false
		for _, limit := range limits {
			if limit == want {
				found = true
			}
		}
		if !found {
			t.Errorf("%s is not offered by name", want)
		}
	}
}
