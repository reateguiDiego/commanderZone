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
	service := NewService()
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		if err := service.Shutdown(ctx); err != nil {
			t.Fatalf("shutdown failed: %v", err)
		}
	}()

	first, created := service.LoadActor(context.Background(), "game-1", EmptyInitialState("game-1"))
	if !created {
		t.Fatal("expected first load to create actor")
	}
	second, created := service.LoadActor(context.Background(), "game-1", EmptyInitialState("game-1"))
	if created {
		t.Fatal("expected second load to reuse actor")
	}
	if first != second {
		t.Fatal("expected same actor for same gameId")
	}
}

func TestServiceShutdownStopsActors(t *testing.T) {
	service := NewService()
	gameActor, _ := service.LoadActor(context.Background(), "game-1", EmptyInitialState("game-1"))
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

	service := NewServiceWithStore(store, 8, nil)
	gameActor, _, err := service.LoadActorRecovered(context.Background(), "game-1", initial)
	if err != nil {
		t.Fatalf("recover: %v", err)
	}
	snapshot := gameActor.Snapshot()
	if snapshot.Version != 3 || snapshot.Players["p1"]["life"] != 38 || snapshot.Turn["activePlayerId"] != "p2" {
		t.Fatalf("snapshot = %#v", snapshot)
	}
}

func TestServiceRecoveryFailsOnCorruptSnapshotChecksum(t *testing.T) {
	snapshot, err := persistence.NewCompactSnapshot(runtimeTestState("game-1"))
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	snapshot.Checksum = "corrupt"

	service := NewServiceWithStore(corruptSnapshotStore{snapshot: snapshot}, 8, nil)
	if _, _, err := service.LoadActorRecovered(context.Background(), "game-1", runtimeTestState("game-1")); !errors.Is(err, persistence.ErrSnapshotChecksumMismatch) {
		t.Fatalf("err = %v, want %v", err, persistence.ErrSnapshotChecksumMismatch)
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
