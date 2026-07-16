package api

import (
	stdhttp "net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

type openAPIDocument struct {
	Paths map[string]map[string]yaml.Node `yaml:"paths"`
}

type openAPIOperation struct {
	OperationID string `yaml:"operationId"`
}

func TestRouteCatalogMatchesOpenAPI(t *testing.T) {
	expected := loadOpenAPIRoutes(t)
	routes := routeCatalog(newEndpointHandlers(nil, func() {}))
	if len(routes) != 46 {
		t.Fatalf("route count = %d, want 46", len(routes))
	}
	if len(routes) != len(expected) {
		t.Fatalf("route count = %d, OpenAPI operation count = %d", len(routes), len(expected))
	}

	patterns := make(map[string]struct{}, len(routes))
	operationIDs := make(map[string]struct{}, len(routes))
	for _, route := range routes {
		if route.handler == nil {
			t.Fatalf("route %s has no handler", route.pattern())
		}
		if _, exists := patterns[route.pattern()]; exists {
			t.Fatalf("duplicate route pattern: %s", route.pattern())
		}
		patterns[route.pattern()] = struct{}{}
		if _, exists := operationIDs[route.operationID]; exists {
			t.Fatalf("duplicate operation ID: %s", route.operationID)
		}
		operationIDs[route.operationID] = struct{}{}

		expectedOperationID, exists := expected[route.pattern()]
		if !exists {
			t.Fatalf("route %s is missing from OpenAPI", route.pattern())
		}
		if route.operationID != expectedOperationID {
			t.Fatalf("route %s operation ID = %q, OpenAPI = %q", route.pattern(), route.operationID, expectedOperationID)
		}
	}
}

func TestRouterRegistersEveryCatalogRoute(t *testing.T) {
	endpoints := newEndpointHandlers(nil, func() {})
	router := newRouter(endpoints)
	for _, route := range routeCatalog(endpoints) {
		t.Run(route.operationID, func(t *testing.T) {
			path := strings.ReplaceAll(route.path, "{id}", "1")
			request := httptest.NewRequest(route.method, path, nil)
			_, pattern := router.Handler(request)
			if pattern != route.pattern() {
				t.Fatalf("matched pattern = %q, want %q", pattern, route.pattern())
			}
		})
	}
}

func loadOpenAPIRoutes(t *testing.T) map[string]string {
	t.Helper()
	_, currentFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("failed to locate routes test file")
	}
	specPath := filepath.Join(filepath.Dir(currentFile), "..", "..", "..", "contracts", "openapi.yaml")
	data, err := os.ReadFile(specPath)
	if err != nil {
		t.Fatalf("failed to read OpenAPI contract: %v", err)
	}

	var document openAPIDocument
	if err := yaml.Unmarshal(data, &document); err != nil {
		t.Fatalf("failed to parse OpenAPI contract: %v", err)
	}

	routes := make(map[string]string)
	operationIDs := make(map[string]string)
	for path, pathItem := range document.Paths {
		for method, operationNode := range pathItem {
			method = strings.ToUpper(method)
			if !isContractMethod(method) {
				continue
			}
			var operation openAPIOperation
			if err := operationNode.Decode(&operation); err != nil {
				t.Fatalf("failed to parse OpenAPI operation %s %s: %v", method, path, err)
			}
			if operation.OperationID == "" {
				t.Fatalf("OpenAPI operation %s %s has no operationId", method, path)
			}
			pattern := method + " /v1" + path
			if _, exists := routes[pattern]; exists {
				t.Fatalf("duplicate OpenAPI route: %s", pattern)
			}
			routes[pattern] = operation.OperationID
			if previous, exists := operationIDs[operation.OperationID]; exists {
				t.Fatalf("duplicate OpenAPI operationId %q on %s and %s", operation.OperationID, previous, pattern)
			}
			operationIDs[operation.OperationID] = pattern
		}
	}
	return routes
}

func isContractMethod(method string) bool {
	switch method {
	case stdhttp.MethodGet,
		stdhttp.MethodHead,
		stdhttp.MethodPost,
		stdhttp.MethodPut,
		stdhttp.MethodPatch,
		stdhttp.MethodDelete,
		stdhttp.MethodConnect,
		stdhttp.MethodOptions,
		stdhttp.MethodTrace:
		return true
	default:
		return false
	}
}
