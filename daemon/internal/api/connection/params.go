package connection

import (
	stdhttp "net/http"
	"strconv"

	"github.com/amigoer/rocket-leaf/daemon/internal/api/internal/httpx"
)

func parseID(w stdhttp.ResponseWriter, r *stdhttp.Request) (int, bool) {
	id, err := strconv.Atoi(r.PathValue("id"))
	if err != nil || id <= 0 {
		httpx.WriteError(w, r, stdhttp.StatusBadRequest, "INVALID_REQUEST", "invalid connection id", nil)
		return 0, false
	}
	return id, true
}
