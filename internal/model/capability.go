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
	// CapSubscriptionRuntime is asking a connected consumer what it is doing:
	// which queues it holds and how fast it is getting through them. Only a
	// live client can answer, so a family without client introspection - or a
	// group with nothing connected - simply has no answer.
	CapSubscriptionRuntime Capability = "subscription.runtime"

	CapMessageQuery    Capability = "message.query"
	CapMessageByID     Capability = "message.byId"
	CapMessageTrack    Capability = "message.track"
	CapMessageResend   Capability = "message.resend"
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
	// CapNodeConfig is reading one node's effective settings - what it is
	// actually running with, which is not always what its config file says.
	CapNodeConfig     Capability = "cluster.nodeConfig"
	CapClusterMetrics Capability = "cluster.metrics"
	CapAccessControl  Capability = "access.control"
	CapRouting        Capability = "routing.exchanges"
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
