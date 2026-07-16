// Package middleware contains transport-wide HTTP middleware.
package middleware

import (
	"crypto/subtle"
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/httpx"
)

// Authenticate requires the private API bearer token.
func Authenticate(token string, next stdhttp.Handler) stdhttp.Handler {
	expected := []byte("Bearer " + token)
	return stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		provided := []byte(r.Header.Get("Authorization"))
		if subtle.ConstantTimeCompare(provided, expected) != 1 {
			httpx.WriteError(w, r, stdhttp.StatusUnauthorized, "UNAUTHORIZED", "unauthorized", nil)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}
