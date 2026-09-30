package mcpserver

import (
	"fmt"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

/*
 * addTool registers a tool with an output schema that lets every map be null.
 *
 * The schema library the SDK infers with reads a nil slice as null and a nil
 * map as an object, while encoding/json writes both as null. So a driver that
 * left one map nil - a vhost with no limits, a message with no properties -
 * failed the whole call at output validation, on whichever family did it,
 * with an error about schemas rather than about the broker.
 */
func addTool[In, Out any](server *mcp.Server, tool *mcp.Tool, handler mcp.ToolHandlerFor[In, Out]) {
	schema, err := jsonschema.For[Out](nil)
	if err != nil {
		// The SDK panics on the same failure, and registration runs at startup
		// and in every test that lists the tools.
		panic(fmt.Sprintf("infer the output schema of %s: %v", tool.Name, err))
	}
	nullableMaps(schema)
	tool.OutputSchema = schema
	mcp.AddTool(server, tool, handler)
}

// nullableMaps widens every map in a schema to allow null. A map is an object
// whose additional properties are a schema; a struct closes them with the one
// that matches nothing.
func nullableMaps(schema *jsonschema.Schema) {
	if schema == nil {
		return
	}
	if schema.Type == "object" && schema.AdditionalProperties != nil && schema.AdditionalProperties.Not == nil {
		schema.Types = []string{"null", "object"}
		schema.Type = ""
	}
	for _, property := range schema.Properties {
		nullableMaps(property)
	}
	nullableMaps(schema.Items)
	nullableMaps(schema.AdditionalProperties)
}
