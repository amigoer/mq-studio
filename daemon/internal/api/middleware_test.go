package api

import (
	stdhttp "net/http"
	"net/http/httptest"
	"testing"
)

func TestRecoverPanicReturnsInternalError(t *testing.T) {
	handler := recoverPanic(stdhttp.HandlerFunc(func(stdhttp.ResponseWriter, *stdhttp.Request) {
		panic("boom")
	}))
	request := httptest.NewRequest(stdhttp.MethodGet, "/test", nil)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != stdhttp.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", recorder.Code, stdhttp.StatusInternalServerError)
	}
}
