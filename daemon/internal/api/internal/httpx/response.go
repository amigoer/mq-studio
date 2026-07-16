package httpx

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	stdhttp "net/http"
	"strings"
)

// Error is the stable error envelope returned by the private HTTP API.
type Error struct {
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

// WriteJSON writes a JSON response with the supplied status code.
func WriteJSON(w stdhttp.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if value != nil {
		_ = json.NewEncoder(w).Encode(value)
	}
}

// WriteError writes the stable API error envelope.
func WriteError(w stdhttp.ResponseWriter, r *stdhttp.Request, status int, code, message string, details map[string]any) {
	WriteJSON(w, status, Error{Code: code, Message: message, RequestID: requestID(r), Details: details})
}

// ServiceError maps a business operation failure to the current API contract.
func ServiceError(w stdhttp.ResponseWriter, r *stdhttp.Request, err error) {
	WriteError(w, r, stdhttp.StatusBadRequest, "OPERATION_FAILED", err.Error(), nil)
}
