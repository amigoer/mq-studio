// Package api assembles the daemon's private loopback HTTP transport.
package api

import (
	stdhttp "net/http"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/middleware"
	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/routing"
)

// NewHandler assembles the private API router and its middleware chain.
func NewHandler(dependencies Dependencies, config Config) stdhttp.Handler {
	router := routing.New(catalog(dependencies, config.Shutdown))
	return middleware.RecoverPanic(middleware.Authenticate(config.Token, router))
}
