package toolset

import (
	"strings"
	"testing"

	"github.com/amigoer/mq-studio/internal/model"
)

// fill replaces in one pass, so a destination named like a placeholder
// appears as named rather than as whatever that placeholder holds.
func TestFillLeavesAPlaceholderInAValueAlone(t *testing.T) {
	got := fill("Delete {{destination}} on {{connection}}?",
		map[string]string{"destination": "{{connection}}", "connection": "scratch"})
	if got != "Delete {{connection}} on scratch?" {
		t.Errorf("got %q", got)
	}
}

// A person approving a write reads what the connection says it leaves behind,
// and is not asked about one the connection could not make at all.
func TestConsequenceIsReadBeforeAnybodyIsAsked(t *testing.T) {
	create, _ := Lookup("destination_create")
	input := createDestinationInput{Connection: 1, Name: "orders"}

	e := envWith(&fakeConn{kind: model.KindRabbitMQ, capabilities: model.NewCapabilities(model.CapDestinationCreate).
		WithCaveat(model.CapDestinationCreate, "mq.rabbitmq.caveat.browseAltersQueue")})
	if caveat, err := e.Consequence(create, input); err != nil || caveat != "browsing requeues the message flagged redelivered" {
		t.Errorf("consequence %q, %v", caveat, err)
	}

	e = envWith(&fakeConn{kind: model.KindRabbitMQ, capabilities: model.NewCapabilities(model.CapDestinationList)})
	if _, err := e.Consequence(create, input); err == nil || !strings.Contains(err.Error(), "no concept of") {
		t.Errorf("a write the connection cannot make: %v", err)
	}
}
