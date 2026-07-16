// Package routing defines and registers private API routes.
package routing

import stdhttp "net/http"

// Route describes one HTTP operation exposed by an API domain.
type Route struct {
	Method      string
	Path        string
	OperationID string
	Handler     stdhttp.HandlerFunc
}

// Pattern returns the Go 1.22 ServeMux method and path pattern.
func (r Route) Pattern() string {
	return r.Method + " " + r.Path
}
