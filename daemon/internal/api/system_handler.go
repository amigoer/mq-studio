package api

import stdhttp "net/http"

type systemHandler struct {
	shutdown func()
}

func (h systemHandler) health(w stdhttp.ResponseWriter, _ *stdhttp.Request) {
	writeJSON(w, stdhttp.StatusOK, map[string]any{"status": "ok", "protocolVersion": 1})
}

func (h systemHandler) requestShutdown(w stdhttp.ResponseWriter, _ *stdhttp.Request) {
	writeJSON(w, stdhttp.StatusAccepted, map[string]bool{"accepted": true})
	go h.shutdown()
}
