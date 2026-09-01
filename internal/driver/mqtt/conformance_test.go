package mqtt

import (
	"testing"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

// offlineConn is a connection with the family's declared capabilities and no
// broker behind it. Conformance is a question about the type, not about a
// broker, so it must be answerable with nothing running.
func offlineConn() *Conn {
	conn := newConn(nil, clientConfig{})
	conn.capabilities = model.NewCapabilities(capabilities()...)
	return conn
}

// The UI gates on the capability list and Go gates on the interfaces. Nothing
// in the language forces those to agree, so this is what turns a disagreement
// into a build failure instead of a control that does nothing when clicked.
func TestConnDeclaresOnlyWhatItImplements(t *testing.T) {
	if problems := driver.CheckConformance(offlineConn()); len(problems) != 0 {
		for _, problem := range problems {
			t.Error(problem)
		}
	}
}

// The descriptor is read before anything is dialled, so it has to stand on its
// own: a form that writes into a target nothing reads, or a capability the
// connection cannot honour, would both surface as a dead control.
func TestDescriptorIsSelfConsistent(t *testing.T) {
	descriptor := New().Descriptor()

	if descriptor.Kind != model.KindMQTT {
		t.Errorf("kind = %q, want mqtt", descriptor.Kind)
	}
	if descriptor.DefaultPort != defaultPortTCP {
		t.Errorf("default port = %q, want %q", descriptor.DefaultPort, defaultPortTCP)
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
		OptionProtocolVersion,
		OptionTransport,
		OptionWebSocketPath,
		OptionClientID,
		OptionKeepAliveSec,
		OptionCleanStart,
		OptionSessionExpiry,
		OptionTLSCAFile,
		OptionTLSSkipVerify,
		SecretUsername,
		SecretPassword,
		OptionManagementURL,
		SecretManagementKey,
		SecretManagementSalt,
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
 * The list below is the one frontend/src/mq/navigation.mqtt.test.ts holds, and
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
		"message.publish",
		"message.liveStream",
		"cluster.topology",
		"cluster.metrics",
		"client.inspect",
		"client.close",
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
				"restore it here or take the page out of navigation.mqtt.test.ts",
				capability)
		}
	}
	for capability := range declared {
		if !expected[capability] {
			t.Errorf("the driver declares %s and the sidebar does not know about it; "+
				"add it to navigation.mqtt.test.ts too", capability)
		}
	}
}

/*
 * The absences are the point.
 *
 * MQTT has no offsets, no consumer groups, no stored history and no routing
 * topology, so most of the canonical vocabulary has nothing to attach to here.
 * Each entry below is a decision with a reason rather than an oversight, and
 * the list is what stops one being acquired later by copying a port from
 * another driver:
 *
 *   - subscriptions: an MQTT subscription is one client's topic filter, not a
 *     consumer group. There is no offset to reset, no lag to report and no
 *     membership to list, so the whole family of subscription capabilities is
 *     absent rather than answered with empty columns.
 *   - message query, byId, track and replay: nothing is stored. A message
 *     exists while it is in flight and is gone if nobody was subscribed.
 *   - liveTail: the incremental read of a durable log, which is the thing
 *     MQTT does not have. CapLiveStream is its counterpart and is declared.
 *   - dead letters and delayed delivery: neither concept exists.
 *   - publishRich: backed by RichPublisher, whose request is AMQP-shaped.
 *     MQTT's own rich publish is on MQTT's own service.
 *   - destination create, update, delete and partitions: a topic is not an
 *     object. It comes into being when something publishes to it.
 *   - routing, namespaces, policies, definitions, replication, quotas: other
 *     families' concepts with no MQTT counterpart.
 *   - access control: MQTT authorisation is entirely the broker's own, with no
 *     protocol surface and no shape shared between vendors.
 */
func TestConnDeclaresNoConceptMQTTDoesNotHave(t *testing.T) {
	absent := []model.Capability{
		model.CapDestinationCreate,
		model.CapDestinationUpdate,
		model.CapDestinationDelete,
		model.CapPartitions,
		model.CapDestinationPurge,
		model.CapDestinationMove,
		model.CapQueueRebalance,
		model.CapReassign,

		model.CapSubscriptionList,
		model.CapSubscriptionCreate,
		model.CapSubscriptionDelete,
		model.CapSubscriptionLag,
		model.CapOffsetReset,
		model.CapOffsetClone,
		model.CapQueueOffset,
		model.CapSubscriptionRuntime,

		model.CapMessageQuery,
		model.CapMessageByID,
		model.CapMessageTrack,
		model.CapMessageReplay,
		model.CapMessageResend,
		model.CapMessageLiveTail,
		model.CapDLQ,
		model.CapDeadLetterTopology,
		model.CapDelayedDelivery,
		model.CapPublishRich,
		model.CapProducerInspect,

		model.CapRouting,
		model.CapRoutingAdmin,
		model.CapNamespaceList,
		model.CapNamespaceAdmin,
		model.CapNamespaceLimits,
		model.CapPolicyList,
		model.CapPolicyAdmin,
		model.CapParameterAdmin,
		model.CapDefinitionsExport,
		model.CapDefinitionsImport,
		model.CapReplication,
		model.CapStreamClients,
		model.CapQuotaList,
		model.CapQuotaAdmin,
		model.CapTransactions,

		model.CapAccessControl,
		model.CapAccessDirectory,
		model.CapIdentityList,
		model.CapIdentityAdmin,
		model.CapIdentityPermissions,

		model.CapDirectory,
		model.CapNodeConfig,
		model.CapNodeMaintenance,
		model.CapNodeWritePerm,
		model.CapLogDirs,
		model.CapClusterCensus,
		model.CapClusterHealth,
	}

	declared := offlineConn().Capabilities()
	for _, capability := range absent {
		if declared.Has(capability) {
			t.Errorf("%s is declared, but MQTT has no such concept", capability)
		}
		if _, degraded := declared.DegradedReason(capability); degraded {
			t.Errorf("%s is degraded, but MQTT has no such concept to degrade", capability)
		}
	}
}
