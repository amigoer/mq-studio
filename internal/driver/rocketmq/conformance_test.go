package rocketmq

import (
	"testing"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

// The UI gates on the capability list and Go gates on the interfaces. Nothing
// in the language forces those to agree, so this is what turns a disagreement
// into a build failure instead of a control that does nothing when clicked.
func TestConnDeclaresOnlyWhatItImplements(t *testing.T) {
	conn := NewConn(nil, ClientConfig{}, "ns:9876")

	if problems := driver.CheckConformance(conn); len(problems) != 0 {
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

	if descriptor.Kind != model.KindRocketMQ {
		t.Errorf("kind = %q, want rocketmq", descriptor.Kind)
	}
	if len(descriptor.Form) == 0 {
		t.Fatal("descriptor carries no connection form")
	}
	for _, field := range descriptor.Form {
		if field.Key == "" || field.LabelKey == "" {
			t.Errorf("form field is missing a key or label: %#v", field)
		}
		switch field.Target {
		case model.TargetEndpoints, model.TargetOption, model.TargetSecret, model.TargetAuth:
		default:
			t.Errorf("form field %q writes into an unknown target %q", field.Key, field.Target)
		}
	}

	// MaxCapabilities is the family's best case, so a connection may report a
	// capability as degraded instead of supported - that is the middle state
	// working, not a disagreement. What it may not do is drop one entirely.
	live := NewConn(nil, ClientConfig{}, "ns:9876").Capabilities()
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
