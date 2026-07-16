// Package httpx provides the shared HTTP protocol primitives used by API domains.
package httpx

import (
	"encoding/json"
	"errors"
	"io"
	stdhttp "net/http"
)

// Electron allows importing up to 5 MiB of config; when wrapped in {"content":"..."},
// quotes and backslashes are escaped and can nearly double the size, so the private
// API uses a 12 MiB body limit.
const maxRequestBody = 12 << 20

// DecodeJSON decodes one strict JSON object and writes a client error on failure.
func DecodeJSON(w stdhttp.ResponseWriter, r *stdhttp.Request, value any) bool {
	r.Body = stdhttp.MaxBytesReader(w, r.Body, maxRequestBody)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		WriteError(w, r, stdhttp.StatusBadRequest, "INVALID_REQUEST", "invalid request body", nil)
		return false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		WriteError(w, r, stdhttp.StatusBadRequest, "INVALID_REQUEST", "request must contain a single JSON object", nil)
		return false
	}
	return true
}
