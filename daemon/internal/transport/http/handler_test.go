package http

import (
	"encoding/json"
	stdhttp "net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"rocket-leaf/internal/model"
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
		t.Fatalf("解析错误响应失败: %v", err)
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
		t.Fatal("凭证不得进入 ConnectionView")
	}
	if !view.AccessKeyConfigured || !view.SecretKeyConfigured {
		t.Fatal("应保留凭证已配置状态")
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
