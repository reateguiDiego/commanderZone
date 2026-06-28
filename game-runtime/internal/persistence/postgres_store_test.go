package persistence

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"os"
	"testing"
	"time"
)

func TestPostgresEventStoreAppendReplayIdempotencyAndSnapshots(t *testing.T) {
	store := postgresStoreForTest(t)
	ctx := context.Background()

	if err := store.AppendEvent(ctx, testEvent(2, "a1")); err != nil {
		t.Fatalf("append: %v", err)
	}
	if err := store.AppendEvent(ctx, testEvent(2, "a2")); !errors.Is(err, ErrDuplicateVersion) {
		t.Fatalf("duplicate version err = %v", err)
	}
	if err := store.AppendEvent(ctx, testEvent(3, "a1")); !errors.Is(err, ErrDuplicateClientActionID) {
		t.Fatalf("duplicate client action err = %v", err)
	}

	event, ok, err := store.EventByClientActionID(ctx, "game-1", "a1")
	if err != nil {
		t.Fatal(err)
	}
	if !ok || event.Version != 2 {
		t.Fatalf("event = %#v ok=%v", event, ok)
	}

	events, err := store.EventsAfter(ctx, "game-1", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Version != 2 {
		t.Fatalf("events = %#v", events)
	}

	snapshot, err := NewCompactSnapshot(compactState())
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if err := store.SaveSnapshot(ctx, snapshot); err != nil {
		t.Fatalf("save snapshot: %v", err)
	}
	loaded, ok, err := store.LatestSnapshot(ctx, "game-1")
	if err != nil {
		t.Fatal(err)
	}
	if !ok || loaded.Version != snapshot.Version || loaded.Checksum != snapshot.Checksum {
		t.Fatalf("loaded = %#v ok=%v", loaded, ok)
	}
}

func TestPostgresEventStoreRejectsCorruptSnapshotChecksum(t *testing.T) {
	store := postgresStoreForTest(t)
	ctx := context.Background()
	snapshot, err := NewCompactSnapshot(compactState())
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	payload := `{"gameId":"game-1","version":2,"status":"playing","players":{},"turn":{},"instances":{},"zones":{},"loc":{},"visibility":{"instanceMasks":{},"libraryEpochByOwner":{},"topRevealWindows":{}}}`
	_, err = store.db.ExecContext(ctx, `
INSERT INTO game_snapshot_compact (id, game_id, version, snapshot, checksum, created_at)
VALUES ($1, $2, $3, $4::json, $5, $6)
`, newUUID(), snapshot.GameID, snapshot.Version, payload, "corrupt", time.Now().UTC())
	if err != nil {
		t.Fatalf("insert corrupt snapshot: %v", err)
	}
	if _, _, err := store.LatestSnapshot(ctx, "game-1"); !errors.Is(err, ErrSnapshotChecksumMismatch) {
		t.Fatalf("err = %v, want %v", err, ErrSnapshotChecksumMismatch)
	}
}

func TestPostgresEventStoreAcceptsRawCompactSnapshotChecksum(t *testing.T) {
	store := postgresStoreForTest(t)
	ctx := context.Background()
	payload := `{"runtimeFormat":"compact-v2","gameId":"game-1","version":2,"status":"playing","players":{},"turn":{},"instances":{},"zones":{},"loc":{},"visibility":{"instanceMasks":{},"libraryEpochByOwner":{},"topRevealWindows":{}},"relations":{"attachments":[],"arrows":[],"helpers":[],"indexes":{"attachmentsByEquipment":[],"attachmentsByTarget":[],"arrowsBySource":[],"arrowsByTarget":[]}},"stack":[]}`
	sum := sha256.Sum256([]byte(payload))
	_, err := store.db.ExecContext(ctx, `
INSERT INTO game_snapshot_compact (id, game_id, version, snapshot, checksum, created_at)
VALUES ($1, $2, $3, $4::json, $5, $6)
`, newUUID(), "game-1", 2, payload, hex.EncodeToString(sum[:]), time.Now().UTC())
	if err != nil {
		t.Fatalf("insert raw checksum snapshot: %v", err)
	}
	loaded, ok, err := store.LatestSnapshot(ctx, "game-1")
	if err != nil {
		t.Fatalf("latest snapshot: %v", err)
	}
	if !ok || loaded.GameID != "game-1" || loaded.Version != 2 {
		t.Fatalf("loaded = %#v ok=%v", loaded, ok)
	}
}

func TestPostgresAppendP95IsMeasured(t *testing.T) {
	store := postgresStoreForTest(t)
	ctx := context.Background()
	for version := int64(2); version < 22; version++ {
		if err := store.AppendEvent(ctx, testEvent(version, time.Unix(version, 0).UTC().Format("append-150405"))); err != nil {
			t.Fatalf("append %d: %v", version, err)
		}
	}
	if p95 := store.AppendP95MS(); p95 <= 0 {
		t.Fatalf("append p95 not recorded: %f", p95)
	}
}

func postgresStoreForTest(t *testing.T) *PostgresEventStore {
	t.Helper()
	dsn := os.Getenv("GAME_RUNTIME_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("GAME_RUNTIME_TEST_DATABASE_URL is not set")
	}
	store, err := NewPostgresEventStore(dsn)
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	if err := store.Ping(context.Background()); err != nil {
		t.Fatalf("ping: %v", err)
	}
	resetPostgresSchema(t, store.db)
	return store
}

func resetPostgresSchema(t *testing.T, db *sql.DB) {
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
