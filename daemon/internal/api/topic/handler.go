// Package topic implements the HTTP endpoints for RocketMQ topic operations.
package topic

type handler struct {
	service Service
}

func newHandler(service Service) handler {
	return handler{service: service}
}
