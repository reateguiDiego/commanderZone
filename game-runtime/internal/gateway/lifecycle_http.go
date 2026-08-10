package gateway

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	runtimesvc "commanderzone/game-runtime/internal/runtime"
)

// LifecycleHTTPServer exposes only system actor disposal. It is deliberately
// separate from /commands because it never enters the game_event stream.
type LifecycleHTTPServer struct {
	runtime *runtimesvc.Service
	timeout time.Duration
}

func NewLifecycleHTTPServer(runtime *runtimesvc.Service) *LifecycleHTTPServer {
	return &LifecycleHTTPServer{runtime: runtime, timeout: defaultHTTPCommandTimeout}
}

func (s *LifecycleHTTPServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	defer r.Body.Close()
	var request struct {
		GameID string `json:"gameId"`
		Action string `json:"action"`
	}
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil || strings.TrimSpace(request.GameID) == "" {
		http.Error(w, "gameId is required", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), s.timeout)
	defer cancel()
	if request.Action == "release" {
		s.runtime.ReleaseClosingTombstone(request.GameID)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]bool{"released": true})
		return
	}
	if request.Action != "" && request.Action != "stop" {
		http.Error(w, "unsupported lifecycle action", http.StatusBadRequest)
		return
	}
	if err := s.runtime.StopActor(ctx, request.GameID); err != nil {
		http.Error(w, err.Error(), http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"stopped": true})
}
