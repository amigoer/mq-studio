// Package settings implements the HTTP endpoints for application settings.
package settings

type handler struct {
	service Service
}

func newHandler(service Service) handler {
	return handler{service: service}
}
