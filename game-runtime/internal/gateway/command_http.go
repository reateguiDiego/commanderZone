package gateway

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"commanderzone/game-runtime/internal/actor"
	"commanderzone/game-runtime/internal/protocol"
	runtimesvc "commanderzone/game-runtime/internal/runtime"
	"commanderzone/game-runtime/internal/state"
)

const defaultHTTPCommandTimeout = 3 * time.Second

type CommandHTTPServer struct {
	runtime        *runtimesvc.Service
	commandTimeout time.Duration
}

type CommandHTTPRequest struct {
	ActorID      string                     `json:"actorId"`
	InitialState *state.GameState           `json:"initialState,omitempty"`
	Command      protocol.CommandEnvelopeV2 `json:"command"`
}

type CommandHTTPResponse struct {
	Event   protocol.EventPayloadV2    `json:"event"`
	Patches []protocol.PatchEnvelopeV2 `json:"patches"`
	Metrics map[string]any             `json:"metrics,omitempty"`
	Error   string                     `json:"error,omitempty"`
	Code    string                     `json:"code,omitempty"`
}

func NewCommandHTTPServer(runtime *runtimesvc.Service) *CommandHTTPServer {
	return &CommandHTTPServer{runtime: runtime, commandTimeout: defaultHTTPCommandTimeout}
}

func (s *CommandHTTPServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	defer r.Body.Close()

	var request CommandHTTPRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeCommandHTTPError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}
	if strings.TrimSpace(request.ActorID) == "" {
		writeCommandHTTPError(w, http.StatusBadRequest, "invalid_request", "actorId is required")
		return
	}
	if err := request.Command.Validate(); err != nil {
		writeCommandHTTPError(w, http.StatusBadRequest, "invalid_command", err.Error())
		return
	}

	initial := runtimesvc.EmptyInitialState(request.Command.GameID)
	if request.InitialState != nil {
		initial = *request.InitialState
	}
	gameActor, _, err := s.runtime.LoadActorRecovered(r.Context(), request.Command.GameID, initial)
	if err != nil {
		writeCommandHTTPError(w, http.StatusInternalServerError, "actor_recovery_failed", err.Error())
		return
	}
	if request.InitialState != nil && request.Command.BaseVersion < gameActor.Version() {
		request.Command.BaseVersion = gameActor.Version()
	}

	ctx, cancel := context.WithTimeout(r.Context(), s.commandTimeout)
	defer cancel()
	result := gameActor.Submit(ctx, request.Command, request.ActorID)
	if result.Err != nil {
		status := http.StatusConflict
		if result.Err == actor.ErrUnknownCommand {
			status = http.StatusBadRequest
		}
		writeCommandHTTPError(w, status, "command_failed", result.Err.Error())
		return
	}

	writeCommandHTTPJSON(w, http.StatusOK, CommandHTTPResponse{
		Event:   result.Event,
		Patches: result.Patches,
		Metrics: metricsFromEventPayload(result.Event.Payload),
	})
}

func metricsFromEventPayload(payload map[string]any) map[string]any {
	metrics, ok := payload["metrics"].(map[string]any)
	if !ok || len(metrics) == 0 {
		return nil
	}
	out := make(map[string]any, len(metrics))
	for key, value := range metrics {
		out[key] = value
	}
	return out
}

func writeCommandHTTPError(w http.ResponseWriter, status int, code string, message string) {
	writeCommandHTTPJSON(w, status, CommandHTTPResponse{Error: message, Code: code})
}

func writeCommandHTTPJSON(w http.ResponseWriter, status int, response CommandHTTPResponse) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(response)
}
