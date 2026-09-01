package pulsar

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// The frontend module that has to agree with attributes.go.
const frontendAttributes = "../../../frontend/src/mq/pulsar/attributes.ts"

/*
 * The attribute keys are a contract across a language boundary, and nothing
 * else enforces it.
 *
 * Go writes them into Attributes and TypeScript reads them out. A key renamed
 * on one side does not fail to compile on either: the column simply reads
 * empty, which on a cluster page is indistinguishable from a broker with
 * nothing to report. So the two lists are compared directly, in both
 * directions - a key only Go writes is a figure nothing draws, and a key only
 * TypeScript reads is a column that can never fill.
 */
func TestAttributeKeysMatchTheFrontendModule(t *testing.T) {
	goKeys := attributeKeysFromGo(t)
	tsKeys := attributeKeysFromTypeScript(t)

	if len(goKeys) == 0 {
		t.Fatal("no attribute keys were found in attributes.go")
	}
	if len(tsKeys) == 0 {
		t.Fatalf("no attribute keys were found in %s", frontendAttributes)
	}

	for key := range goKeys {
		if !tsKeys[key] {
			t.Errorf("%q is written by the driver and read by nothing; add it to %s",
				key, frontendAttributes)
		}
	}
	for key := range tsKeys {
		if !goKeys[key] {
			t.Errorf("%q is read by the frontend and written by nothing; add it to attributes.go",
				key)
		}
	}
}

// attributeKeysFromGo reads the string values of every Attr* constant.
func attributeKeysFromGo(t *testing.T) map[string]bool {
	t.Helper()

	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "attributes.go", nil, 0)
	if err != nil {
		t.Fatalf("parse attributes.go: %v", err)
	}

	keys := map[string]bool{}
	ast.Inspect(file, func(node ast.Node) bool {
		spec, ok := node.(*ast.ValueSpec)
		if !ok {
			return true
		}
		for i, name := range spec.Names {
			if !strings.HasPrefix(name.Name, "Attr") || i >= len(spec.Values) {
				continue
			}
			literal, ok := spec.Values[i].(*ast.BasicLit)
			if !ok || literal.Kind != token.STRING {
				continue
			}
			value, err := strconv.Unquote(literal.Value)
			if err != nil {
				t.Fatalf("%s is not a string literal: %v", name.Name, err)
			}
			keys[value] = true
		}
		return true
	})
	return keys
}

// attributeKeysFromTypeScript reads the string values of every exported Attr*
// constant in the frontend module.
var tsAttribute = regexp.MustCompile(`export const Attr\w+ = "([^"]+)"`)

func attributeKeysFromTypeScript(t *testing.T) map[string]bool {
	t.Helper()

	source, err := os.ReadFile(frontendAttributes)
	if err != nil {
		t.Fatalf("read %s: %v", frontendAttributes, err)
	}

	keys := map[string]bool{}
	for _, match := range tsAttribute.FindAllStringSubmatch(string(source), -1) {
		keys[match[1]] = true
	}
	return keys
}

// Two names for one key is the mistake this catches: the compiler is happy
// with it, and the second constant silently reads the first one's column.
func TestAttributeKeysAreDistinct(t *testing.T) {
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "attributes.go", nil, 0)
	if err != nil {
		t.Fatalf("parse attributes.go: %v", err)
	}

	byKey := map[string][]string{}
	ast.Inspect(file, func(node ast.Node) bool {
		spec, ok := node.(*ast.ValueSpec)
		if !ok {
			return true
		}
		for i, name := range spec.Names {
			if !strings.HasPrefix(name.Name, "Attr") || i >= len(spec.Values) {
				continue
			}
			if literal, ok := spec.Values[i].(*ast.BasicLit); ok {
				value, _ := strconv.Unquote(literal.Value)
				byKey[value] = append(byKey[value], name.Name)
			}
		}
		return true
	})

	for key, names := range byKey {
		if len(names) > 1 {
			sort.Strings(names)
			t.Errorf("%q is the key for %s", key, strings.Join(names, " and "))
		}
	}
}
