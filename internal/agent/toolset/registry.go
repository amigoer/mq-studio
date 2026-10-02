package toolset

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"sync"

	"github.com/google/jsonschema-go/jsonschema"

	"github.com/amigoer/mq-studio/internal/agent/catalog"
	"github.com/amigoer/mq-studio/internal/model"
)

// Tool is one operation as an agent is offered it.
type Tool struct {
	// Name is what a caller calls it by.
	Name string
	// Title is a short name for a person reading a list of them.
	Title       string
	Description string
	// Operation is the catalogue operation it performs. The two tools about
	// the installation itself reach no driver, and have none.
	Operation string
	// Blast is how much one call can do. It comes from the catalogue: two
	// descriptions of the damage a call can do would eventually disagree.
	Blast        catalog.Blast
	InputSchema  *jsonschema.Schema
	OutputSchema *jsonschema.Schema

	input  *jsonschema.Resolved
	decode func(json.RawMessage) (any, error)
	run    func(context.Context, *Env, any) (any, error)
}

// Decode reads arguments into the tool's input, unchecked: for a transport
// that has already checked them against InputSchema.
func (t Tool) Decode(arguments json.RawMessage) (any, error) {
	return t.decode(arguments)
}

// Run performs the tool on an input Decode returned.
func (t Tool) Run(ctx context.Context, env *Env, input any) (any, error) {
	return t.run(ctx, env, input)
}

/*
 * Check reads arguments as a model sent them into the tool's input: defaults
 * applied, then the whole value validated, the way the MCP SDK checks them
 * before a handler there sees a call. Every input schema is closed, so a
 * property the input does not declare is refused rather than decoded into
 * nothing.
 *
 * It is separate from running so a caller can look at what a write would do,
 * and ask a person about it, before anything is done.
 */
func (t Tool) Check(arguments json.RawMessage) (any, error) {
	value := map[string]any{}
	if len(arguments) > 0 {
		if err := json.Unmarshal(arguments, &value); err != nil {
			return nil, fmt.Errorf("unmarshaling arguments: %w", err)
		}
	}
	// A JSON null decodes to a nil map, which takes no defaults.
	if value == nil {
		value = map[string]any{}
	}
	var checked any = value
	if err := t.input.ApplyDefaults(&checked); err != nil {
		return nil, fmt.Errorf("applying schema defaults: %w", err)
	}
	if err := t.input.Validate(&checked); err != nil {
		return nil, fmt.Errorf("validating arguments: %w", err)
	}
	encoded, err := json.Marshal(checked)
	if err != nil {
		return nil, err
	}
	return t.Decode(encoded)
}

// Call checks arguments as a model sent them and performs the tool.
func (t Tool) Call(ctx context.Context, env *Env, arguments json.RawMessage) (any, error) {
	input, err := t.Check(arguments)
	if err != nil {
		return nil, err
	}
	return t.Run(ctx, env, input)
}

// Targeted is an input that names the connection it acts on. Every write's is
// one, so a write is checked and recorded against the connection it reaches.
type Targeted interface{ Target() int }

// Confirmable is the input of a tool a person confirms. It names the
// destination that would be destroyed, which is what the question is about.
type Confirmable interface{ Destination() model.DestinationRef }

// Withholding is an input carrying content an audit log does not copy. What
// Logged returns is kept in its place.
type Withholding interface{ Logged() any }

// Written is a write's answer as an audit log keeps it: what changed, and
// whatever the broker returned to name what was written.
type Written interface {
	Recorded() (changed, reference string)
}

// Arguments is what a write was called with, as an audit log keeps it.
func Arguments(input any) json.RawMessage {
	if content, ok := input.(Withholding); ok {
		input = content.Logged()
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		return nil
	}
	return encoded
}

// Canonical is a call's arguments as an answer to a question is checked
// against them. The input is a struct, so its fields always marshal in the
// same order.
func Canonical(input any) string {
	encoded, err := json.Marshal(input)
	if err != nil {
		return ""
	}
	return string(encoded)
}

// digest identifies content without keeping it.
func digest(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}

// All is every tool, in the order a transport offers them.
func All() []Tool {
	return slices.Clone(registry())
}

// Lookup finds a tool by name.
func Lookup(name string) (Tool, bool) {
	for _, tool := range registry() {
		if tool.Name == name {
			return tool, true
		}
	}
	return Tool{}, false
}

/*
 * define builds a tool from its handler, and refuses one that could not be
 * offered safely.
 *
 * The schemas are inferred the way the MCP SDK infers them, so a tool reads
 * the same whichever transport offers it. A write has to name the connection
 * it reaches, or it could be neither checked nor recorded, and a destructive
 * one has to name what it destroys and have a question to put about it. The
 * registry is built on first use, at startup and in every test that lists the
 * tools, so a tool that breaks one of these fails there.
 */
func define[In, Out any](
	name, title, operationID, description string, handler func(*Env, context.Context, In) (Out, error),
) Tool {
	blast := catalog.BlastRead
	if operationID != "" {
		operation, known := catalog.Find(operationID)
		if !known {
			panic(fmt.Sprintf("%s performs %q, which is not a catalogue operation", name, operationID))
		}
		blast = operation.Blast
	}
	var zero In
	if blast != catalog.BlastRead {
		if _, names := any(zero).(Targeted); !names {
			panic(fmt.Sprintf("%s writes, and its input names no connection to check or record", name))
		}
	}
	if blast == catalog.BlastDestructive {
		if _, names := any(zero).(Confirmable); !names || questions[operationID] == "" {
			panic(fmt.Sprintf("%s destroys, and there is no question to put to a person first", name))
		}
	}

	input, err := jsonschema.ForType(reflect.TypeFor[In](), &jsonschema.ForOptions{})
	if err != nil {
		panic(fmt.Sprintf("infer the input schema of %s: %v", name, err))
	}
	resolved, err := input.Resolve(&jsonschema.ResolveOptions{ValidateDefaults: true})
	if err != nil {
		panic(fmt.Sprintf("resolve the input schema of %s: %v", name, err))
	}
	output, err := jsonschema.For[Out](nil)
	if err != nil {
		panic(fmt.Sprintf("infer the output schema of %s: %v", name, err))
	}
	nullableMaps(output)

	return Tool{
		Name:         name,
		Title:        title,
		Description:  description,
		Operation:    operationID,
		Blast:        blast,
		InputSchema:  input,
		OutputSchema: output,
		input:        resolved,
		decode: func(arguments json.RawMessage) (any, error) {
			var decoded In
			if len(arguments) > 0 {
				if err := json.Unmarshal(arguments, &decoded); err != nil {
					return nil, err
				}
			}
			return decoded, nil
		},
		run: func(ctx context.Context, env *Env, input any) (any, error) {
			typed, ok := input.(In)
			if !ok {
				return nil, fmt.Errorf("%s was handed a %T to run on", name, input)
			}
			output, err := handler(env, ctx, typed)
			if err != nil {
				return nil, err
			}
			return output, nil
		},
	}
}

/*
 * nullableMaps widens every map in an output schema to allow null.
 *
 * The schema library reads a nil slice as null and a nil map as an object,
 * while encoding/json writes both as null. So a driver that left one map nil -
 * a vhost with no limits, a message with no properties - failed the whole call
 * at output validation, on whichever family did it, with an error about
 * schemas rather than about the broker. A map is an object whose additional
 * properties are a schema; a struct closes them with the one that matches
 * nothing.
 */
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

// registry is built on first use rather than at init, so a process that never
// offers a tool never infers a schema.
var registry = sync.OnceValue(definitions)
