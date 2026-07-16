package routing

import stdhttp "net/http"

// New registers a complete route catalog on a standard library ServeMux.
func New(routes []Route) *stdhttp.ServeMux {
	mux := stdhttp.NewServeMux()
	for _, route := range routes {
		mux.HandleFunc(route.Pattern(), route.Handler)
	}
	return mux
}
