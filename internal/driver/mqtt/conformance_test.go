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
