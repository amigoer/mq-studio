package nats

import (
	"testing"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

// offlineConn is a connection with the family's declared capabilities and no
// server behind it. Conformance is a question about the type, not about a
// server, so it must be answerable with nothing running.
func offlineConn() *Conn {
	conn := &Conn{}
	conn.capabilities = model.NewCapabilities(capabilities()...)
	return conn
}

// The UI gates on the capability list and Go gates on the interfaces. Nothing
// in the language forces those to agree, so this is what turns a disagreement
// into a build failure instead of a control that does nothing when clicked.
func TestConnDeclaresOnlyWhatItImplements(t *testing.T) {
	for _, problem := range driver.CheckConformance(offlineConn()) {
		t.Error(problem)
	}
}

/*
 * What NATS has no concept of, and why.
 *
 * Every entry here is a capability another family in this app declares and
 * this one must not, and each has a reason that is about NATS rather than
 * about how far the driver has got. Without this list the cheapest way to add
 * a family is to copy a neighbour's capability set, and the result is a
 * sidebar full of pages that open onto nothing.
 */
func TestConnDeclaresNoConceptNATSDoesNotHave(t *testing.T) {
	absent := []struct {
		capability model.Capability
		because    string
	}{
		{
			model.CapDLQ,
			"JetStream has no dead-letter object. A consumer that exhausts max_deliver " +
				"stops redelivering and publishes an advisory; the message stays where it " +
				"was and is moved nowhere, so there is no queue to read.",
		},
		{
			model.CapDeadLetterTopology,
			"and it cannot be answered the other families' way either: there is no " +
				"declaration pointing one destination at another to walk backwards from.",
		},
		{
			model.CapOffsetReset,
			"a JetStream consumer's start position is fixed when it is created. The API " +
				"refuses to change deliver_policy or opt_start_seq afterwards, and the only " +
				"way to move one is to delete it and make another - which changes its " +
				"identity and drops its durable state, so it is not a reset.",
		},
		{
			model.CapSubscriptionPosition,
			"same reason, by sequence rather than by time.",
		},
		{
			model.CapQueueOffset,
			"a consumer's position is one number for the whole stream. There is no " +
				"per-partition position to write.",
		},
		{
			model.CapOffsetClone,
			"there is nothing to copy onto: a new consumer's position is chosen at " +
				"creation from a policy, not written afterwards.",
		},
		{
			model.CapPendingEntries,
			"ConsumerInfo reports how many deliveries are unacknowledged and nothing " +
				"about which. No API enumerates them or names who holds them, and a count " +
				"is not the list this page shows.",
		},
		{
			model.CapPendingAdmin,
			"and with no list to read there is nothing to acknowledge or reassign.",
		},
		{
			model.CapDirectory,
			"NATS servers find each other by gossip. There is no name server or " +
				"controller tier to list, and listing the servers again under another " +
				"heading would be the same table twice.",
		},
		{
			model.CapTransactions,
			"NATS has no transactional producer. A publish is acknowledged or it is not.",
		},
		{
			model.CapQuotaList,
			"limits attach to an account, not to a client identity. There is nothing " +
				"throttled per user, application or address.",
		},
		{
			model.CapSlowLog,
			"the server counts slow consumers and keeps no record of individual slow " +
				"operations to read back.",
		},
		{
			model.CapLogDirs,
			"JetStream reports what an account is using, not what each file store holds " +
				"per stream on disk.",
		},
		{
			model.CapRouting,
			"subjects are not exchanges. Nothing is declared, nothing is bound, and " +
				"there is no topology object to list.",
		},
		{
			model.CapMessageTrack,
			"there is no trace. A message carries no history of where it has been.",
		},
		{
			model.CapMessageReplay,
			"a consumer is not addressable from outside: there is no way to hand one " +
				"client a message and see what its handler returned.",
		},
		{
			model.CapDelayedDelivery,
			"the server schedules nothing. A publish is delivered now or persisted now.",
		},
		{
			model.CapEntryPublish,
			"a NATS message is a subject, headers and a body, not an ordered list of " +
				"named fields.",
		},
		{
			model.CapPublishRich,
			"that capability is backed by an AMQP-shaped request - an exchange, a " +
				"routing key, a mandatory flag - and none of it has a NATS meaning. What " +
				"NATS publishes with instead is its own, on its own service.",
		},
	}

	live := offlineConn().Capabilities()
	for _, entry := range absent {
		if live.Has(entry.capability) {
			t.Errorf("declares %s, but %s", entry.capability, entry.because)
		}
		if _, degraded := live.DegradedReason(entry.capability); degraded {
			t.Errorf("degrades %s, which implies the family has it; %s",
				entry.capability, entry.because)
		}
	}
}

// The descriptor is read before anything is dialled, so it has to stand on its
// own: a form that writes into a target nothing reads, or a capability the
// connection cannot honour, would both surface as a dead control.
func TestDescriptorIsSelfConsistent(t *testing.T) {
	descriptor := New().Descriptor()

	if descriptor.Kind != model.KindNATS {
		t.Errorf("kind = %q, want nats", descriptor.Kind)
	}
	if descriptor.DefaultPort != defaultPort {
		t.Errorf("default port = %q, want %q", descriptor.DefaultPort, defaultPort)
	}
	if len(descriptor.Form) == 0 {
		t.Fatal("descriptor carries no connection form")
	}

	keys := make(map[string]bool, len(descriptor.Form))
	for _, field := range descriptor.Form {
		if field.Key == "" || field.LabelKey == "" {
			t.Errorf("form field is missing a key or label: %#v", field)
		}
		if keys[field.Key] {
			t.Errorf("form field %q is declared twice", field.Key)
		}
		keys[field.Key] = true
		switch field.Target {
		case model.TargetEndpoints, model.TargetOption, model.TargetSecret, model.TargetAuth:
		default:
			t.Errorf("form field %q writes into an unknown target %q", field.Key, field.Target)
		}
		if field.Type == model.FieldSelect && len(field.Options) == 0 {
			t.Errorf("form field %q is a select with no options", field.Key)
		}
	}

	// A condition naming a field that is not on the form hides its own row
	// forever, and nothing at runtime would say so.
	for _, field := range descriptor.Form {
		if field.VisibleWhen == nil {
			continue
		}
		if !keys[field.VisibleWhen.Field] {
			t.Errorf("form field %q is shown by %q, which is not on the form",
				field.Key, field.VisibleWhen.Field)
		}
		if len(field.VisibleWhen.Equals) == 0 {
			t.Errorf("form field %q has a condition that matches nothing", field.Key)
		}
	}

	// The credential half of the form has to be secrets. A password stored as
	// an option is written to disk in the clear and sent back to the renderer.
	for _, field := range descriptor.Form {
		if field.Type == model.FieldPassword && field.Target != model.TargetSecret {
			t.Errorf("form field %q holds a password but is not a secret", field.Key)
		}
	}

	// Every mechanism the form offers has to be one configOf reads, or the
	// user picks an option that quietly authenticates as nobody.
	handled := map[string]bool{
		string(model.AuthNone):      true,
		string(model.AuthPlain):     true,
		string(model.AuthToken):     true,
		string(model.AuthNKey):      true,
		string(model.AuthCreds):     true,
		string(model.AuthMutualTLS): true,
	}
	for _, field := range descriptor.Form {
		if field.Target != model.TargetAuth {
			continue
		}
		for _, option := range field.Options {
			if !handled[option.Value] {
				t.Errorf("the form offers the %q mechanism and configOf does not read it", option.Value)
			}
		}
	}

	// MaxCapabilities is the family's best case, so a connection may report a
	// capability as degraded instead of supported - that is the middle state
	// working, not a disagreement. What it may not do is drop one entirely.
	live := offlineConn().Capabilities()
	for _, capability := range descriptor.MaxCapabilities {
		if live.Has(capability) {
			continue
		}
		if reason, degraded := live.DegradedReason(capability); degraded {
			if reason == "" {
				t.Errorf("%s is degraded with no reason to show", capability)
			}
			continue
		}
		t.Errorf("descriptor promises %s but a connection neither supports nor degrades it", capability)
	}
}

// Every option and secret this driver reads has to be somewhere on the form,
// or it is a setting the user cannot set. The reverse is checked above by
// VisibleWhen; this is the half that catches a key renamed on one side only.
func TestEveryStoredKeyIsOnTheForm(t *testing.T) {
	stored := []string{
		OptionTLS,
		OptionTLSCAFile,
		OptionTLSCertFile,
		OptionTLSKeyFile,
		OptionTLSSkipVerify,
		OptionMonitorURL,
		OptionJSDomain,
		OptionCredsFile,
		SecretUsername,
		SecretPassword,
		SecretToken,
		SecretNKeySeed,
		SecretSystemUser,
		SecretSystemPassword,
	}

	onForm := make(map[string]bool)
	for _, field := range New().Descriptor().Form {
		onForm[field.Key] = true
	}
	for _, key := range stored {
		if !onForm[key] {
			t.Errorf("the driver reads %q but the form never collects it", key)
		}
	}
}

/*
 * The sidebar contract, from the Go side.
 *
 * The list below is the one frontend/src/mq/navigation.nats.test.ts holds, and
 * that test asserts which pages those capabilities make reachable. This one
 * asserts the driver still declares exactly them.
 *
 * Neither half is worth much alone. A capability dropped here takes a finished
 * page out of the sidebar and nothing else notices; a page added there with no
 * capability behind it is drawn and fails when opened. Together they cannot
 * drift without one of them going red.
 *
 * The failure messages say what to do rather than what is different, because
 * the fix is never in this file alone.
 */
func TestCapabilitiesMatchTheSidebarContract(t *testing.T) {
	sidebar := []string{
		"destination.list",
		"destination.create",
		"destination.update",
		"destination.delete",
		"destination.partitions",
	}

	declared := make(map[string]bool, len(capabilities()))
	for _, capability := range capabilities() {
		declared[string(capability)] = true
	}
	expected := make(map[string]bool, len(sidebar))
	for _, capability := range sidebar {
		expected[capability] = true
	}

	for _, capability := range sidebar {
		if !declared[capability] {
			t.Errorf("the sidebar expects %s and the driver no longer declares it; "+
				"restore it or drop the page, and update navigation.nats.test.ts in the same commit",
				capability)
		}
	}
	for capability := range declared {
		if !expected[capability] {
			t.Errorf("the driver declares %s and the sidebar contract does not list it; "+
				"add it to navigation.nats.test.ts in the same commit", capability)
		}
	}
}
