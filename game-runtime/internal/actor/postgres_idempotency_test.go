package actor

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"commanderzone/game-runtime/internal/persistence"
	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestPostgresActorDuplicateAppendConstraintRecoversDurableReceipt(t *testing.T) {
	store, db := postgresActorStoreForTest(t)
	ctx := context.Background()
	initial := testState()
	if err := saveActorPostgresSnapshot(ctx, store, initial); err != nil {
		t.Fatalf("save compact snapshot: %v", err)
	}

	command := command(initial.GameID, 1, "pg-idempotent-life", "life.changed", map[string]any{"playerId": "p1", "life": 37})
	firstActor := NewGameActorWithSnapshotPolicy(initial.GameID, initial, store, 8, DefaultAppliers(), SnapshotPolicy{})
	first := firstActor.ApplyDirect(ctx, command, "p1")
	if first.Err != nil {
		t.Fatalf("first command failed: %v", first.Err)
	}

	// Simulate the stale pre-append read that can happen during a future
	// multi-node duplicate retry. The append still goes to real Postgres and
	// must be resolved by durable unique constraints plus clientActionId lookup.
	staleStore := &precheckMissStore{
		EventStore:     store,
		clientActionID: command.ClientActionID,
		missesLeft:     1,
	}
	staleActor := NewGameActorWithSnapshotPolicy(initial.GameID, initial, staleStore, 8, DefaultAppliers(), SnapshotPolicy{})
	retry := staleActor.ApplyDirect(ctx, command, "p1")
	if retry.Err != nil {
		t.Fatalf("retry command failed: %v", retry.Err)
	}
	if retry.Event.Version != first.Event.Version {
		t.Fatalf("retry version got %d want %d", retry.Event.Version, first.Event.Version)
	}
	if !patchesEqualJSON(t, retry.Patches, first.Patches) {
		t.Fatalf("retry patches mismatch:\nretry=%#v\nfirst=%#v", retry.Patches, first.Patches)
	}

	events, err := store.EventsAfter(ctx, initial.GameID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Version != 2 || events[0].ClientActionID != command.ClientActionID {
		t.Fatalf("events = %#v, want one durable event at version 2", events)
	}
	eventCount := countPostgresEvents(t, db, initial.GameID)
	versionCount := countPostgresVersions(t, db, initial.GameID)
	if eventCount != 1 || versionCount != 1 {
		t.Fatalf("postgres counts event=%d version=%d, want 1/1", eventCount, versionCount)
	}
	stored, ok, err := store.EventByClientActionID(ctx, initial.GameID, command.ClientActionID)
	if err != nil {
		t.Fatal(err)
	}
	if !ok || stored.Version != first.Event.Version {
		t.Fatalf("stored event = %#v ok=%v, want version %d", stored, ok, first.Event.Version)
	}
	patches, hasReceipt, err := runtimePatchReceiptFromEvent(stored)
	if err != nil {
		t.Fatalf("restore patch receipt: %v", err)
	}
	if !hasReceipt || !patchesEqualJSON(t, patches, first.Patches) {
		t.Fatalf("stored receipt mismatch hasReceipt=%v patches=%#v first=%#v", hasReceipt, patches, first.Patches)
	}
	reconstructed, err := staleActor.resultFromStoredEvent(stored)
	if err != nil {
		t.Fatalf("reconstruct from stored event: %v", err)
	}
	if reconstructed.Event.Version != first.Event.Version || !patchesEqualJSON(t, reconstructed.Patches, first.Patches) {
		t.Fatalf("reconstructed result mismatch: %#v", reconstructed)
	}
	metrics := staleActor.Metrics()
	if metrics.DuplicateDurableCount != 1 ||
		metrics.DuplicateMemoryCount != 0 ||
		metrics.DuplicateReceiptMissingCount != 0 ||
		metrics.CommandAppliedCount != 0 {
		t.Fatalf("stale retry metrics mismatch: %#v", metrics)
	}
}

func TestPostgresActorDuplicateLegacyEventMissingReceiptFailsExplicitly(t *testing.T) {
	store, db := postgresActorStoreForTest(t)
	ctx := context.Background()
	initial := testState()
	if err := saveActorPostgresSnapshot(ctx, store, initial); err != nil {
		t.Fatalf("save compact snapshot: %v", err)
	}
	legacy := protocol.EventPayloadV2{
		GameID:         initial.GameID,
		Version:        2,
		Type:           "life.changed",
		Payload:        map[string]any{"playerId": "p1", "life": 37},
		CreatedBy:      "p1",
		ClientActionID: "pg-legacy-no-receipt",
		CreatedAt:      time.Now().UTC(),
	}
	if err := store.AppendEvent(ctx, legacy); err != nil {
		t.Fatalf("append legacy event: %v", err)
	}

	gameActor := NewGameActorWithSnapshotPolicy(initial.GameID, initial, store, 8, DefaultAppliers(), SnapshotPolicy{})
	retry := gameActor.ApplyDirect(ctx, command(initial.GameID, 1, legacy.ClientActionID, "life.changed", map[string]any{"playerId": "p1", "life": 37}), "p1")
	if !errors.Is(retry.Err, ErrRuntimePatchReceiptMissing) {
		t.Fatalf("retry err got %v want %v", retry.Err, ErrRuntimePatchReceiptMissing)
	}
	if len(retry.Patches) != 0 {
		t.Fatalf("legacy event without receipt returned patches: %#v", retry.Patches)
	}
	if count := countPostgresEvents(t, db, initial.GameID); count != 1 {
		t.Fatalf("postgres event count got %d want 1", count)
	}
	metrics := gameActor.Metrics()
	if metrics.DuplicateDurableCount != 1 ||
		metrics.DuplicateReceiptMissingCount != 1 ||
		metrics.CommandRejectedCount != 1 ||
		metrics.CommandAppliedCount != 0 {
		t.Fatalf("receipt missing metrics mismatch: %#v", metrics)
	}
}

type precheckMissStore struct {
	persistence.EventStore
	clientActionID string
	missesLeft     int32
}

func (s *precheckMissStore) EventByClientActionID(ctx context.Context, gameID string, clientActionID string) (protocol.EventPayloadV2, bool, error) {
	if clientActionID == s.clientActionID && atomic.AddInt32(&s.missesLeft, -1) >= 0 {
		return protocol.EventPayloadV2{}, false, nil
	}
	return s.EventStore.EventByClientActionID(ctx, gameID, clientActionID)
}

func postgresActorStoreForTest(t *testing.T) (*persistence.PostgresEventStore, *sql.DB) {
	t.Helper()
	dsn := os.Getenv("GAME_RUNTIME_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("GAME_RUNTIME_TEST_DATABASE_URL is not set")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	store := persistence.NewPostgresEventStoreWithDB(db)
	t.Cleanup(func() { _ = store.Close() })
	if err := store.Ping(context.Background()); err != nil {
		t.Fatalf("ping postgres: %v", err)
	}
	resetActorPostgresSchema(t, db)
	return store, db
}

func saveActorPostgresSnapshot(ctx context.Context, store persistence.EventStore, gameState state.GameState) error {
	snapshot, err := persistence.NewCompactSnapshot(gameState)
	if err != nil {
		return err
	}
	return store.SaveSnapshot(ctx, snapshot)
}

func resetActorPostgresSchema(t *testing.T, db *sql.DB) {
	t.Helper()
	statements := []string{
		`DROP TABLE IF EXISTS game_snapshot_compact`,
		`DROP TABLE IF EXISTS game_event`,
		`CREATE TABLE game_event (
			id VARCHAR(36) NOT NULL PRIMARY KEY,
			game_id VARCHAR(36) NOT NULL,
			created_by_id VARCHAR(36) DEFAULT NULL,
			type VARCHAR(80) NOT NULL,
			payload JSON NOT NULL,
			version INT NOT NULL,
			client_action_id VARCHAR(120) DEFAULT NULL,
			created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
			updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL
		)`,
		`CREATE UNIQUE INDEX uniq_game_event_version ON game_event (game_id, version)`,
		`CREATE UNIQUE INDEX uniq_game_event_client_action ON game_event (game_id, client_action_id)`,
		`CREATE INDEX idx_game_event_game_created_at ON game_event (game_id, created_at)`,
		`CREATE TABLE game_snapshot_compact (
			id VARCHAR(36) NOT NULL PRIMARY KEY,
			game_id VARCHAR(36) NOT NULL,
			version INT NOT NULL,
			snapshot JSON NOT NULL,
			checksum VARCHAR(64) NOT NULL,
			created_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL
		)`,
		`CREATE UNIQUE INDEX uniq_game_snapshot_compact_version ON game_snapshot_compact (game_id, version)`,
		`CREATE INDEX idx_game_snapshot_compact_created_at ON game_snapshot_compact (game_id, created_at)`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			t.Fatalf("schema statement failed: %v\n%s", err, statement)
		}
	}
}

func countPostgresEvents(t *testing.T, db *sql.DB, gameID string) int {
	t.Helper()
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM game_event WHERE game_id = $1`, gameID).Scan(&count); err != nil {
		t.Fatalf("count game_event: %v", err)
	}
	return count
}

func countPostgresVersions(t *testing.T, db *sql.DB, gameID string) int {
	t.Helper()
	var count int
	if err := db.QueryRow(`SELECT COUNT(DISTINCT version) FROM game_event WHERE game_id = $1`, gameID).Scan(&count); err != nil {
		t.Fatalf("count game_event versions: %v", err)
	}
	return count
}

func patchesEqualJSON(t *testing.T, left []protocol.PatchEnvelopeV2, right []protocol.PatchEnvelopeV2) bool {
	t.Helper()
	leftPayload, err := json.Marshal(left)
	if err != nil {
		t.Fatalf("marshal left patches: %v", err)
	}
	rightPayload, err := json.Marshal(right)
	if err != nil {
		t.Fatalf("marshal right patches: %v", err)
	}
	var leftNormalized any
	if err := json.Unmarshal(leftPayload, &leftNormalized); err != nil {
		t.Fatalf("unmarshal left patches: %v", err)
	}
	var rightNormalized any
	if err := json.Unmarshal(rightPayload, &rightNormalized); err != nil {
		t.Fatalf("unmarshal right patches: %v", err)
	}
	return jsonEqual(leftNormalized, rightNormalized)
}

func jsonEqual(left any, right any) bool {
	leftPayload, err := json.Marshal(left)
	if err != nil {
		return false
	}
	rightPayload, err := json.Marshal(right)
	if err != nil {
		return false
	}
	return string(leftPayload) == string(rightPayload)
}
