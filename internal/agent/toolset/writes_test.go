package toolset

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/amigoer/mq-studio/internal/model"
)

// A message body is somebody's data and can be any size. The log keeps
// enough to identify it, and every other argument as it was given.
func TestTheAuditLogKeepsEveryPublishArgumentButTheBody(t *testing.T) {
	input := publishInput{Connection: 3, Destination: "orders", Body: "card 4111 1111 1111 1111",
		Tags: "paid", Keys: "o-42"}
	kept := string(Arguments(input))
	if strings.Contains(kept, "4111") {
		t.Fatalf("the body reached the log: %s", kept)
	}
	if !strings.Contains(kept, `"bodyBytes":24`) || !strings.Contains(kept, `"bodySha256":"`) {
		t.Errorf("the body is not identified by size and digest: %s", kept)
	}

	// Every other field is kept by name, so one added to the input later is
	// not silently left out of the record.
	var fields map[string]any
	if err := json.Unmarshal([]byte(kept), &fields); err != nil {
		t.Fatal(err)
	}
	inputType := reflect.TypeFor[publishInput]()
	for index := range inputType.NumField() {
		name, _, _ := strings.Cut(inputType.Field(index).Tag.Get("json"), ",")
		if _, present := fields[name]; !present && name != "body" {
			t.Errorf("%s is not kept in the audit log", name)
		}
	}
}

// Every argument but the values is kept by name, so one added to the input
// later is not silently left out of the record.
func TestTheAuditLogKeepsEveryEntryArgumentButTheValues(t *testing.T) {
	kept := string(Arguments(addEntryInput{Connection: 3, Destination: "orders", ID: "5-1", Count: 1,
		Fields: []model.StreamField{{Name: "card", Value: "4111 1111 1111 1111"}}}))
	if strings.Contains(kept, "4111") {
		t.Fatalf("a value reached the log: %s", kept)
	}
	var fields map[string]any
	if err := json.Unmarshal([]byte(kept), &fields); err != nil {
		t.Fatal(err)
	}
	inputType := reflect.TypeFor[addEntryInput]()
	for index := range inputType.NumField() {
		name, _, _ := strings.Cut(inputType.Field(index).Tag.Get("json"), ",")
		if _, present := fields[name]; !present && name != "fields" {
			t.Errorf("%s is not kept in the audit log", name)
		}
	}
}
