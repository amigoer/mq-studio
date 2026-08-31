package kafka

import (
	"testing"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

// offlineConn is a connection with the family's declared capabilities and no
// cluster behind it. Conformance is a question about the type, not about a
// broker, so it must be answerable with nothing running.
func offlineConn() *Conn {
	conn := newConn(nil, nil, clientConfig{})
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

// The absences are the point.
//
// Kafka is where offsets and partitions come from, so the capabilities
// RabbitMQ has to refuse are the ones Kafka will eventually claim. This list
// is the opposite set: concepts Kafka genuinely does not have, which a later
// commit could quietly acquire by copying a port from another driver.
//
// Each entry is a decision with a reason, not an oversight:
//
//   - dead letters: Kafka has no broker-side dead-letter queue. The .DLT and
//     -dlq suffixes are framework conventions, not Kafka's.
//   - delayed delivery: there is no such thing to schedule.
//   - message track and replay: no broker-side trace, and no way to hand one
//     record to one consumer and hear what its handler returned.
//   - routing: records go to a partition of a named topic, so there is no
//     exchange and nothing to bind.
//   - namespaces, policies, parameters, definitions, replication: RabbitMQ
//     concepts with no Kafka counterpart. Mirroring is a Connect connector.
//   - client inspect and close: the admin protocol cannot enumerate the
//     connections a broker holds, let alone end one.
//   - cluster census and health: no running totals and no health endpoint.
//     Kafka's health is derived from partition state, not reported.
//   - destination move and rebalance, subscription create: no server-side
//     move, and a group exists once something commits an offset to it.
func TestConnDeclaresNoConceptKafkaDoesNotHave(t *testing.T) {
	absent := []model.Capability{
		model.CapDLQ,
		model.CapDeadLetterTopology,
		model.CapMessageResend,
		model.CapMessageReplay,
		model.CapMessageTrack,
		model.CapDelayedDelivery,
		model.CapDestinationMove,
		model.CapSubscriptionCreate,
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
		model.CapClientInspect,
		model.CapClientClose,
		model.CapClusterCensus,
		model.CapClusterHealth,
		model.CapNodeMaintenance,
		model.CapNodeWritePerm,
	}

	declared := offlineConn().Capabilities()
	for _, capability := range absent {
		if declared.Has(capability) {
			t.Errorf("%s is declared, but Kafka has no such concept", capability)
		}
		if _, degraded := declared.DegradedReason(capability); degraded {
			t.Errorf("%s is degraded, but Kafka has no such concept to degrade", capability)
		}
	}
}

// The descriptor is read before anything is dialled, so it has to stand on its
// own: a form that writes into a target nothing reads, or a capability the
// connection cannot honour, would both surface as a dead control.
func TestDescriptorIsSelfConsistent(t *testing.T) {
	descriptor := New().Descriptor()

	if descriptor.Kind != model.KindKafka {
		t.Errorf("kind = %q, want kafka", descriptor.Kind)
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

/*
 * The sidebar contract, from the Go side.
 *
 * The list below is the one frontend/src/mq/navigation.kafka.test.ts holds,
 * and that test asserts which pages those capabilities make reachable. This
 * one asserts the driver still declares exactly them.
 *
 * Neither half is worth much alone. A capability dropped here takes a finished
 * page out of the sidebar and nothing else notices; a page added there with no
 * capability behind it is drawn and fails when opened. Together they cannot
 * drift without one of them going red, which is the only thing standing
 * between a working driver and a working app.
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
		"destination.purge",
		"destination.rebalance",
		"destination.reassign",

		"subscription.list",
		"subscription.delete",
		"subscription.lag",
		"subscription.resetOffset",
		"subscription.cloneOffset",
		"subscription.queueOffset",

		"message.query",
		"message.byId",
		"message.liveTail",
		"message.publish",

		"cluster.topology",
		"cluster.metrics",
		"cluster.nodeConfig",
		"cluster.logDirs",

		"access.directory",
		"quota.list",
		"quota.admin",
		"transaction.list",
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
			t.Errorf("%s is no longer declared; its page has left the sidebar", capability)
		}
	}
	for capability := range declared {
		if !expected[capability] {
			t.Errorf("%s is newly declared; add it to navigation.kafka.test.ts too", capability)
		}
	}
}
