package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"commanderzone/game-runtime/internal/actor"
	"commanderzone/game-runtime/internal/persistence"
	"commanderzone/game-runtime/internal/protocol"
	runtimesvc "commanderzone/game-runtime/internal/runtime"
	"commanderzone/game-runtime/internal/state"
)

func TestCommandHTTPServerProcessesRuntimeMulligan(t *testing.T) {
	initial := runtimeMulliganState("game-1", "player-1")
	store := persistence.NewInMemoryEventStore()
	saveHTTPRuntimeSnapshot(t, store, initial)
	server := NewCommandHTTPServer(runtimesvc.NewServiceWithStore(store, 8, actor.DefaultAppliers()))
	body, err := json.Marshal(CommandHTTPRequest{
		ActorID: "player-1",
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
	if response.Metrics["runtime.initial_state_per_command_count"] != float64(0) {
		t.Fatalf("expected no initialState metric in final command path: %#v", response.Metrics)
	}
	if response.Metrics["runtime.actor_load_from_snapshot_count"] != float64(1) {
		t.Fatalf("expected snapshot actor load metric: %#v", response.Metrics)
	}
}

func TestCommandHTTPServerRejectsInitialStateInFinalMode(t *testing.T) {
	server := NewCommandHTTPServer(runtimesvc.NewServiceWithStore(persistence.NewInMemoryEventStore(), 8, actor.DefaultAppliers()))
	initial := runtimeMulliganState("game-stale", "player-1")

	body, err := json.Marshal(CommandHTTPRequest{
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
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/commands", bytes.NewReader(body))
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var response CommandHTTPResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Code != "initial_state_rejected" {
		t.Fatalf("code got %q want initial_state_rejected; body=%s", response.Code, recorder.Body.String())
	}
	if metrics := server.runtime.RuntimeMetrics(); metrics.InitialStatePerCommandCount != 1 {
		t.Fatalf("initialState metric got %#v want count 1", metrics)
	}
}

func TestCommandHTTPServerAllowsInitialStateOnlyWhenExplicitlyEnabled(t *testing.T) {
	server := NewCommandHTTPServerAllowingInitialState(runtimesvc.NewServiceWithStore(persistence.NewInMemoryEventStore(), 8, actor.DefaultAppliers()))
	initial := runtimeMulliganState("game-migration", "player-1")

	response := commandHTTP(t, server, CommandHTTPRequest{
		ActorID:      "player-1",
		InitialState: &initial,
		Command: protocol.CommandEnvelopeV2{
			GameID:         "game-migration",
			BaseVersion:    1,
			ClientActionID: "take-1",
			Type:           "mulligan.take",
			Payload:        map[string]any{"playerId": "player-1"},
		},
	})
	if response.Event.Type != "mulligan.player_took" {
		t.Fatalf("event got %s want mulligan.player_took", response.Event.Type)
	}
	if response.Metrics["runtime.initial_state_per_command_count"] != float64(1) {
		t.Fatalf("expected migration initialState metric: %#v", response.Metrics)
	}
}

func TestCommandHTTPServerActorCacheHitAfterSnapshotRecovery(t *testing.T) {
	initial := runtimeMulliganState("game-cache", "player-1")
	store := persistence.NewInMemoryEventStore()
	saveHTTPRuntimeSnapshot(t, store, initial)
	server := NewCommandHTTPServer(runtimesvc.NewServiceWithStore(store, 8, actor.DefaultAppliers()))

	first := commandHTTP(t, server, CommandHTTPRequest{
		ActorID: "player-1",
		Command: protocol.CommandEnvelopeV2{
			GameID:         "game-cache",
			BaseVersion:    1,
			ClientActionID: "take-1",
			Type:           "mulligan.take",
			Payload:        map[string]any{"playerId": "player-1"},
		},
	})
	second := commandHTTP(t, server, CommandHTTPRequest{
		ActorID: "player-1",
		Command: protocol.CommandEnvelopeV2{
			GameID:         "game-cache",
			BaseVersion:    first.Event.Version,
			ClientActionID: "keep-1",
			Type:           "mulligan.keep",
			Payload:        map[string]any{"playerId": "player-1"},
		},
	})

	if second.Metrics["runtime.actor_cache_hit_count"] != float64(1) {
		t.Fatalf("expected one actor cache hit: %#v", second.Metrics)
	}
	if second.Metrics["runtime.actor_cache_miss_count"] != float64(1) {
		t.Fatalf("expected one actor cache miss: %#v", second.Metrics)
	}
}

func TestCommandHTTPServerDuplicateActionReturnsExistingEventAndMetric(t *testing.T) {
	initial := runtimeMulliganState("game-duplicate", "player-1")
	store := persistence.NewInMemoryEventStore()
	saveHTTPRuntimeSnapshot(t, store, initial)
	server := NewCommandHTTPServer(runtimesvc.NewServiceWithStore(store, 8, actor.DefaultAppliers()))

	request := CommandHTTPRequest{
		ActorID: "player-1",
		Command: protocol.CommandEnvelopeV2{
			GameID:         "game-duplicate",
			BaseVersion:    1,
			ClientActionID: "take-1",
			Type:           "mulligan.take",
			Payload:        map[string]any{"playerId": "player-1"},
		},
	}
	first := commandHTTP(t, server, request)
	duplicate := commandHTTP(t, server, request)

	if duplicate.Event.Version != first.Event.Version {
		t.Fatalf("duplicate event version got %d want %d", duplicate.Event.Version, first.Event.Version)
	}
	if duplicate.Metrics["actor.duplicate_action_count"] != float64(1) ||
		duplicate.Metrics["actor.duplicate_memory_count"] != float64(1) ||
		duplicate.Metrics["actor.duplicate_durable_count"] != float64(0) ||
		duplicate.Metrics["actor.command_applied_count"] != float64(1) {
		t.Fatalf("expected duplicate action metrics: %#v", duplicate.Metrics)
	}
	events, err := store.EventsAfter(context.Background(), "game-duplicate", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Fatalf("events got %d want 1", len(events))
	}
}

func TestCommandHTTPServerDuplicateLegacyEventMissingReceiptReturnsExplicitError(t *testing.T) {
	initial := runtimeMulliganState("game-legacy-receipt", "player-1")
	store := persistence.NewInMemoryEventStore()
	saveHTTPRuntimeSnapshot(t, store, initial)
	if err := store.AppendEvent(context.Background(), protocol.EventPayloadV2{
		GameID:         "game-legacy-receipt",
		Version:        2,
		Type:           "mulligan.player_took",
		Payload:        map[string]any{"playerId": "player-1"},
		CreatedBy:      "player-1",
		ClientActionID: "take-legacy",
		CreatedAt:      time.Now().UTC(),
	}); err != nil {
		t.Fatalf("append legacy event: %v", err)
	}
	server := NewCommandHTTPServer(runtimesvc.NewServiceWithStore(store, 8, actor.DefaultAppliers()))

	body, err := json.Marshal(CommandHTTPRequest{
		ActorID: "player-1",
		Command: protocol.CommandEnvelopeV2{
			GameID:         "game-legacy-receipt",
			BaseVersion:    1,
			ClientActionID: "take-legacy",
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
	if response.Code != "patch_receipt_missing" {
		t.Fatalf("code got %q want patch_receipt_missing; body=%s", response.Code, recorder.Body.String())
	}
	gameActor, ok := server.runtime.Actor("game-legacy-receipt")
	if !ok {
		t.Fatal("actor missing after duplicate lookup")
	}
	metrics := gameActor.Metrics()
	if metrics.DuplicateDurableCount != 1 || metrics.DuplicateReceiptMissingCount != 1 || metrics.CommandRejectedCount != 1 || metrics.CommandAppliedCount != 0 {
		t.Fatalf("receipt-missing metrics mismatch: %#v", metrics)
	}
	events, err := store.EventsAfter(context.Background(), "game-legacy-receipt", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Fatalf("events got %d want 1", len(events))
	}
}

func TestCommandHTTPServerActorCacheMissLoadsSnapshotAndEvents(t *testing.T) {
	initial := runtimeMulliganState("game-replay", "player-1")
	store := persistence.NewInMemoryEventStore()
	saveHTTPRuntimeSnapshot(t, store, initial)
	take := actor.NewGameActor("game-replay", initial, store, 8, actor.DefaultAppliers()).ApplyDirect(context.Background(), protocol.CommandEnvelopeV2{
		GameID:         "game-replay",
		BaseVersion:    1,
		ClientActionID: "seed-take",
		Type:           "mulligan.take",
		Payload:        map[string]any{"playerId": "player-1"},
	}, "player-1")
	if take.Err != nil {
		t.Fatalf("seed take failed: %v", take.Err)
	}
	server := NewCommandHTTPServer(runtimesvc.NewServiceWithStore(store, 8, actor.DefaultAppliers()))

	response := commandHTTP(t, server, CommandHTTPRequest{
		ActorID: "player-1",
		Command: protocol.CommandEnvelopeV2{
			GameID:         "game-replay",
			BaseVersion:    2,
			ClientActionID: "keep-1",
			Type:           "mulligan.keep",
			Payload:        map[string]any{"playerId": "player-1"},
		},
	})

	if response.Event.Version != 3 {
		t.Fatalf("event version got %d want 3", response.Event.Version)
	}
	if response.Metrics["runtime.actor_load_from_snapshot_count"] != float64(1) ||
		response.Metrics["runtime.actor_load_from_events_count"] != float64(1) ||
		response.Metrics["runtime.actor_recovered_event_count"] != float64(1) ||
		response.Metrics["runtime.actor_cache_miss_count"] != float64(1) {
		t.Fatalf("expected snapshot+event recovery metrics: %#v", response.Metrics)
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

func TestCommandHTTPServerReturnsUnknownCommandCodeAndMetric(t *testing.T) {
	runtimeService := runtimesvc.NewService()
	gameActor, _, err := runtimeService.LoadActorFromInitialState(context.Background(), "game-unknown", runtimeMulliganState("game-unknown", "player-1"))
	if err != nil {
		t.Fatalf("load actor: %v", err)
	}
	server := NewCommandHTTPServer(runtimeService)

	body, err := json.Marshal(CommandHTTPRequest{
		ActorID: "player-1",
		Command: protocol.CommandEnvelopeV2{
			GameID:         "game-unknown",
			BaseVersion:    1,
			ClientActionID: "unknown-1",
			Type:           "not.supported",
			Payload:        map[string]any{},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodPost, "/commands", bytes.NewReader(body))
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var response CommandHTTPResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Code != "unknown_command" {
		t.Fatalf("code got %q want unknown_command; body=%s", response.Code, recorder.Body.String())
	}
	if gameActor.Metrics().UnsupportedCount != 1 {
		t.Fatalf("command.unsupported_count got %d want 1", gameActor.Metrics().UnsupportedCount)
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
	server := NewMetricsHTTPServer(runtimeService, staticGatewayMetrics{metrics: GatewayMetrics{
		PatchReplayMemoryCount:  2,
		PatchReplayDurableCount: 1,
		PatchReplayResyncCount:  3,
	}})

	request := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Actors  []actor.ActorMetrics      `json:"actors"`
		Totals  actor.ActorMetrics        `json:"totals"`
		Runtime runtimesvc.RuntimeMetrics `json:"runtime"`
		Gateway *GatewayMetrics           `json:"gateway"`
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
	if response.Runtime.InitialStatePerCommandCount != 0 {
		t.Fatalf("initialState metric got %d want 0", response.Runtime.InitialStatePerCommandCount)
	}
	if response.Runtime.CommandRuntimeCoveragePct != 100 {
		t.Fatalf("command.runtime_coverage_percent got %v want 100", response.Runtime.CommandRuntimeCoveragePct)
	}
	if response.Gateway == nil ||
		response.Gateway.PatchReplayMemoryCount != 2 ||
		response.Gateway.PatchReplayDurableCount != 1 ||
		response.Gateway.PatchReplayResyncCount != 3 {
		t.Fatalf("gateway replay metrics missing from response: %#v", response.Gateway)
	}
}

type staticGatewayMetrics struct {
	metrics GatewayMetrics
}

func (s staticGatewayMetrics) Metrics() GatewayMetrics {
	return s.metrics
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

func saveHTTPRuntimeSnapshot(t *testing.T, store *persistence.InMemoryEventStore, game state.GameState) {
	t.Helper()
	snapshot, err := persistence.NewCompactSnapshot(game)
	if err != nil {
		t.Fatalf("compact snapshot: %v", err)
	}
	if err := store.SaveSnapshot(context.Background(), snapshot); err != nil {
		t.Fatalf("save snapshot: %v", err)
	}
}
