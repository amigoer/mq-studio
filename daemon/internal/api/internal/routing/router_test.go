package routing

import (
	stdhttp "net/http"
	"net/http/httptest"
	"testing"
)

func TestNewRegistersMethodAndPathPattern(t *testing.T) {
	route := Route{
		Method:      stdhttp.MethodGet,
		Path:        "/v1/items/{id}",
		OperationID: "getItem",
		Handler:     func(stdhttp.ResponseWriter, *stdhttp.Request) {},
	}
	router := New([]Route{route})
	request := httptest.NewRequest(stdhttp.MethodGet, "/v1/items/1", nil)
	_, pattern := router.Handler(request)
	if pattern != route.Pattern() {
		t.Fatalf("matched pattern = %q, want %q", pattern, route.Pattern())
	}
}
