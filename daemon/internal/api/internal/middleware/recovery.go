package middleware

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/httpx"
)

// RecoverPanic converts a handler panic into the stable internal error envelope.
func RecoverPanic(next stdhttp.Handler) stdhttp.Handler {
	return stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		defer func() {
			if recover() != nil {
				httpx.WriteError(w, r, stdhttp.StatusInternalServerError, "INTERNAL_ERROR", "internal server error", nil)
			}
		}()
		next.ServeHTTP(w, r)
	})
}
