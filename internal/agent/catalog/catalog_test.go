package catalog

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"testing"

	"github.com/amigoer/mq-studio/internal/driver"
	"github.com/amigoer/mq-studio/internal/model"
)

func TestOperationsAreWellFormed(t *testing.T) {
	seen := make(map[string]bool, len(Operations))
	for _, operation := range Operations {
		if seen[operation.ID] {
			t.Errorf("%s is declared twice", operation.ID)
		}
		seen[operation.ID] = true

		switch {
		case operation.ID == "":
			t.Errorf("%#v has no id", operation)
		case operation.Capability == "":
			t.Errorf("%s has no capability", operation.ID)
		case operation.Port == "" || operation.Method == "":
			t.Errorf("%s does not name a port method", operation.ID)
		case operation.Summary == "":
			t.Errorf("%s has no summary, so a caller has only its id to go on", operation.ID)
		}

		switch operation.Blast {
		case BlastRead, BlastMutate, BlastDestructive:
		default:
			t.Errorf("%s has blast radius %q, which is not one of the three", operation.ID, operation.Blast)
		}

		// Both set means two descriptions of one argument list, and the
		// server would have to pick one.
		if operation.Request != nil && len(operation.Params) > 0 {
			t.Errorf("%s declares both a request type and loose params", operation.ID)
		}
		for _, param := range operation.Params {
			if param.Name == "" || param.Type == nil || param.Summary == "" {
				t.Errorf("%s has an incomplete param: %#v", operation.ID, param)
			}
		}
	}
}

// The two ports that carry no capability of their own, and what each rides on.
// A third would mean a capability is reachable through an interface
// CheckConformance never asserts, so the test below pins the list rather than
// skipping anything unbacked.
var riders = map[string]model.Capability{
	"QueueGuardedRemover": model.CapDestinationDelete,
	"SubscriptionStats":   model.CapSubscriptionLag,
}

// Go gates on the interfaces, the UI gates on the capability, and this file
// claims a pairing of the two. CheckConformance already makes the first two
// agree; this is what stops the catalogue naming a third thing.
func TestEveryOperationIsBackedByItsPort(t *testing.T) {
	backed := make(map[model.Capability]map[string]bool)
	for _, row := range driver.CapabilityPorts() {
		if backed[row.Capability] == nil {
			backed[row.Capability] = make(map[string]bool)
		}
		backed[row.Capability][row.Port] = true
	}

	for _, operation := range Operations {
		if rides, ok := riders[operation.Port]; ok {
			if rides != operation.Capability {
				t.Errorf("%s: %s rides on %s, not on %s",
					operation.ID, operation.Port, rides, operation.Capability)
			}
			continue
		}
		ports, ok := backed[operation.Capability]
		if !ok {
			t.Errorf("%s: %s is backed by no interface at all", operation.ID, operation.Capability)
			continue
		}
		if !ports[operation.Port] {
			t.Errorf("%s: %s is backed by %v, not by %s",
				operation.ID, operation.Capability, keys(ports), operation.Port)
		}
	}
}

// A capability with no operation is a page the application can work and a
// caller reading this cannot reach. CheckCoverage catches it per connection;
// this catches it for the whole table, before any driver is involved.
func TestEveryCapabilityHasAnOperation(t *testing.T) {
	covered := make(map[model.Capability]bool, len(Operations))
	for _, operation := range Operations {
		covered[operation.Capability] = true
	}
	for _, row := range driver.CapabilityPorts() {
		if !covered[row.Capability] {
			t.Errorf("%s is backed by %s and the catalogue has no operation for it",
				row.Capability, row.Port)
		}
	}
}

// CarriesAttributes says a request has a family escape hatch in it. Setting it
// on a request that has none would send a caller looking for keys that have
// nowhere to go; leaving it off one that does hides the only part of the
// request the caller cannot discover for itself.
func TestAttributeFlagMatchesTheRequestType(t *testing.T) {
	stringMap := reflect.TypeFor[map[string]string]()
	for _, operation := range Operations {
		hatch := false
		if operation.Request != nil && operation.Request.Kind() == reflect.Struct {
			field, ok := operation.Request.FieldByName("Attributes")
			hatch = ok && field.Type == stringMap
		}
		if hatch != operation.CarriesAttributes {
			t.Errorf("%s: CarriesAttributes is %v but %v %s an Attributes map",
				operation.ID, operation.CarriesAttributes, operation.Request, has(hatch))
		}
	}
}

func TestAttributeDeclarationsNameARealOperation(t *testing.T) {
	carries := make(map[string]bool, len(Operations))
	for _, operation := range Operations {
		carries[operation.ID] = operation.CarriesAttributes
	}
	for kind, operations := range attributes {
		for id, declared := range operations {
			hatch, exists := carries[id]
			if !exists {
				t.Errorf("%s declares attributes for %q, which is not an operation", kind, id)
				continue
			}
			if !hatch {
				t.Errorf("%s declares attributes for %s, whose request has nowhere to put them", kind, id)
			}
			seen := make(map[string]bool, len(declared))
			for _, attribute := range declared {
				if seen[attribute.Key] {
					t.Errorf("%s/%s declares %q twice", kind, id, attribute.Key)
				}
				seen[attribute.Key] = true
				if attribute.Summary == "" {
					t.Errorf("%s/%s: %q has no summary", kind, id, attribute.Key)
				}
				if (attribute.Type == ValueEnum) != (len(attribute.Values) > 0) {
					t.Errorf("%s/%s: %q is %s with values %v",
						kind, id, attribute.Key, attribute.Type, attribute.Values)
				}
			}
		}
	}
}

/*
 * The declarations above are a contract with the drivers, and this is what
 * makes it one.
 *
 * A key a driver reads out of a write spec and nobody declares is invisible:
 * the caller composing the write cannot find it by reading any type, so the
 * setting silently does not happen. Going the other way, a declared key no
 * driver reads is worse than useless - it reads as a supported setting.
 *
 * The scan is source level rather than reflective because there is nothing to
 * reflect on: the keys are string constants indexed into a map[string]string.
 */
func TestWriteAttributeKeysMatchWhatTheDriversRead(t *testing.T) {
	const driverRoot = "../../driver"

	entries, err := os.ReadDir(driverRoot)
	if err != nil {
		t.Fatalf("cannot read the driver packages: %v", err)
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		kind, known := kindOfPackage[entry.Name()]
		if !known {
			t.Errorf("internal/driver/%s is a family this test does not know; "+
				"add it to kindOfPackage and declare its write attributes", entry.Name())
			continue
		}

		read := writeKeysOf(t, filepath.Join(driverRoot, entry.Name()))
		declared := make(map[string]bool)
		for _, operations := range attributes[kind] {
			for _, attribute := range operations {
				declared[attribute.Key] = true
			}
		}

		for key := range read {
			if !declared[key] {
				t.Errorf("%s reads %q out of a write spec and the catalogue does not declare it",
					kind, key)
			}
		}
		for key := range declared {
			if !read[key] {
				t.Errorf("%s declares %q and no driver code reads it", kind, key)
			}
		}
	}
}

// The driver package directories, which are the families. A new one fails the
// test above by name rather than by silently declaring nothing.
var kindOfPackage = map[string]model.MQKind{
	"activemq":        model.KindActiveMQ,
	"azureservicebus": model.KindAzureServiceBus,
	"googlepubsub":    model.KindGooglePubSub,
	"ibmmq":           model.KindIBMMQ,
	"kafka":           model.KindKafka,
	"kinesis":         model.KindKinesis,
	"mqtt":            model.KindMQTT,
	"nats":            model.KindNATS,
	"nsq":             model.KindNSQ,
	"pulsar":          model.KindPulsar,
	"rabbitmq":        model.KindRabbitMQ,
	"redisstream":     model.KindRedisStream,
	"rocketmq":        model.KindRocketMQ,
	"solace":          model.KindSolace,
	"sqs":             model.KindSQS,
}

// writeKeysOf returns the attribute keys a driver package reads out of a write
// spec, resolved through the constants it indexes with.
//
// Two shapes count as reading one. The common one indexes the map by a
// constant. The other ranges over a table of constants and indexes by the loop
// variable, which is how SQS names the subset of attributes it will send, and
// every key in that table is read just as surely as a hand-written one.
func writeKeysOf(t *testing.T, dir string) map[string]bool {
	t.Helper()

	fileSet := token.NewFileSet()
	packages, err := parser.ParseDir(fileSet, dir, func(info os.FileInfo) bool {
		return filepath.Ext(info.Name()) == ".go" && !hasSuffix(info.Name(), "_test.go")
	}, 0)
	if err != nil {
		t.Fatalf("cannot parse %s: %v", dir, err)
	}

	constants := make(map[string]string)
	tables := make(map[string][]string)
	indexed := make(map[string]bool)
	literals := make(map[string]bool)
	ranged := make(map[string]bool)
	loopVariables := make(map[string]bool)

	for _, pkg := range packages {
		ast.Inspect(pkg, func(node ast.Node) bool {
			switch n := node.(type) {
			case *ast.ValueSpec:
				for i, name := range n.Names {
					if i >= len(n.Values) {
						continue
					}
					if value, ok := stringLiteral(n.Values[i]); ok {
						constants[name.Name] = value
						continue
					}
					if composite, ok := n.Values[i].(*ast.CompositeLit); ok {
						tables[name.Name] = compositeKeys(composite)
					}
				}
			case *ast.RangeStmt:
				key, ok := n.Key.(*ast.Ident)
				if !ok || !indexesWriteSpec(n.Body, key.Name) {
					return true
				}
				loopVariables[key.Name] = true
				if table, ok := n.X.(*ast.Ident); ok {
					ranged[table.Name] = true
				}
			case *ast.IndexExpr:
				name, ok := writeSpecKey(n)
				if !ok {
					return true
				}
				if value, quoted := stringLiteral(n.Index); quoted {
					literals[value] = true
					return true
				}
				indexed[name] = true
			}
			return true
		})
	}

	keys := make(map[string]bool, len(indexed)+len(literals))
	for key := range literals {
		keys[key] = true
	}
	for name := range indexed {
		if loopVariables[name] {
			continue
		}
		value, ok := constants[name]
		if !ok {
			t.Errorf("%s indexes a write spec with %s, which resolves to no string constant", dir, name)
			continue
		}
		keys[value] = true
	}
	for table := range ranged {
		for _, name := range tables[table] {
			if value, ok := constants[name]; ok {
				keys[value] = true
			}
		}
	}
	return keys
}

// writeSpecKey reports the identifier a spec.Attributes index uses.
func writeSpecKey(expr *ast.IndexExpr) (string, bool) {
	selector, ok := expr.X.(*ast.SelectorExpr)
	if !ok || selector.Sel.Name != "Attributes" {
		return "", false
	}
	if base, ok := selector.X.(*ast.Ident); !ok || base.Name != "spec" {
		return "", false
	}
	if name, ok := expr.Index.(*ast.Ident); ok {
		return name.Name, true
	}
	return "", true
}

// indexesWriteSpec reports whether a loop body reads spec.Attributes with the
// loop's own key.
func indexesWriteSpec(body *ast.BlockStmt, variable string) bool {
	found := false
	ast.Inspect(body, func(node ast.Node) bool {
		index, ok := node.(*ast.IndexExpr)
		if !ok {
			return true
		}
		if name, ok := writeSpecKey(index); ok && name == variable {
			found = true
		}
		return !found
	})
	return found
}

func compositeKeys(composite *ast.CompositeLit) []string {
	names := make([]string, 0, len(composite.Elts))
	for _, element := range composite.Elts {
		pair, ok := element.(*ast.KeyValueExpr)
		if !ok {
			continue
		}
		if name, ok := pair.Key.(*ast.Ident); ok {
			names = append(names, name.Name)
		}
	}
	return names
}

func stringLiteral(expr ast.Expr) (string, bool) {
	literal, ok := expr.(*ast.BasicLit)
	if !ok || literal.Kind != token.STRING {
		return "", false
	}
	value, err := strconv.Unquote(literal.Value)
	if err != nil {
		return "", false
	}
	return value, true
}

func hasSuffix(name, suffix string) bool {
	return len(name) >= len(suffix) && name[len(name)-len(suffix):] == suffix
}

func keys(set map[string]bool) []string {
	names := make([]string, 0, len(set))
	for name := range set {
		names = append(names, name)
	}
	return names
}

func has(present bool) string {
	if present {
		return "has"
	}
	return "has no"
}
