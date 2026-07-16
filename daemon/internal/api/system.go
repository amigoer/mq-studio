package api

import stdhttp "net/http"

func (h *handler) registerSystemRoutes(mux *stdhttp.ServeMux) {
	mux.HandleFunc("GET /v1/health", h.health)
	mux.HandleFunc("POST /v1/shutdown", h.requestShutdown)
}

func (h *handler) health(w stdhttp.ResponseWriter, _ *stdhttp.Request) {
	writeJSON(w, stdhttp.StatusOK, map[string]any{"status": "ok", "protocolVersion": 1})
}

func (h *handler) requestShutdown(w stdhttp.ResponseWriter, _ *stdhttp.Request) {
	writeJSON(w, stdhttp.StatusAccepted, map[string]bool{"accepted": true})
	go h.shutdown()
}
