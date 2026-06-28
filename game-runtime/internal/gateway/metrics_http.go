package gateway

import (
	"encoding/json"
	"net/http"

	runtimesvc "commanderzone/game-runtime/internal/runtime"
)

type MetricsHTTPServer struct {
	runtime *runtimesvc.Service
}

func NewMetricsHTTPServer(runtime *runtimesvc.Service) *MetricsHTTPServer {
	return &MetricsHTTPServer{runtime: runtime}
}

func (s *MetricsHTTPServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(s.runtime.MetricsSnapshot())
}
