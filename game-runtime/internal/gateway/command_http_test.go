package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"commanderzone/game-runtime/internal/actor"
	"commanderzone/game-runtime/internal/protocol"
	runtimesvc "commanderzone/game-runtime/internal/runtime"
	"commanderzone/game-runtime/internal/state"
)

func TestCommandHTTPServerProcessesRuntimeMulligan(t *testing.T) {
	server := NewCommandHTTPServer(runtimesvc.NewService())
	initial := runtimeMulliganState("game-1", "player-1")
	body, err := json.Marshal(CommandHTTPRequest{
		ActorID:      "player-1",
		InitialState: &initial,
		Command: protocol.CommandEnvelopeV2{
			GameID:         "game-1",
			BaseVersion:    1,
			ClientActionID: "action-1",
			Type:           "mulligan.take",
			Payload:        map[string]any{"playerId": "player-1"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/commands", bytes.NewReader(body))
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var response CommandHTTPResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Event.Type != "mulligan.player_took" {
		t.Fatalf("unexpected event type: %s", response.Event.Type)
	}
	if response.Event.Version != 2 {
		t.Fatalf("unexpected event version: %d", response.Event.Version)
	}
	if len(response.Patches) == 0 {
		t.Fatal("expected runtime patches")
	}
	if response.Metrics["mulligan.take_ms"] == nil {
		t.Fatal("expected mulligan.take_ms metric")
	}
	if response.Metrics["actor.queue_capacity"] == nil || response.Metrics["actor.command_applied_count"] == nil {
		t.Fatalf("expected actor metrics in command response: %#v", response.Metrics)
	}
}

func TestCommandHTTPServerUsesRecoveredActorVersionWhenInitialStateIsStale(t *testing.T) {
	server := NewCommandHTTPServer(runtimesvc.NewService())
	initial := runtimeMulliganState("game-stale", "player-1")

	first := commandHTTP(t, server, CommandHTTPRequest{
		ActorID:      "player-1",
		InitialState: &initial,
		Command: protocol.CommandEnvelopeV2{
			GameID:         "game-stale",
			BaseVersion:    1,
			ClientActionID: "take-1",
			Type:           "mulligan.take",
			Payload:        map[string]any{"playerId": "player-1"},
		},
	})
	if first.Event.Version != 2 {
		t.Fatalf("first version got %d want 2", first.Event.Version)
	}

	second := commandHTTP(t, server, CommandHTTPRequest{
		ActorID:      "player-1",
		InitialState: &initial,
		Command: protocol.CommandEnvelopeV2{
			GameID:         "game-stale",
			BaseVersion:    1,
			ClientActionID: "keep-1",
			Type:           "mulligan.keep",
			Payload:        map[string]any{"playerId": "player-1"},
		},
	})
	if second.Event.Type != "mulligan.player_kept" {
		t.Fatalf("second event got %s want mulligan.player_kept", second.Event.Type)
	}
	if second.Event.Version != 3 {
		t.Fatalf("second version got %d want 3", second.Event.Version)
	}
}

func TestCommandHTTPServerReturnsQueueFullCode(t *testing.T) {
	runtimeService := runtimesvc.NewServiceWithStore(nil, 1, actor.DefaultAppliers())
	gameActor := actor.NewGameActor("game-full", runtimeMulliganState("game-full", "player-1"), nil, 1, actor.DefaultAppliers())
	if err := gameActor.Enqueue(actor.CommandRequest{
		Command: protocol.CommandEnvelopeV2{
			GameID:         "game-full",
			BaseVersion:    1,
			ClientActionID: "queued-1",
			Type:           "mulligan.take",
			Payload:        map[string]any{"playerId": "player-1"},
		},
	}); err != nil {
		t.Fatalf("seed queue failed: %v", err)
	}
	runtimeService.RegisterActor("game-full", gameActor)
	server := NewCommandHTTPServer(runtimeService)

	body, err := json.Marshal(CommandHTTPRequest{
		ActorID: "player-1",
		Command: protocol.CommandEnvelopeV2{
			GameID:         "game-full",
			BaseVersion:    1,
			ClientActionID: "queued-2",
			Type:           "mulligan.take",
			Payload:        map[string]any{"playerId": "player-1"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/commands", bytes.NewReader(body))
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var response CommandHTTPResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Code != "queue_full" {
		t.Fatalf("code got %q want queue_full; body=%s", response.Code, recorder.Body.String())
	}
}

func TestMetricsHTTPServerExposesActorQueueMetrics(t *testing.T) {
	runtimeService := runtimesvc.NewServiceWithStore(nil, 8, actor.DefaultAppliers())
	gameActor := actor.NewGameActor("game-metrics", runtimeMulliganState("game-metrics", "player-1"), nil, 8, actor.DefaultAppliers())
	result := gameActor.ApplyDirect(context.Background(), protocol.CommandEnvelopeV2{
		GameID:         "game-metrics",
		BaseVersion:    1,
		ClientActionID: "metric-1",
		Type:           "mulligan.take",
		Payload:        map[string]any{"playerId": "player-1"},
	}, "player-1")
	if result.Err != nil {
		t.Fatalf("apply failed: %v", result.Err)
	}
	runtimeService.RegisterActor("game-metrics", gameActor)
	server := NewMetricsHTTPServer(runtimeService)

	request := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Actors []actor.ActorMetrics `json:"actors"`
		Totals actor.ActorMetrics   `json:"totals"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if len(response.Actors) != 1 {
		t.Fatalf("actors got %d want 1: %#v", len(response.Actors), response)
	}
	if response.Actors[0].CommandAppliedCount != 1 || response.Totals.CommandAppliedCount != 1 {
		t.Fatalf("unexpected metrics response: %#v", response)
	}
}

func commandHTTP(t *testing.T, server *CommandHTTPServer, command CommandHTTPRequest) CommandHTTPResponse {
	t.Helper()
	body, err := json.Marshal(command)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/commands", bytes.NewReader(body))
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var response CommandHTTPResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	return response
}

func runtimeMulliganState(gameID string, playerID string) state.GameState {
	game := runtimesvc.EmptyInitialState(gameID)
	game.Phase = state.PhaseMulligan
	game.Players[playerID] = map[string]any{"life": 40}
	zones := state.PlayerZones{Library: []string{}, Hand: []string{}}
	for i := 1; i <= 10; i++ {
		zones.Library = append(zones.Library, fmt.Sprintf("library-%d", i))
	}
	for i := 1; i <= 7; i++ {
		zones.Hand = append(zones.Hand, fmt.Sprintf("hand-%d", i))
	}
	game.Zones[playerID] = zones
	for index, id := range game.Zones[playerID].Library {
		game.Instances[id] = state.CardInstanceRuntime{
			InstanceID:   id,
			CardKey:      id + "@1",
			OwnerID:      playerID,
			ControllerID: playerID,
			Zone:         state.ZoneLibrary,
		}
		game.Loc[id] = state.Location{PlayerID: playerID, Zone: state.ZoneLibrary, Index: index, ControllerID: playerID}
	}
	for index, id := range game.Zones[playerID].Hand {
		game.Instances[id] = state.CardInstanceRuntime{
			InstanceID:   id,
			CardKey:      id + "@1",
			OwnerID:      playerID,
			ControllerID: playerID,
			Zone:         state.ZoneHand,
		}
		game.Loc[id] = state.Location{PlayerID: playerID, Zone: state.ZoneHand, Index: index, ControllerID: playerID}
	}
	game.Mulligan = state.MulliganState{
		Rule:              "LONDON",
		FirstMulliganFree: true,
		PlayerStatus: map[string]state.MulliganPlayerState{
			playerID: {
				Status:          state.MulliganStatusDeciding,
				CurrentHandSize: 2,
			},
		},
		ReadyPlayers:    map[string]bool{},
		BottomOrderMode: "PLAYER_CHOSEN_ORDER",
		ScryMode:        "NONE",
	}
	return game
}
