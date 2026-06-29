package runtime

import (
	"context"
	"errors"
	"testing"
	"time"

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
	if metrics.ActorLoadFromSnapshotCount != 1 || metrics.ActorLoadFromEventsCount != 1 || metrics.ActorCacheMissCount != 1 {
		t.Fatalf("runtime metrics mismatch: %#v", metrics)
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

func runtimeTestState(gameID string) state.GameState {
	gameState := EmptyInitialState(gameID)
	gameState.Players["p1"] = map[string]any{"life": 40}
	gameState.Players["p2"] = map[string]any{"life": 40}
	gameState.Turn = map[string]any{"activePlayerId": "p1"}
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
