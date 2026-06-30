package runtime

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"commanderzone/game-runtime/internal/actor"
	"commanderzone/game-runtime/internal/persistence"
	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

func TestServiceLoadActorIsIdempotentByGameID(t *testing.T) {
	store := persistence.NewInMemoryEventStore()
	if err := saveRuntimeSnapshot(t, store, EmptyInitialState("game-1")); err != nil {
		t.Fatalf("save snapshot: %v", err)
	}
	service := NewServiceWithStore(store, 8, nil)
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := service.Shutdown(ctx); err != nil {
			t.Fatalf("shutdown failed: %v", err)
		}
	}()

	first, created := service.LoadActor(context.Background(), "game-1")
	if !created {
		t.Fatal("expected first load to create actor")
	}
	second, created := service.LoadActor(context.Background(), "game-1")
	if created {
		t.Fatal("expected second load to reuse actor")
	}
	if first != second {
		t.Fatal("expected same actor for same gameId")
	}
	metrics := service.RuntimeMetrics()
	if metrics.ActorCacheMissCount != 1 || metrics.ActorCacheHitCount != 1 || metrics.ActorLoadFromSnapshotCount != 1 {
		t.Fatalf("runtime metrics mismatch: %#v", metrics)
	}
}

func TestServiceShutdownStopsActors(t *testing.T) {
	store := persistence.NewInMemoryEventStore()
	if err := saveRuntimeSnapshot(t, store, EmptyInitialState("game-1")); err != nil {
		t.Fatalf("save snapshot: %v", err)
	}
	service := NewServiceWithStore(store, 8, nil)
	gameActor, _ := service.LoadActor(context.Background(), "game-1")
	before := gameActor.Heartbeat()
	gameActor.TouchHeartbeat()
	if !gameActor.Heartbeat().After(before) && !gameActor.Heartbeat().Equal(before) {
		t.Fatal("heartbeat moved backwards")
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := service.Shutdown(ctx); err != nil {
		t.Fatalf("shutdown failed: %v", err)
	}
	if _, ok := service.Actor("game-1"); ok {
		t.Fatal("actor still registered after shutdown")
	}
}

func TestServiceRecoversFromCompactSnapshotAndEvents(t *testing.T) {
	store := persistence.NewInMemoryEventStore()
	initial := runtimeTestState("game-1")
	first := protocol.EventPayloadV2{
		GameID:         "game-1",
		Version:        2,
		Type:           "life.changed",
		Payload:        map[string]any{"playerId": "p1", "life": 38},
		CreatedBy:      "p1",
		ClientActionID: "a1",
		CreatedAt:      time.Now().UTC(),
	}
	second := protocol.EventPayloadV2{
		GameID:         "game-1",
		Version:        3,
		Type:           "turn.changed",
		Payload:        map[string]any{"activePlayerId": "p2"},
		CreatedBy:      "p1",
		ClientActionID: "a2",
		CreatedAt:      time.Now().UTC(),
	}
	if err := store.AppendEvent(context.Background(), first); err != nil {
		t.Fatalf("append first: %v", err)
	}
	if err := store.AppendEvent(context.Background(), second); err != nil {
		t.Fatalf("append second: %v", err)
	}
	if err := saveRuntimeSnapshot(t, store, initial); err != nil {
		t.Fatalf("save snapshot: %v", err)
	}

	service := NewServiceWithStore(store, 8, nil)
	gameActor, _, err := service.LoadActorRecovered(context.Background(), "game-1", nil)
	if err != nil {
		t.Fatalf("recover: %v", err)
	}
	snapshot := gameActor.Snapshot()
	if snapshot.Version != 3 || snapshot.Players["p1"]["life"] != 38 || snapshot.Turn["activePlayerId"] != "p2" {
		t.Fatalf("snapshot = %#v", snapshot)
	}
	metrics := service.RuntimeMetrics()
	if metrics.ActorLoadFromSnapshotCount != 1 || metrics.ActorLoadFromEventsCount != 1 || metrics.ActorRecoveredEventCount != 2 || metrics.ActorCacheMissCount != 1 {
		t.Fatalf("runtime metrics mismatch: %#v", metrics)
	}
}

func TestServiceRestartRecoversFromSavedCompactSnapshotWithoutInitialState(t *testing.T) {
	store := persistence.NewInMemoryEventStore()
	initial := runtimeTestState("game-1")
	if err := saveRuntimeSnapshot(t, store, initial); err != nil {
		t.Fatalf("save snapshot: %v", err)
	}
	firstService := NewServiceWithStore(store, 8, nil)
	gameActor, _, err := firstService.LoadActorRecovered(context.Background(), "game-1", nil)
	if err != nil {
		t.Fatalf("initial recover: %v", err)
	}
	result := gameActor.ApplyDirect(context.Background(), protocol.CommandEnvelopeV2{
		GameID:         "game-1",
		BaseVersion:    1,
		ClientActionID: "life-1",
		Type:           "life.changed",
		Payload:        map[string]any{"playerId": "p1", "life": 37},
	}, "p1")
	if result.Err != nil {
		t.Fatalf("apply failed: %v", result.Err)
	}

	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), time.Second)
	defer cancelShutdown()
	if err := firstService.Shutdown(shutdownCtx); err != nil {
		t.Fatalf("shutdown failed: %v", err)
	}

	restarted := NewServiceWithStore(store, 8, nil)
	recoveredActor, created, err := restarted.LoadActorRecovered(context.Background(), "game-1", nil)
	if err != nil {
		t.Fatalf("restart recover: %v", err)
	}
	if !created {
		t.Fatal("expected restart recovery to create a fresh actor")
	}
	recovered := recoveredActor.Snapshot()
	if recovered.Version != 2 || recovered.Players["p1"]["life"] != 37 {
		t.Fatalf("recovered snapshot = %#v", recovered)
	}
	metrics := restarted.RuntimeMetrics()
	if metrics.ActorCacheMissCount != 1 || metrics.ActorLoadFromSnapshotCount != 1 || metrics.ActorRecoveredEventCount != 0 {
		t.Fatalf("restart metrics mismatch: %#v", metrics)
	}
}

func TestServiceRetryPostRestartReconstructsPatchesAfterSnapshotFailure(t *testing.T) {
	gameID := "game-retry"
	store := persistence.NewInMemoryEventStore()
	initial := runtimePrivateState(gameID)
	if err := saveRuntimeSnapshot(t, store, initial); err != nil {
		t.Fatalf("save snapshot: %v", err)
	}
	failingStore := snapshotFailRuntimeStore{
		EventStore: store,
		err:        errors.New("snapshot failed"),
	}
	firstActor := actor.NewGameActorWithSnapshotPolicy(gameID, initial, failingStore, 8, actor.DefaultAppliers(), actor.SnapshotPolicy{EveryEvents: 1})
	command := protocol.CommandEnvelopeV2{
		GameID:         gameID,
		BaseVersion:    1,
		ClientActionID: "face-private-retry",
		Type:           "card.face.changed",
		Payload: map[string]any{
			"instanceId": "h1",
			"faceIndex":  1,
		},
	}
	first := firstActor.ApplyDirect(context.Background(), command, "p1")
	if first.Err != nil {
		t.Fatalf("first command failed: %v", first.Err)
	}
	if firstActor.Metrics().SnapshotPostAppendFailureCount != 1 {
		t.Fatalf("snapshot failure metric = %#v, want one post-append failure", firstActor.Metrics())
	}
	events, err := store.EventsAfter(context.Background(), gameID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Fatalf("events got %d want 1", len(events))
	}

	restarted := NewServiceWithStore(store, 8, actor.DefaultAppliers())
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := restarted.Shutdown(ctx); err != nil {
			t.Fatalf("shutdown failed: %v", err)
		}
	}()
	recoveredActor, created, err := restarted.LoadActorRecovered(context.Background(), gameID, nil)
	if err != nil {
		t.Fatalf("restart recovery failed: %v", err)
	}
	if !created {
		t.Fatal("expected cache miss to create recovered actor")
	}

	retryCtx, cancelRetry := context.WithTimeout(context.Background(), time.Second)
	defer cancelRetry()
	retry := recoveredActor.Submit(retryCtx, command, "p1")
	if retry.Err != nil {
		t.Fatalf("retry failed: %v", retry.Err)
	}
	if retry.Event.Version != first.Event.Version {
		t.Fatalf("retry version got %d want %d", retry.Event.Version, first.Event.Version)
	}
	if !reflect.DeepEqual(retry.Patches, first.Patches) {
		t.Fatalf("retry patches mismatch:\nretry=%#v\nfirst=%#v", retry.Patches, first.Patches)
	}
	if len(retry.Patches) != 2 || retry.Patches[1].Visibility != protocol.VisibilityPublic || retry.Patches[1].Ops[0].Op != "version.advance" {
		t.Fatalf("retry did not preserve private patch plus public carrier: %#v", retry.Patches)
	}
	events, err = store.EventsAfter(context.Background(), gameID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Fatalf("retry appended duplicate events: got %d want 1", len(events))
	}
	actorMetrics := recoveredActor.Metrics()
	if actorMetrics.DuplicateActionCount != 1 || actorMetrics.CommandAppliedCount != 0 || actorMetrics.LegacyFallbackCount != 0 {
		t.Fatalf("retry actor metrics mismatch: %#v", actorMetrics)
	}
	runtimeMetrics := restarted.RuntimeMetrics()
	if runtimeMetrics.ActorCacheMissCount != 1 || runtimeMetrics.ActorLoadFromSnapshotCount != 1 || runtimeMetrics.ActorLoadFromEventsCount != 1 || runtimeMetrics.ActorRecoveredEventCount != 1 || runtimeMetrics.CommandLegacyFallbackCount != 0 {
		t.Fatalf("restart runtime metrics mismatch: %#v", runtimeMetrics)
	}
}

func TestServiceRecoveryRejectsVersionGapAfterCompactSnapshot(t *testing.T) {
	store := persistence.NewInMemoryEventStore()
	if err := saveRuntimeSnapshot(t, store, runtimeTestState("game-1")); err != nil {
		t.Fatalf("save snapshot: %v", err)
	}
	gap := protocol.EventPayloadV2{
		GameID:         "game-1",
		Version:        3,
		Type:           "life.changed",
		Payload:        map[string]any{"playerId": "p1", "life": 36},
		CreatedBy:      "p1",
		ClientActionID: "gap-3",
		CreatedAt:      time.Now().UTC(),
	}
	if err := store.AppendEvent(context.Background(), gap); err != nil {
		t.Fatalf("append gap event: %v", err)
	}

	service := NewServiceWithStore(store, 8, nil)
	if _, _, err := service.LoadActorRecovered(context.Background(), "game-1", nil); !errors.Is(err, actor.ErrVersionConflict) {
		t.Fatalf("err = %v, want %v", err, actor.ErrVersionConflict)
	}
	if _, ok := service.Actor("game-1"); ok {
		t.Fatal("actor should not be registered after failed recovery")
	}
	metrics := service.RuntimeMetrics()
	if metrics.ActorLoadFromSnapshotCount != 1 || metrics.ActorLoadFromEventsCount != 1 || metrics.ActorRecoveredEventCount != 1 {
		t.Fatalf("gap recovery metrics mismatch: %#v", metrics)
	}
}

func TestServiceRecoveryWithoutCompactSnapshotIgnoresEventsAsInvalidFinalState(t *testing.T) {
	store := persistence.NewInMemoryEventStore()
	event := protocol.EventPayloadV2{
		GameID:         "game-1",
		Version:        2,
		Type:           "life.changed",
		Payload:        map[string]any{"playerId": "p1", "life": 39},
		CreatedBy:      "p1",
		ClientActionID: "event-only",
		CreatedAt:      time.Now().UTC(),
	}
	if err := store.AppendEvent(context.Background(), event); err != nil {
		t.Fatalf("append event: %v", err)
	}

	service := NewServiceWithStore(store, 8, nil)
	if _, _, err := service.LoadActorRecovered(context.Background(), "game-1", nil); !errors.Is(err, ErrActorStateNotFound) {
		t.Fatalf("err = %v, want %v", err, ErrActorStateNotFound)
	}
	metrics := service.RuntimeMetrics()
	if metrics.ActorCacheMissCount != 1 || metrics.ActorLoadFromSnapshotCount != 0 || metrics.ActorLoadFromEventsCount != 0 || metrics.ActorRecoveredEventCount != 0 {
		t.Fatalf("event-only metrics mismatch: %#v", metrics)
	}
}

func TestServiceRecoveryFailsOnCorruptSnapshotChecksum(t *testing.T) {
	snapshot, err := persistence.NewCompactSnapshot(runtimeTestState("game-1"))
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	snapshot.Checksum = "corrupt"

	service := NewServiceWithStore(corruptSnapshotStore{snapshot: snapshot}, 8, nil)
	if _, _, err := service.LoadActorRecovered(context.Background(), "game-1", nil); !errors.Is(err, persistence.ErrSnapshotChecksumMismatch) {
		t.Fatalf("err = %v, want %v", err, persistence.ErrSnapshotChecksumMismatch)
	}
}

func TestServiceRecoveryWithoutSnapshotOrMigrationInitialStateFails(t *testing.T) {
	service := NewServiceWithStore(persistence.NewInMemoryEventStore(), 8, nil)
	if _, _, err := service.LoadActorRecovered(context.Background(), "missing-game", nil); !errors.Is(err, ErrActorStateNotFound) {
		t.Fatalf("err = %v, want %v", err, ErrActorStateNotFound)
	}
}

type corruptSnapshotStore struct {
	snapshot persistence.CompactSnapshot
}

func (s corruptSnapshotStore) AppendEvent(context.Context, protocol.EventPayloadV2) error {
	return nil
}

func (s corruptSnapshotStore) EventByClientActionID(context.Context, string, string) (protocol.EventPayloadV2, bool, error) {
	return protocol.EventPayloadV2{}, false, nil
}

func (s corruptSnapshotStore) LatestSnapshot(context.Context, string) (persistence.CompactSnapshot, bool, error) {
	return s.snapshot, true, persistence.VerifySnapshot(s.snapshot)
}

func (s corruptSnapshotStore) EventsAfter(context.Context, string, int64) ([]protocol.EventPayloadV2, error) {
	return nil, nil
}

func (s corruptSnapshotStore) SaveSnapshot(context.Context, persistence.CompactSnapshot) error {
	return nil
}

type snapshotFailRuntimeStore struct {
	persistence.EventStore
	err error
}

func (s snapshotFailRuntimeStore) SaveSnapshot(context.Context, persistence.CompactSnapshot) error {
	return s.err
}

func runtimeTestState(gameID string) state.GameState {
	gameState := EmptyInitialState(gameID)
	gameState.Players["p1"] = map[string]any{"life": 40}
	gameState.Players["p2"] = map[string]any{"life": 40}
	gameState.Turn = map[string]any{"activePlayerId": "p1"}
	return gameState
}

func runtimePrivateState(gameID string) state.GameState {
	gameState := runtimeTestState(gameID)
	gameState.Instances["h1"] = state.CardInstanceRuntime{
		InstanceID:   "h1",
		CardKey:      "hand-1@1",
		OwnerID:      "p1",
		ControllerID: "p1",
		Zone:         state.ZoneHand,
	}
	gameState.Zones["p1"] = state.PlayerZones{Hand: []string{"h1"}}
	gameState.Loc["h1"] = state.Location{PlayerID: "p1", Zone: state.ZoneHand, Index: 0, ControllerID: "p1"}
	return gameState
}

func saveRuntimeSnapshot(t *testing.T, store *persistence.InMemoryEventStore, game state.GameState) error {
	t.Helper()
	snapshot, err := persistence.NewCompactSnapshot(game)
	if err != nil {
		return err
	}
	return store.SaveSnapshot(context.Background(), snapshot)
}
