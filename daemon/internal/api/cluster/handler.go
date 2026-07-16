// Package cluster implements the HTTP endpoints for RocketMQ cluster inspection.
package cluster

type handler struct {
	service Service
}

func newHandler(service Service) handler {
	return handler{service: service}
}
