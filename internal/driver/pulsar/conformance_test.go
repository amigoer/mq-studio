package pulsar

import (
	"testing"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

// offlineConn is a connection with the family's declared capabilities and no
// cluster behind it. Conformance is a question about the type, not about a
// broker, so it must be answerable with nothing running.
func offlineConn() *Conn {
	conn := newConn(nil, nil, nil, clientConfig{})
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
// Pulsar is close enough to both Kafka and RabbitMQ that a port can be copied
// from either and compile. This list is the set that must never be declared,
// because the concept behind it is not Pulsar's - so a later commit cannot
// quietly acquire one by reaching for the nearest driver.
//
// Each entry is a decision with a reason:
//
//   - dead letters and resend: a Pulsar dead-letter queue is an ordinary topic
//     the client library names by convention. The broker holds no binding
//     between it and the subscription that fills it, which is exactly why this
//     family answers the DLQ page through CapDeadLetterTopology instead.
//   - message track and replay: no broker-side trace, and no way to hand one
//     message to one consumer and hear what its handler returned.
//   - clone offset and queue offset: a Pulsar cursor is a ledger and an entry.
//     QueueOffsetRequest carries one int64, which cannot hold both.
//   - publish rich: PublishRequest is AMQP - an exchange, a routing key, a
//     mandatory flag. Pulsar's own send carries an ordering key, an event
//     time, a sequence id and a delivery delay, none of which have a field
//     there. The Pulsar send console goes through PulsarService instead.
//   - transactions: Pulsar has them; pulsaradmin has no way to list them.
//   - quotas: these are keyed by client. Pulsar's limits are keyed by
//     namespace, which is CapNamespaceLimits.
//   - policies, parameters, definitions, routing, replication, stream
//     clients: RabbitMQ concepts. Pulsar's geo-replication is not a shovel.
//   - reassign, log dirs, node maintenance, write permission: Kafka and
//     RocketMQ concepts. Pulsar moves load by unloading a bundle, which is not
//     an edit to a replica list.
//   - directory: GetInternalConfigurationData returns addresses, not a node
//     list anything can enumerate.
//   - client inspect and close: publishers and consumers are visible per
//     topic. The broker cannot enumerate its connections, let alone end one.
//   - census: BrokerStats answers for one broker. CensusReporter promises
//     running totals for the cluster.
//   - purge, move, rebalance: all three sit on QueueActions, and Pulsar's
//     "empty" is a per-subscription ClearBacklog, which CapOffsetReset covers.
//   - identity list and admin, access control and directory: there is no
//     principal store. A role arrives inside the token and the superuser list
//     lives in broker.conf, so there is nothing to enumerate. What Pulsar does
//     have is grants, which is CapIdentityPermissions.
func TestConnDeclaresNoConceptPulsarDoesNotHave(t *testing.T) {
	absent := []model.Capability{
		model.CapDLQ,
		model.CapMessageResend,
		model.CapMessageTrack,
		model.CapMessageReplay,
		model.CapPublishRich,
		model.CapOffsetClone,
		model.CapQueueOffset,
		model.CapTransactions,
		model.CapQuotaList,
		model.CapQuotaAdmin,
		model.CapPolicyList,
		model.CapPolicyAdmin,
		model.CapParameterAdmin,
		model.CapDefinitionsExport,
		model.CapDefinitionsImport,
		model.CapRouting,
		model.CapRoutingAdmin,
		model.CapReplication,
		model.CapStreamClients,
		model.CapReassign,
		model.CapLogDirs,
		model.CapNodeMaintenance,
		model.CapNodeWritePerm,
		model.CapDirectory,
		model.CapClientInspect,
		model.CapClientClose,
		model.CapClusterCensus,
		model.CapDestinationPurge,
		model.CapDestinationMove,
		model.CapQueueRebalance,
		model.CapIdentityList,
		model.CapIdentityAdmin,
		model.CapAccessControl,
		model.CapAccessDirectory,
	}

	declared := offlineConn().Capabilities()
	for _, capability := range absent {
		if declared.Has(capability) {
			t.Errorf("%s is declared, but Pulsar has no such concept", capability)
		}
		if _, degraded := declared.DegradedReason(capability); degraded {
			t.Errorf("%s is degraded, but Pulsar has no such concept to degrade", capability)
		}
	}
}

// The descriptor is read before anything is dialled, so it has to stand on its
// own: a form that writes into a target nothing reads, or a capability the
// connection cannot honour, would both surface as a dead control.
func TestDescriptorIsSelfConsistent(t *testing.T) {
	descriptor := New().Descriptor()

	if descriptor.Kind != model.KindPulsar {
		t.Errorf("kind = %q, want pulsar", descriptor.Kind)
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
		// A password that is not a secret would be stored in the clear beside
		// the rest of the profile.
		if field.Type == model.FieldPassword && field.Target != model.TargetSecret {
			t.Errorf("form field %q collects a password into %q", field.Key, field.Target)
		}
	}

	for _, field := range descriptor.Form {
		if field.VisibleWhen != nil && !keys[field.VisibleWhen.Field] {
			t.Errorf("form field %q is shown by %q, which the form does not collect",
				field.Key, field.VisibleWhen.Field)
		}
	}

	// The token is the only secret, and it must be reachable: a field hidden
	// behind a condition no option can satisfy collects nothing.
	var token *model.FormField
	for i, field := range descriptor.Form {
		if field.Key == SecretToken {
			token = &descriptor.Form[i]
		}
	}
	if token == nil {
		t.Fatal("the form collects no token")
	}
	if token.VisibleWhen == nil {
		t.Fatal("the token field is shown unconditionally")
	}
	if !mechanismOffers(descriptor.Form, token.VisibleWhen.Equals) {
		t.Errorf("the token is shown for %v, which the mechanism select does not offer",
			token.VisibleWhen.Equals)
	}
}

// mechanismOffers reports whether the auth select can take every value.
func mechanismOffers(form []model.FormField, values []string) bool {
	offered := make(map[string]bool)
	for _, field := range form {
		if field.Target != model.TargetAuth {
			continue
		}
		for _, option := range field.Options {
			offered[option.Value] = true
		}
	}
	for _, value := range values {
		if !offered[value] {
			return false
		}
	}
	return true
}

// The sidebar contract, mirrored by frontend/src/mq/navigation.pulsar.test.ts.
//
// That test hardcodes this same list and asserts which pages it makes
// reachable. Declaring a capability here without wiring its page there gives
// an operator a sidebar entry that opens nothing, so the two lists fail
// together or not at all. It grows one entry per commit.
func TestCapabilitiesMatchTheSidebarContract(t *testing.T) {
	want := []model.Capability{
		model.CapClusterTopology,
		model.CapClusterMetrics,
		model.CapNodeConfig,
		model.CapClusterHealth,
		model.CapNamespaceList,
		model.CapNamespaceAdmin,
		model.CapNamespaceLimits,
		model.CapDestinationList,
		model.CapDestinationCreate,
		model.CapDestinationUpdate,
		model.CapDestinationDelete,
		model.CapPartitions,
		model.CapSubscriptionList,
		model.CapSubscriptionCreate,
		model.CapSubscriptionDelete,
		model.CapSubscriptionLag,
		model.CapSubscriptionRuntime,
		model.CapOffsetReset,
		model.CapMessageQuery,
		model.CapMessageByID,
		model.CapMessageLiveTail,
		model.CapDeadLetterTopology,
	}

	got := capabilities()
	if len(got) != len(want) {
		t.Fatalf("the driver declares %d capabilities, the sidebar contract lists %d;"+
			" update navigation.pulsar.test.ts in the same commit", len(got), len(want))
	}
	for i, capability := range want {
		if got[i] != capability {
			t.Errorf("capability %d = %q, want %q", i, got[i], capability)
		}
	}
}
