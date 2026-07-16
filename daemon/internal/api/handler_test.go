package api

import (
	"encoding/json"
	stdhttp "net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/amigoer/rocket-leaf/daemon/internal/model"
)

func TestHealthRequiresBearerToken(t *testing.T) {
	handler := NewHandler(nil, "test-token", func() {})
	request := httptest.NewRequest(stdhttp.MethodGet, "/v1/health", nil)
	request.Header.Set("X-Request-ID", "request-1")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != stdhttp.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", recorder.Code, stdhttp.StatusUnauthorized)
	}
	var response apiError
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("failed to parse error response: %v", err)
	}
	if response.Code != "UNAUTHORIZED" || response.RequestID != "request-1" {
		t.Fatalf("unexpected error response: %+v", response)
	}
}

func TestHealthAcceptsBearerToken(t *testing.T) {
	handler := NewHandler(nil, "test-token", func() {})
	request := httptest.NewRequest(stdhttp.MethodGet, "/v1/health", nil)
	request.Header.Set("Authorization", "Bearer test-token")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if recorder.Code != stdhttp.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), `"protocolVersion":1`) {
		t.Fatalf("unexpected response: %s", recorder.Body.String())
	}
}

func TestRedactConnectionNeverReturnsCredentials(t *testing.T) {
	view := redactConnection(&model.Connection{
		ID: 7, Name: "prod", AccessKey: "access-secret", SecretKey: "secret-secret", EnableACL: true,
	})
	if view.AccessKey != "" || view.SecretKey != "" {
		t.Fatal("credentials must not appear in ConnectionView")
	}
	if !view.AccessKeyConfigured || !view.SecretKeyConfigured {
		t.Fatal("credential configured flags should be preserved")
	}
}

func TestRedactSettingsReportsCredentialStateWithoutSecrets(t *testing.T) {
	view := redactSettings(&model.AppSettings{
		GlobalAccessKey: "global-ak",
		GlobalSecretKey: "global-sk",
	})
	if view.GlobalAccessKey != "" || view.GlobalSecretKey != "" {
		t.Fatal("global credentials must not be returned to the renderer")
	}
	if !view.GlobalAccessKeyConfigured || !view.GlobalSecretKeyConfigured {
		t.Fatal("global credential configured flags should be returned")
	}
}

func TestDecodeJSONAcceptsWrappedImportLargerThanTwoMiB(t *testing.T) {
	payload := `{"content":"` + strings.Repeat("a", 3<<20) + `"}`
	request := httptest.NewRequest(stdhttp.MethodPost, "/v1/settings/import", strings.NewReader(payload))
	recorder := httptest.NewRecorder()
	var input struct {
		Content string `json:"content"`
	}
	if !decodeJSON(recorder, request, &input) {
		t.Fatalf("3 MiB wrapped import request should be accepted, status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if len(input.Content) != 3<<20 {
		t.Fatalf("content length = %d, want %d", len(input.Content), 3<<20)
	}
}

func BenchmarkAuthenticatedHealth(b *testing.B) {
	handler := NewHandler(nil, "test-token", func() {})
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
