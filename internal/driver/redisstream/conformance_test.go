package redisstream

import (
	"testing"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

// offlineConn is a connection with the family's declared capabilities and no
// server behind it. Conformance is a question about the type, not about a
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

// The absences are the point.
//
// Redis Streams sits between the families this app already speaks, so most of
// these are capabilities it would be easy to acquire by copying a port from a
// neighbour that looks similar. Each entry is a decision with a reason:
//
//   - partitions and reassignment: a stream is one log. There is no partition
//     to count and no replica placement to edit - a cluster moves whole slots,
//     which is not something a destination page decides.
//   - destination update: nothing about a stream is editable once it exists.
//     A maxlen is not stored anywhere; XTRIM is an action taken now, which is
//     why it gets a capability of its own rather than being an edit.
//   - dead letters: Redis has no broker-side dead-letter queue. An entry that
//     keeps failing stays in the pending list of the group that owns it, which
//     is a different object answering a similar question.
//   - delayed delivery, message track and replay: nothing to schedule, no
//     broker-side trace, and no way to hand one entry to one consumer and hear
//     what its handler returned.
//   - routing, policies, parameters, definitions, replication: RabbitMQ
//     concepts with no counterpart. Redis replication is a topology, not a set
//     of links an operator declares between brokers.
//   - namespaces: a numbered database can be neither created nor removed, and
//     a cluster has only one. It is a connection setting, which is what it is.
//   - cluster census: the totals a broker page wants would need a SCAN of the
//     whole keyspace. CensusReporter's contract is one request for the whole
//     server, and a family that has to walk must not claim it.
//   - cluster health: Redis answers PING, not a health report.
//   - quotas and transactions: no per-client throttle the server stores, and
//     MULTI is not a transactional producer holding a read position back.
//   - subscription runtime is absent for now and will arrive with XINFO
//     CONSUMERS; it is listed here so its arrival is a deliberate edit.
func TestConnDeclaresNoConceptRedisStreamDoesNotHave(t *testing.T) {
	absent := []model.Capability{
		model.CapPartitions,
		model.CapReassign,
		model.CapDestinationUpdate,
		model.CapDestinationMove,
		model.CapQueueRebalance,
		model.CapDLQ,
		model.CapDeadLetterTopology,
		model.CapMessageResend,
		model.CapMessageReplay,
		model.CapMessageTrack,
		model.CapDelayedDelivery,
		model.CapProducerInspect,
		model.CapOffsetClone,
		model.CapQueueOffset,
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
		model.CapClusterCensus,
		model.CapClusterHealth,
		model.CapQuotaList,
		model.CapQuotaAdmin,
		model.CapTransactions,
		model.CapDirectory,
		model.CapLogDirs,
		model.CapNodeWritePerm,
	}

	declared := offlineConn().Capabilities()
	for _, capability := range absent {
		if declared.Has(capability) {
			t.Errorf("%s is declared, but Redis Streams has no such concept", capability)
		}
		if _, degraded := declared.DegradedReason(capability); degraded {
			t.Errorf("%s is degraded, but Redis Streams has no such concept to degrade", capability)
		}
	}
}

// The descriptor is read before anything is dialled, so it has to stand on its
// own: a form that writes into a target nothing reads, or a capability the
// connection cannot honour, would both surface as a dead control.
func TestDescriptorIsSelfConsistent(t *testing.T) {
	descriptor := New().Descriptor()

	if descriptor.Kind != model.KindRedisStream {
		t.Errorf("kind = %q, want redis-stream", descriptor.Kind)
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

// Every value a deployment select offers has to be one deploymentOf
// recognises. A third option that fell through to the default would be a mode
// the user can pick and the driver silently ignores.
func TestEveryDeploymentOptionIsUnderstood(t *testing.T) {
	var field model.FormField
	for _, candidate := range New().Descriptor().Form {
		if candidate.Key == OptionDeployment {
			field = candidate
		}
	}
	if len(field.Options) == 0 {
		t.Fatal("the deployment field offers no options")
	}
	for _, option := range field.Options {
		if got := deploymentOf(option.Value); string(got) != option.Value {
			t.Errorf("the form offers %q, which the driver reads as %q", option.Value, got)
		}
	}
	if field.Default == "" || deploymentOf(field.Default) != DeploymentStandalone {
		t.Errorf("the deployment field defaults to %q, want standalone", field.Default)
	}
}

/*
 * The sidebar contract, from the Go side.
 *
 * The list below is the one frontend/src/mq/navigation.redis.test.ts holds,
 * and that test asserts which pages those capabilities make reachable. This
 * one asserts the driver still declares exactly them.
 *
 * Neither half is worth much alone. A capability dropped here takes a finished
 * page out of the sidebar and nothing else notices; a page added there with no
 * capability behind it is drawn and fails when opened.
 *
 * Every entry arrives with the commit that implements the port behind it, and
 * this test is what makes adding one without telling the frontend a red build.
 */
func TestCapabilitiesMatchTheSidebarContract(t *testing.T) {
	sidebar := []string{
		"destination.list",
		"destination.create",
		"destination.delete",
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
			t.Errorf("%s is newly declared; add it to navigation.redis.test.ts too", capability)
		}
	}
}
