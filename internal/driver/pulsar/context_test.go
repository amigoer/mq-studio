package pulsar

import (
	"go/ast"
	"go/parser"
	"go/token"
	"strings"
	"testing"
)

// The admin API surfaces every method twice: Foo and FooWithContext.
//
// Only the second honours a deadline. The first calls it with
// context.Background(), so the only bound left is pulsaradmin's own
// http.Client timeout - five minutes, with no way to configure it. A single
// call written without the suffix blocks a board and the background collector
// for five minutes against a broker that has gone quiet, and reports nothing
// while it does.
//
// Reading the package rather than trusting review, because the two spellings
// differ by eleven characters and both compile.
func TestEveryAdminCallPassesAContext(t *testing.T) {
	// The admin plane is reached through these selectors, which are the
	// pulsaradmin.Client accessors this driver uses.
	planes := map[string]bool{
		"Brokers": true, "BrokerStats": true, "Clusters": true, "Namespaces": true,
		"NsIsolationPolicy": true, "ResourceQuotas": true, "Schemas": true,
		"Subscriptions": true, "Tenants": true, "Topics": true,
	}

	fset := token.NewFileSet()
	pkgs, err := parser.ParseDir(fset, ".", nil, 0)
	if err != nil {
		t.Fatalf("parse the package: %v", err)
	}

	for _, pkg := range pkgs {
		for name, file := range pkg.Files {
			if strings.HasSuffix(name, "_test.go") {
				continue
			}
			ast.Inspect(file, func(node ast.Node) bool {
				call, ok := node.(*ast.CallExpr)
				if !ok {
					return true
				}
				method, ok := call.Fun.(*ast.SelectorExpr)
				if !ok {
					return true
				}
				// The shape being matched is admin.Plane().Method(...): the
				// receiver of the method is itself a call to one of the
				// accessors above.
				receiver, ok := method.X.(*ast.CallExpr)
				if !ok {
					return true
				}
				plane, ok := receiver.Fun.(*ast.SelectorExpr)
				if !ok || !planes[plane.Sel.Name] {
					return true
				}
				if !strings.HasSuffix(method.Sel.Name, "WithContext") {
					t.Errorf("%s: %s().%s does not take a context; use %sWithContext",
						fset.Position(call.Pos()), plane.Sel.Name,
						method.Sel.Name, method.Sel.Name)
				}
				return true
			})
		}
	}
}
