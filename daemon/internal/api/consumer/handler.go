// Package consumer implements the HTTP endpoints for consumer group operations.
package consumer

type handler struct {
	service Service
}

func newHandler(service Service) handler {
	return handler{service: service}
}
