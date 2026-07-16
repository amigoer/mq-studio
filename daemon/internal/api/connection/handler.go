// Package connection implements the HTTP endpoints for connection management.
package connection

type handler struct {
	service Service
}

func newHandler(service Service) handler {
	return handler{service: service}
}
