package api

import (
	"crypto/subtle"
	stdhttp "net/http"
)

func authenticate(token string, next stdhttp.Handler) stdhttp.Handler {
	expected := []byte("Bearer " + token)
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

func recoverPanic(next stdhttp.Handler) stdhttp.Handler {
	return stdhttp.HandlerFunc(func(w stdhttp.ResponseWriter, r *stdhttp.Request) {
		defer func() {
			if recover() != nil {
				writeError(w, r, stdhttp.StatusInternalServerError, "INTERNAL_ERROR", "internal server error", nil)
			}
		}()
		next.ServeHTTP(w, r)
	})
}
