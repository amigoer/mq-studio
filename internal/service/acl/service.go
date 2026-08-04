// Package acl provides RocketMQ access-control management services.
package acl

import "time"

// Settings provides the runtime configuration required by ACL operations.
type Settings interface {
	GetRequestTimeout() time.Duration
}

// Service provides ACL management operations.
type Service struct {
	settings Settings
}

// New creates an ACL service.
func New(settings Settings) *Service {
	return &Service{settings: settings}
}
