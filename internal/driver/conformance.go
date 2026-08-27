package driver

import (
	"fmt"

	"github.com/amigoer/mq-studio/internal/model"
)

// Go code gates on the interfaces in ports.go; the UI gates on the capability
// list a Conn declares. Nothing forces those two to agree, so every driver's
// tests call CheckConformance to make a disagreement a build failure rather
// than a control that does nothing when clicked.
type capabilityBacking struct {
	capability  model.Capability
	iface       string
	implemented func(Conn) bool
}

func backings() []capabilityBacking {
	destination := func(c Conn) bool { _, ok := c.(DestinationAdmin); return ok }
	subscription := func(c Conn) bool { _, ok := c.(SubscriptionAdmin); return ok }
	progress := func(c Conn) bool { _, ok := c.(ProgressAdmin); return ok }
	reader := func(c Conn) bool { _, ok := c.(MessageReader); return ok }
	tracker := func(c Conn) bool { _, ok := c.(MessageTracker); return ok }
	deadLetter := func(c Conn) bool { _, ok := c.(DeadLetterReader); return ok }
	publisher := func(c Conn) bool { _, ok := c.(MessagePublisher); return ok }
	cluster := func(c Conn) bool { _, ok := c.(ClusterAdmin); return ok }
	access := func(c Conn) bool { _, ok := c.(AccessAdmin); return ok }
	routing := func(c Conn) bool { _, ok := c.(RoutingAdmin); return ok }
	stats := func(c Conn) bool { _, ok := c.(DestinationStats); return ok }

	return []capabilityBacking{
		{model.CapDestinationList, "DestinationAdmin", destination},
		{model.CapDestinationCreate, "DestinationAdmin", destination},
		{model.CapDestinationUpdate, "DestinationAdmin", destination},
		{model.CapDestinationDelete, "DestinationAdmin", destination},
		{model.CapPartitions, "DestinationStats", stats},

		{model.CapSubscriptionList, "SubscriptionAdmin", subscription},
		{model.CapSubscriptionCreate, "SubscriptionAdmin", subscription},
		{model.CapSubscriptionDelete, "SubscriptionAdmin", subscription},
		{model.CapSubscriptionLag, "SubscriptionAdmin", subscription},
		{model.CapOffsetReset, "ProgressAdmin", progress},

		{model.CapMessageQuery, "MessageReader", reader},
		{model.CapMessageByID, "MessageReader", reader},
		{model.CapMessageTrack, "MessageTracker", tracker},
		{model.CapDLQ, "DeadLetterReader", deadLetter},
		{model.CapMessageResend, "DeadLetterReader", deadLetter},
		{model.CapPublish, "MessagePublisher", publisher},
		{model.CapDelayedDelivery, "MessagePublisher", publisher},

		{model.CapClusterTopology, "ClusterAdmin", cluster},
		{model.CapClusterMetrics, "ClusterAdmin", cluster},
		{model.CapAccessControl, "AccessAdmin", access},
		{model.CapRouting, "RoutingAdmin", routing},
	}
}

// CheckConformance reports every way a connection's declared capabilities and
// its implemented interfaces disagree. An empty result means they match.
//
// model.CapMessageLiveTail has no backing interface yet, because streaming
// from Go to the renderer is not built; it is therefore not checked.
func CheckConformance(conn Conn) []error {
	capabilities := conn.Capabilities()
	problems := make([]error, 0)

	// A capability cannot be supported and degraded at once: the UI would have
	// to choose between rendering the control and explaining its absence.
	for capability := range capabilities.Degraded {
		if capabilities.Has(capability) {
			problems = append(problems, fmt.Errorf(
				"%s: %s is listed as both supported and degraded", conn.Kind(), capability))
		}
	}

	implementedIfaces := make(map[string]bool)
	declaredIfaces := make(map[string]bool)

	for _, backing := range backings() {
		implemented := backing.implemented(conn)
		if implemented {
			implementedIfaces[backing.iface] = true
		}
		if !capabilities.Has(backing.capability) {
			continue
		}
		declaredIfaces[backing.iface] = true
		if !implemented {
			problems = append(problems, fmt.Errorf(
				"%s: declares %s but does not implement %s",
				conn.Kind(), backing.capability, backing.iface))
		}
	}

	for iface := range implementedIfaces {
		if !declaredIfaces[iface] {
			problems = append(problems, fmt.Errorf(
				"%s: implements %s but declares none of its capabilities",
				conn.Kind(), iface))
		}
	}
	return problems
}
