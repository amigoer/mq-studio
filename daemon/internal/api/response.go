package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	stdhttp "net/http"
	"strings"
)

type apiError struct {
	Code      string         `json:"code"`
	Message   string         `json:"message"`
	RequestID string         `json:"requestId"`
	Details   map[string]any `json:"details,omitempty"`
}

func requestID(r *stdhttp.Request) string {
	if value := strings.TrimSpace(r.Header.Get("X-Request-ID")); value != "" && len(value) <= 128 {
		return value
	}
	random := make([]byte, 8)
	if _, err := rand.Read(random); err != nil {
		return "unknown"
	}
	return hex.EncodeToString(random)
}

func writeJSON(w stdhttp.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if value != nil {
		_ = json.NewEncoder(w).Encode(value)
	}
}

func writeError(w stdhttp.ResponseWriter, r *stdhttp.Request, status int, code, message string, details map[string]any) {
	writeJSON(w, status, apiError{Code: code, Message: message, RequestID: requestID(r), Details: details})
}

func serviceError(w stdhttp.ResponseWriter, r *stdhttp.Request, err error) {
	writeError(w, r, stdhttp.StatusBadRequest, "OPERATION_FAILED", err.Error(), nil)
}
