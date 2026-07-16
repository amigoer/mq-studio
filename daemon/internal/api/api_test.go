package api

import (
	"encoding/json"
	stdhttp "net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/httpx"
)

func TestHealthRequiresBearerToken(t *testing.T) {
	handler := NewHandler(Dependencies{}, Config{Token: "test-token", Shutdown: func() {}})
	request := httptest.NewRequest(stdhttp.MethodGet, "/v1/health", nil)
	request.Header.Set("X-Request-ID", "request-1")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != stdhttp.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", recorder.Code, stdhttp.StatusUnauthorized)
	}
	var response httpx.Error
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to parse error response: %v", err)
	}
	if response.Code != "UNAUTHORIZED" || response.RequestID != "request-1" {
		t.Fatalf("unexpected error response: %+v", response)
	}
}

func TestHealthAcceptsBearerToken(t *testing.T) {
	handler := NewHandler(Dependencies{}, Config{Token: "test-token", Shutdown: func() {}})
	request := httptest.NewRequest(stdhttp.MethodGet, "/v1/health", nil)
	request.Header.Set("Authorization", "Bearer test-token")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != stdhttp.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", recorder.Header().Get("Cache-Control"))
	}
	if !strings.Contains(recorder.Body.String(), `"protocolVersion":1`) {
		t.Fatalf("unexpected response: %s", recorder.Body.String())
	}
}

func BenchmarkAuthenticatedHealth(b *testing.B) {
	handler := NewHandler(Dependencies{}, Config{Token: "test-token", Shutdown: func() {}})
	b.ResetTimer()
	for range b.N {
		request := httptest.NewRequest(stdhttp.MethodGet, "/v1/health", nil)
		request.Header.Set("Authorization", "Bearer test-token")
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		if recorder.Code != stdhttp.StatusOK {
			b.Fatalf("status = %d", recorder.Code)
		}
	}
}
