package gateway

import (
	"encoding/json"
	"net/http"

	runtimesvc "commanderzone/game-runtime/internal/runtime"
)

type MetricsHTTPServer struct {
	runtime *runtimesvc.Service
	gateway GatewayMetricsProvider
}

type GatewayMetricsProvider interface {
	Metrics() GatewayMetrics
}

type MetricsResponse struct {
	runtimesvc.MetricsSnapshot
	Gateway *GatewayMetrics `json:"gateway,omitempty"`
}

func NewMetricsHTTPServer(runtime *runtimesvc.Service, gateway ...GatewayMetricsProvider) *MetricsHTTPServer {
	server := &MetricsHTTPServer{runtime: runtime}
	if len(gateway) > 0 {
		server.gateway = gateway[0]
	}
	return server
}

func (s *MetricsHTTPServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	snapshot := s.runtime.MetricsSnapshot()
	if s.gateway == nil {
		_ = json.NewEncoder(w).Encode(snapshot)
		return
	}
	gatewayMetrics := s.gateway.Metrics()
	_ = json.NewEncoder(w).Encode(MetricsResponse{
		MetricsSnapshot: snapshot,
		Gateway:         &gatewayMetrics,
	})
}
