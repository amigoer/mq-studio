package mcpserver

import (
	"testing"

	"github.com/amigoer/mq-studio/internal/agent/catalog"
)

// Every map in every answer has to be allowed to be null, because that is what
// encoding/json writes for a nil one. Read off what the protocol hands a
// client, so a tool registered around addTool is caught too.
func TestEveryMapInAToolAnswerMayBeNull(t *testing.T) {
	for name, tool := range listed(t, catalog.BlastDestructive) {
		if tool.OutputSchema == nil {
			t.Errorf("%s declares no output schema", name)
			continue
		}
		var walk func(path string, node any)
		walk = func(path string, node any) {
			object, ok := node.(map[string]any)
			if !ok {
				return
			}
			if extra, isMap := object["additionalProperties"]; isMap && object["type"] == "object" && !closed(extra) {
				t.Errorf("%s: the map at %s cannot be null, and a nil one fails the whole call", name, path)
			}
			if properties, ok := object["properties"].(map[string]any); ok {
				for key, property := range properties {
					walk(path+"."+key, property)
				}
			}
			walk(path+"[]", object["items"])
			walk(path+"{}", object["additionalProperties"])
		}
		walk(name, tool.OutputSchema)
	}
}

// closed reports the schema a struct uses to forbid properties it did not
// declare, which is what tells one apart from a map.
func closed(schema any) bool {
	if schema == false {
		return true
	}
	object, ok := schema.(map[string]any)
	if !ok {
		return false
	}
	_, forbids := object["not"]
	return forbids
}
