package model

// Capability names one operation the UI gates on.
//
// The values cross the bridge and are matched as literals in the renderer, so
// renaming one means changing frontend/src/mq/capabilities.ts in the same
// commit.
type Capability string

const (
	CapDestinationList   Capability = "destination.list"
	CapDestinationCreate Capability = "destination.create"
	CapDestinationUpdate Capability = "destination.update"
	CapDestinationDelete Capability = "destination.delete"
	CapPartitions        Capability = "destination.partitions"

	CapSubscriptionList   Capability = "subscription.list"
	CapSubscriptionCreate Capability = "subscription.create"
	CapSubscriptionDelete Capability = "subscription.delete"
	CapSubscriptionLag    Capability = "subscription.lag"
	CapOffsetReset        Capability = "subscription.resetOffset"
	// CapOffsetClone is copying one subscription's read position onto another.
	// It is not CapOffsetReset: reset moves a group in time, this hands a
	// second group the first one's exact per-queue positions.
	CapOffsetClone Capability = "subscription.cloneOffset"
	// CapQueueOffset is writing one queue's read position directly. Distinct
	// from CapOffsetReset, which moves a whole subscription to a moment in
	// time and lets the broker find each queue's position for itself.
	CapQueueOffset Capability = "subscription.queueOffset"
	// CapSubscriptionRuntime is asking a connected consumer what it is doing:
	// which queues it holds and how fast it is getting through them. Only a
	// live client can answer, so a family without client introspection - or a
	// group with nothing connected - simply has no answer.
	CapSubscriptionRuntime Capability = "subscription.runtime"

	CapMessageQuery  Capability = "message.query"
	CapMessageByID   Capability = "message.byId"
	CapMessageTrack  Capability = "message.track"
	CapMessageResend Capability = "message.resend"
	// CapMessageReplay is handing one message back to one connected consumer
	// and reporting what its handler returned. Distinct from CapMessageResend,
	// which puts a copy back on the retry path for whoever picks it up.
	CapMessageReplay   Capability = "message.replay"
	CapMessageLiveTail Capability = "message.liveTail"
	CapDLQ             Capability = "message.dlq"
	CapPublish         Capability = "message.publish"
	// CapProducerInspect is asking who is currently publishing. It needs a
	// producer group to ask about: the broker tracks connections per group and
	// offers no way to enumerate the groups themselves.
	CapProducerInspect Capability = "message.producerInspect"
	// CapDelayedDelivery is scheduling a message for later. RocketMQ has delay
	// levels, Kafka has nothing, RabbitMQ needs a plugin.
	CapDelayedDelivery Capability = "message.delayedDelivery"

	CapClusterTopology Capability = "cluster.topology"
	// CapDirectory is listing the discovery tier a cluster is reached
	// through. Families whose nodes find each other have no such tier and do
	// not report it.
	CapDirectory Capability = "cluster.directory"
	// CapNodeConfig is reading the effective settings of a node or of the
	// cluster's discovery tier - what they are actually running with, which is
	// not always what their config files say.
	CapNodeConfig Capability = "cluster.nodeConfig"
	// CapNodeMaintenance is running a broker's own housekeeping on demand -
	// reclaiming space the broker would otherwise get to on its own schedule.
	CapNodeMaintenance Capability = "cluster.nodeMaintenance"
	// CapNodeWritePerm is taking a node out of the write path and putting it
	// back, which is how a broker is drained before it is stopped.
	CapNodeWritePerm  Capability = "cluster.writePerm"
	CapClusterMetrics Capability = "cluster.metrics"

	// CapClusterCensus is a broker that keeps its own running totals - object
	// counts, queued depth and message rates for the whole cluster in one
	// answer. A family whose figures can only be assembled by walking every
	// destination does not have it.
	CapClusterCensus Capability = "cluster.census"

	// CapClientInspect is a broker that can name the transport connections and
	// channels open against it. Families that expose producers and consumers
	// but not the sessions underneath them do not have it.
	CapClientInspect Capability = "client.inspect"

	// CapClusterHealth is a broker that answers questions about its own
	// health, rather than one whose health has to be inferred from its
	// metrics.
	CapClusterHealth Capability = "cluster.health"

	// CapDeadLetterTopology is a family whose dead-letter queues are ordinary
	// queues something else points at, found by walking the topology, rather
	// than a per-group topic the broker names for you. Both answer the same
	// page; neither can answer it the other's way.
	CapDeadLetterTopology Capability = "message.dlqTopology"
	CapAccessControl      Capability = "access.control"
	// CapAccessDirectory is identity-based access control: principals the
	// broker authenticates and rules attached to a subject. Distinct from
	// CapAccessControl, which is the credential-carrying kind a broker will
	// take a write for and never read back.
	CapAccessDirectory Capability = "access.directory"
	CapRouting         Capability = "routing.exchanges"
)

// Capabilities is what one live connection can actually do.
//
// Three states reach the UI, and they must stay distinguishable: a capability
// in Supported renders normally; one in Degraded renders disabled with the
// reason; one in neither is hidden outright. Silent absence and explained
// absence look identical to a user otherwise, which makes a deliberately
// limited endpoint read as a bug.
type Capabilities struct {
	Supported []Capability `json:"supported"`

	// Degraded explains a capability the family has but this endpoint lacks.
	// A RocketMQ Proxy endpoint is a data plane only, so it reports no topic
	// listing, no cluster topology and no ACL.
	Degraded map[Capability]string `json:"degraded"`

	// Caveats annotates a capability that works but has a consequence worth
	// warning about. Browsing a RabbitMQ queue goes through basic.get, which
	// alters queue state even when the message is requeued.
	Caveats map[Capability]string `json:"caveats"`
}

// NewCapabilities builds a capability set with no degraded entries or caveats.
func NewCapabilities(supported ...Capability) Capabilities {
	return Capabilities{Supported: supported}
}

// Has reports whether the connection supports the capability.
func (c Capabilities) Has(capability Capability) bool {
	for _, supported := range c.Supported {
		if supported == capability {
			return true
		}
	}
	return false
}

// DegradedReason returns why an unsupported capability is missing here.
func (c Capabilities) DegradedReason(capability Capability) (string, bool) {
	reason, ok := c.Degraded[capability]
	return reason, ok
}

// Caveat returns the warning attached to a supported capability.
func (c Capabilities) Caveat(capability Capability) (string, bool) {
	caveat, ok := c.Caveats[capability]
	return caveat, ok
}

// WithDegraded returns a copy that reports capability as unavailable here.
// It also drops it from Supported, so the two can never disagree.
func (c Capabilities) WithDegraded(capability Capability, reason string) Capabilities {
	supported := make([]Capability, 0, len(c.Supported))
	for _, current := range c.Supported {
		if current != capability {
			supported = append(supported, current)
		}
	}
	c.Supported = supported
	c.Degraded = cloneCapabilityNotes(c.Degraded)
	c.Degraded[capability] = reason
	return c
}

// WithCaveat returns a copy that keeps capability supported but warns about it.
func (c Capabilities) WithCaveat(capability Capability, caveat string) Capabilities {
	c.Caveats = cloneCapabilityNotes(c.Caveats)
	c.Caveats[capability] = caveat
	return c
}

func cloneCapabilityNotes(notes map[Capability]string) map[Capability]string {
	cloned := make(map[Capability]string, len(notes)+1)
	for capability, note := range notes {
		cloned[capability] = note
	}
	return cloned
}
