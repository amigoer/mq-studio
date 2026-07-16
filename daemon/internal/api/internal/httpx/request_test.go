package httpx

import (
	stdhttp "net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeJSONAcceptsWrappedImportLargerThanTwoMiB(t *testing.T) {
	payload := `{"content":"` + strings.Repeat("a", 3<<20) + `"}`
	request := httptest.NewRequest(stdhttp.MethodPost, "/v1/settings/import", strings.NewReader(payload))
	recorder := httptest.NewRecorder()
	var input struct {
		Content string `json:"content"`
	}
	if !DecodeJSON(recorder, request, &input) {
		t.Fatalf("3 MiB wrapped import request should be accepted, status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	if len(input.Content) != 3<<20 {
		t.Fatalf("content length = %d, want %d", len(input.Content), 3<<20)
	}
}

func TestDecodeJSONRejectsInvalidBodies(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{name: "malformed", body: `{"name":`},
		{name: "unknown field", body: `{"unknown":true}`},
		{name: "multiple values", body: `{"name":"first"} {"name":"second"}`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request := httptest.NewRequest(stdhttp.MethodPost, "/test", strings.NewReader(tt.body))
			recorder := httptest.NewRecorder()
			var input struct {
				Name string `json:"name"`
			}

			if DecodeJSON(recorder, request, &input) {
				t.Fatal("invalid body was accepted")
			}
			if recorder.Code != stdhttp.StatusBadRequest {
				t.Fatalf("status = %d, want %d", recorder.Code, stdhttp.StatusBadRequest)
			}
		})
	}
}
