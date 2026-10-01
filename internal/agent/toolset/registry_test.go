package toolset

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

/*
 * A model's arguments reach Call with nothing in between, so Call is what
 * stands where the MCP SDK stands for the server: a missing argument, one of
 * the wrong type, or one the tool does not take is refused before the tool
 * runs, not decoded into a zero value it then acts on.
 */
func TestCallRefusesArgumentsTheSchemaDoesNot(t *testing.T) {
	ran := false
	conn := &fakeConn{kind: model.KindRabbitMQ, capabilities: model.NewCapabilities(model.CapDestinationList)}
	e := envWith(conn)
	e.Open = func(int) (driver.Conn, error) {
		ran = true
		return conn, nil
	}
	tool, ok := Lookup("capabilities_describe")
	if !ok {
		t.Fatal("capabilities_describe is not defined")
	}

	for name, arguments := range map[string]string{
		"missing":   `{}`,
		"mistyped":  `{"connection":"one"}`,
		"unknown":   `{"connection":1,"namespace":"billing"}`,
		"misspelt":  `{"Connection":1}`,
		"not a map": `[1]`,
	} {
		if _, err := tool.Call(context.Background(), e, json.RawMessage(arguments)); err == nil {
			t.Errorf("%s: %s was accepted", name, arguments)
		}
	}
	if ran {
		t.Fatal("a call with arguments the schema refuses reached the connection")
	}

	output, err := tool.Call(context.Background(), e, json.RawMessage(`{"connection":1}`))
	if err != nil {
		t.Fatalf("a well-formed call was refused: %v", err)
	}
	if described, ok := output.(describeOutput); !ok || described.Family != string(model.KindRabbitMQ) {
		t.Errorf("answered %#v", output)
	}
}

// A tool that takes nothing is called with nothing, or with null: both are how
// a model says it has no arguments to give.
func TestCallTakesNoArgumentsAsNoArguments(t *testing.T) {
	e := &Env{Services: inspectedServices(t, &inspectedConn{})}
	tool, _ := Lookup("connections_list")
	for _, arguments := range []string{``, `{}`, `null`} {
		if _, err := tool.Call(context.Background(), e, json.RawMessage(arguments)); err != nil {
			t.Errorf("%q: %v", arguments, err)
		}
	}
}

// The SDK and Call both validate first and decode after, which is only the
// same as decoding strictly while no schema leaves room for a property the
// input does not declare. A key that differs from a field only in case would
// otherwise pass the check and still land in the field.
func TestEveryInputSchemaIsClosed(t *testing.T) {
	for _, tool := range All() {
		schema := tool.InputSchema
		if schema == nil || schema.Type != "object" {
			t.Errorf("%s takes something other than an object", tool.Name)
			continue
		}
		if schema.AdditionalProperties == nil || schema.AdditionalProperties.Not == nil {
			t.Errorf("%s accepts properties it does not declare", tool.Name)
		}
	}
}

func TestEveryToolDeclaresWhatItAnswers(t *testing.T) {
	for _, tool := range All() {
		if tool.OutputSchema == nil {
			t.Errorf("%s declares no output schema", tool.Name)
		}
	}
}

/*
 * What a tool may do is checked when it is defined, not when a model first
 * calls it: a write that named no connection could be neither held to an
 * allowance nor recorded, and a destructive one with nothing to put to a
 * person could not be confirmed.
 */
func TestDefineRefusesAWriteItCouldNotCheck(t *testing.T) {
	refused := func(name string, define func()) {
		t.Helper()
		defer func() {
			if recover() == nil {
				t.Errorf("%s was defined", name)
			}
		}()
		define()
	}
	refused("a write naming no connection", func() {
		define("orphan", "Orphan", "destination.create", "writes somewhere",
			func(*Env, context.Context, struct{}) (struct{}, error) { return struct{}{}, nil })
	})
	refused("a destruction with no question", func() {
		define("silent", "Silent", "destination.purge", "destroys quietly",
			func(*Env, context.Context, publishInput) (struct{}, error) { return struct{}{}, nil })
	})
	refused("an operation the catalogue does not know", func() {
		define("invented", "Invented", "destination.invent", "does what nothing does",
			func(*Env, context.Context, connectionInput) (struct{}, error) { return struct{}{}, nil })
	})
}

// A destructive call's question is the window's own, worded from the target
// and the connection it is on, whichever transport puts it to the person.
func TestTheQuestionNamesWhatWouldBeDestroyed(t *testing.T) {
	conn := &namespacedConn{fakeConn: fakeConn{kind: model.KindRabbitMQ}, scoped: true, depth: 42}
	e := namespacedEnv(t, conn)
	profile := model.ConnectionProfile{
		Name: "scratch", Kind: model.KindRabbitMQ, Endpoints: "http://scratch.invalid:15672", TimeoutSec: 5,
		Auth: model.AuthConfig{Mechanism: model.AuthPlain},
	}
	profile.SetSecret("username", "guest")
	profile.SetSecret("password", "guest")
	stored, err := e.Services.Connections.AddConnection(profile)
	if err != nil {
		t.Fatal(err)
	}
	conn.capabilities = model.NewCapabilities(model.CapDestinationList, model.CapDestinationDelete)
	tool, _ := Lookup("destination_delete")

	question, shown, err := e.Question(context.Background(), tool,
		destinationTargetInput{Connection: stored.ID, Name: "orders", Namespace: "billing"})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`orders in "billing"`, "scratch", "rabbitmq", "42"} {
		if !strings.Contains(question, want) {
			t.Errorf("the question does not name %s: %s", want, question)
		}
	}
	if shown.ID != stored.ID || shown.Name != "scratch" {
		t.Errorf("the question was put about %+v", shown)
	}
	if strings.Contains(question, "{{") {
		t.Errorf("a placeholder reached the person: %s", question)
	}
}
