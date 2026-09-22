package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

/*
 * The capability model's text is i18n keys, and this is what keeps that true
 * in both directions.
 *
 * A caveat written as English prose renders untranslated in the window, beside
 * six others that translate. A key with no entry in the locale files resolves
 * to itself, which reaches a caller as mq.kafka.caveat.something and reads as
 * a warning nobody can act on. Both mistakes look completely fine in review
 * and neither fails anything else.
 */

var keyPattern = regexp.MustCompile(`^mq\.[a-z-]+\.(caveat|degraded)\.[A-Za-z0-9_]+$`)

func TestDeclaredCaveatsAreKeysThatResolve(t *testing.T) {
	english := phrasebook("en")
	chinese := phrasebook("zh")

	declared := declaredCaveats(t)
	if len(declared) == 0 {
		t.Fatal("found no caveat declarations at all; this test is looking in the wrong place")
	}

	for _, caveat := range declared {
		if !keyPattern.MatchString(caveat.value) {
			t.Errorf("%s: %s is %q, which is prose rather than an i18n key - the window would "+
				"show it untranslated", caveat.where, caveat.name, caveat.value)
			continue
		}
		if english(caveat.value) == caveat.value {
			t.Errorf("%s: %s resolves to nothing in en.json", caveat.where, caveat.value)
		}
		if chinese(caveat.value) == caveat.value {
			t.Errorf("%s: %s resolves to nothing in zh.json", caveat.where, caveat.value)
		}
	}
}

// Every key a driver mentions, not only the caveats: a degraded reason that
// resolves to itself explains an absent control with a dotted identifier.
func TestEveryDriverKeyResolves(t *testing.T) {
	english := phrasebook("en")
	chinese := phrasebook("zh")

	mentioned := regexp.MustCompile(`"(mq\.[a-z-]+\.(?:caveat|degraded)\.[A-Za-z0-9_]+)"`)
	seen := make(map[string]string)

	err := filepath.WalkDir("internal/driver", func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() || !strings.HasSuffix(path, ".go") ||
			strings.HasSuffix(path, "_test.go") {
			return err
		}
		source, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, match := range mentioned.FindAllStringSubmatch(string(source), -1) {
			seen[match[1]] = path
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk the drivers: %v", err)
	}

	for key, path := range seen {
		if english(key) == key {
			t.Errorf("%s: %s is missing from en.json", path, key)
		}
		if chinese(key) == key {
			t.Errorf("%s: %s is missing from zh.json", path, key)
		}
	}
}

func TestPhrasebookLeavesAnUnknownKeyReadable(t *testing.T) {
	english := phrasebook("en")

	// Unchanged rather than empty: a caller can search for what it was given,
	// where an empty string reads as "this operation has no consequence".
	if got := english("mq.nowhere.caveat.invented"); got != "mq.nowhere.caveat.invented" {
		t.Errorf("an unknown key came back as %q", got)
	}
	if got := english(""); got != "" {
		t.Errorf("an empty key came back as %q", got)
	}
	if got := english("mq.rabbitmq.caveat.browseAltersQueue"); !strings.Contains(got, "queue") {
		t.Errorf("a known key came back as %q", got)
	}
}

// A server runs for as long as the agent client does, and the language is the
// window's to change in the meantime.
func TestLivePhrasebookFollowsALanguageSwitch(t *testing.T) {
	const key = "mq.rabbitmq.caveat.browseAltersQueue"
	language := "en"
	translate := livePhrasebook(func() string { return language })

	english := translate(key)
	language = "zh"
	chinese := translate(key)

	if english != phrasebook("en")(key) || chinese != phrasebook("zh")(key) {
		t.Fatalf("resolved %q then %q, want each language's own text", english, chinese)
	}
	if english == chinese {
		t.Fatal("the two languages read the same, so this proves nothing")
	}
}

type caveatDeclaration struct {
	name  string
	value string
	where string
}

/*
 * declaredCaveats finds what each driver passes as a caveat.
 *
 * Two shapes, because the drivers use both: WithCaveat(capability, ident) and
 * a Caveats map literal inside a Capabilities value. Either way the value is
 * an identifier naming a constant in the same package, which is resolved here
 * so the test can look at the string itself.
 */
func declaredCaveats(t *testing.T) []caveatDeclaration {
	t.Helper()

	var found []caveatDeclaration
	entries, err := os.ReadDir("internal/driver")
	if err != nil {
		t.Fatalf("read the driver packages: %v", err)
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dir := filepath.Join("internal/driver", entry.Name())
		fileSet := token.NewFileSet()
		packages, err := parser.ParseDir(fileSet, dir, func(info os.FileInfo) bool {
			return strings.HasSuffix(info.Name(), ".go") && !strings.HasSuffix(info.Name(), "_test.go")
		}, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", dir, err)
		}

		constants := map[string]string{}
		var idents []string
		for _, pkg := range packages {
			ast.Inspect(pkg, func(node ast.Node) bool {
				switch n := node.(type) {
				case *ast.ValueSpec:
					for i, name := range n.Names {
						if i < len(n.Values) {
							if value, ok := stringValue(n.Values[i]); ok {
								constants[name.Name] = value
							}
						}
					}
				case *ast.CallExpr:
					selector, ok := n.Fun.(*ast.SelectorExpr)
					if !ok || selector.Sel.Name != "WithCaveat" || len(n.Args) != 2 {
						return true
					}
					if ident, ok := n.Args[1].(*ast.Ident); ok {
						idents = append(idents, ident.Name)
					}
				case *ast.KeyValueExpr:
					// Caveats: map[model.Capability]string{ cap: ident }
					key, ok := n.Key.(*ast.Ident)
					if !ok || key.Name != "Caveats" {
						return true
					}
					composite, ok := n.Value.(*ast.CompositeLit)
					if !ok {
						return true
					}
					for _, element := range composite.Elts {
						pair, ok := element.(*ast.KeyValueExpr)
						if !ok {
							continue
						}
						if ident, ok := pair.Value.(*ast.Ident); ok {
							idents = append(idents, ident.Name)
						}
					}
				}
				return true
			})
		}

		for _, name := range idents {
			value, known := constants[name]
			if !known {
				t.Errorf("%s: caveat %s resolves to no string constant in its package", dir, name)
				continue
			}
			found = append(found, caveatDeclaration{name: name, value: value, where: dir})
		}
	}
	return found
}

func stringValue(expr ast.Expr) (string, bool) {
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
