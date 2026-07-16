// Package api provides a private loopback HTTP API for the Electron main process only.
package api

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	stdhttp "net/http"
	"strconv"
	"strings"

	"github.com/amigoer/rocket-leaf/daemon/internal/app"
)

// Electron allows importing up to 5 MiB of config; when wrapped in {"content":"..."},
// quotes and backslashes are escaped and can nearly double the size, so the private
// API uses a 12 MiB body limit.
const maxRequestBody = 12 << 20

type handler struct {
	services *app.Services
	token    string
	shutdown func()
}

type apiError struct {
	Code      string         `json:"code"`
	Message   string         `json:"message"`
	RequestID string         `json:"requestId"`
	Details   map[string]any `json:"details,omitempty"`
}

// NewHandler constructs a private API with authentication and panic isolation.
func NewHandler(services *app.Services, token string, shutdown func()) stdhttp.Handler {
	h := &handler{services: services, token: token, shutdown: shutdown}
	mux := stdhttp.NewServeMux()
	h.registerSystemRoutes(mux)
	h.registerConnectionRoutes(mux)
	h.registerSettingsRoutes(mux)
	h.registerClusterRoutes(mux)
	h.registerTopicRoutes(mux)
	h.registerConsumerRoutes(mux)
	h.registerMessageRoutes(mux)
	h.registerACLRoutes(mux)
	return h.recoverPanic(h.authenticate(mux))
}

func (h *handler) authenticate(next stdhttp.Handler) stdhttp.Handler {
	expected := []byte("Bearer " + h.token)
	return stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		provided := []byte(r.Header.Get("Authorization"))
		if subtle.ConstantTimeCompare(provided, expected) != 1 {
			writeError(w, r, stdhttp.StatusUnauthorized, "UNAUTHORIZED", "unauthorized", nil)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

func (h *handler) recoverPanic(next stdhttp.Handler) stdhttp.Handler {
	return stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		defer func() {
			if recover() != nil {
				writeError(w, r, stdhttp.StatusInternalServerError, "INTERNAL_ERROR", "internal server error", nil)
			}
		}()
		next.ServeHTTP(w, r)
	})
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

func decodeJSON(w stdhttp.ResponseWriter, r *stdhttp.Request, value any) bool {
	r.Body = stdhttp.MaxBytesReader(w, r.Body, maxRequestBody)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		writeError(w, r, stdhttp.StatusBadRequest, "INVALID_REQUEST", "invalid request body", nil)
		return false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeError(w, r, stdhttp.StatusBadRequest, "INVALID_REQUEST", "request must contain a single JSON object", nil)
		return false
	}
	return true
}

func intPath(w stdhttp.ResponseWriter, r *stdhttp.Request) (int, bool) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		writeError(w, r, stdhttp.StatusBadRequest, "INVALID_REQUEST", "invalid connection id", nil)
		return 0, false
	}
	return id, true
}

func queryInt(r *stdhttp.Request, name string, fallback int) int {
	value, err := strconv.Atoi(r.URL.Query().Get(name))
	if err != nil {
		return fallback
	}
	return value
}

func queryInt64(r *stdhttp.Request, name string) int64 {
	value, _ := strconv.ParseInt(r.URL.Query().Get(name), 10, 64)
	return value
}
