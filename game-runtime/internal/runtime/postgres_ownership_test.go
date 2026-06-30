package runtime

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"testing"
	"time"

	"commanderzone/game-runtime/internal/persistence"
	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestPostgresLeaseRejectsSecondRuntimeAndPreservesDuplicateRetry(t *testing.T) {
	dsn := postgresOwnershipDSN(t)
	resetPostgresOwnershipSchema(t, dsn)
	storeA, managerA := postgresRuntimeComponents(t, dsn, time.Minute)
	storeB, managerB := postgresRuntimeComponents(t, dsn, time.Minute)
	gameID := "pg-game-owned"
	if err := savePostgresRuntimeSnapshot(t, storeA, runtimeTestState(gameID)); err != nil {
		t.Fatalf("save snapshot: %v", err)
	}

	first := NewServiceWithStoreAndOptions(
		storeA,
		8,
		nil,
		WithInstanceID("pg-node-a"),
		WithOwnershipManager(managerA),
		WithOwnershipRenewBefore(time.Hour),
	)
	second := NewServiceWithStoreAndOptions(
		storeB,
		8,
		nil,
		WithInstanceID("pg-node-b"),
		WithOwnershipManager(managerB),
		WithOwnershipRenewBefore(time.Hour),
	)
	defer shutdownService(t, first)
	defer shutdownService(t, second)

	firstActor, _, err := first.LoadActorRecovered(context.Background(), gameID, nil)
	if err != nil {
		t.Fatalf("first recover: %v", err)
	}
	command := protocol.CommandEnvelopeV2{
		GameID:         gameID,
		BaseVersion:    1,
		ClientActionID: "pg-life-owned",
		Type:           "life.changed",
		Payload:        map[string]any{"playerId": "p1", "life": 37},
	}
	applied := firstActor.Submit(context.Background(), command, "p1")
	if applied.Err != nil {
		t.Fatalf("first command failed: %v", applied.Err)
	}
	duplicate := firstActor.Submit(context.Background(), command, "p1")
	if duplicate.Err != nil {
		t.Fatalf("duplicate retry failed: %v", duplicate.Err)
	}
	if duplicate.Event.Version != applied.Event.Version {
		t.Fatalf("duplicate version got %d want %d", duplicate.Event.Version, applied.Event.Version)
	}

	if _, _, err := second.LoadActorRecovered(context.Background(), gameID, nil); !errors.Is(err, ErrOwnershipNotHeld) {
		t.Fatalf("second recover err = %v, want %v", err, ErrOwnershipNotHeld)
	}
	events, err := storeA.EventsAfter(context.Background(), gameID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].ClientActionID != command.ClientActionID {
		t.Fatalf("events = %#v, want one event from first owner", events)
	}
	firstMetrics := first.RuntimeMetrics()
	if firstMetrics.OwnershipAcquireCount != 1 || firstMetrics.OwnershipRenewCount == 0 || firstMetrics.CommandLegacyFallbackCount != 0 {
		t.Fatalf("first ownership metrics mismatch: %#v", firstMetrics)
	}
	secondMetrics := second.RuntimeMetrics()
	if secondMetrics.OwnershipRejectCount != 1 || secondMetrics.CommandLegacyFallbackCount != 0 {
		t.Fatalf("second ownership metrics mismatch: %#v", secondMetrics)
	}
}

func TestPostgresLeaseExpiryAllowsStealAndFencesStaleOwner(t *testing.T) {
	dsn := postgresOwnershipDSN(t)
	resetPostgresOwnershipSchema(t, dsn)
	storeA, managerA := postgresRuntimeComponents(t, dsn, 75*time.Millisecond)
	storeB, managerB := postgresRuntimeComponents(t, dsn, time.Minute)
	gameID := "pg-game-stale-owner"
	if err := savePostgresRuntimeSnapshot(t, storeA, runtimeTestState(gameID)); err != nil {
		t.Fatalf("save snapshot: %v", err)
	}

	first := NewServiceWithStoreAndOptions(storeA, 8, nil, WithInstanceID("pg-node-a"), WithOwnershipManager(managerA), WithOwnershipRenewBefore(time.Hour))
	second := NewServiceWithStoreAndOptions(storeB, 8, nil, WithInstanceID("pg-node-b"), WithOwnershipManager(managerB), WithOwnershipRenewBefore(time.Hour))
	defer shutdownService(t, first)
	defer shutdownService(t, second)

	staleActor, _, err := first.LoadActorRecovered(context.Background(), gameID, nil)
	if err != nil {
		t.Fatalf("first recover: %v", err)
	}
	time.Sleep(125 * time.Millisecond)
	freshActor, _, err := second.LoadActorRecovered(context.Background(), gameID, nil)
	if err != nil {
		t.Fatalf("second recover after expiry: %v", err)
	}

	stale := staleActor.Submit(context.Background(), protocol.CommandEnvelopeV2{
		GameID:         gameID,
		BaseVersion:    1,
		ClientActionID: "pg-stale-life",
		Type:           "life.changed",
		Payload:        map[string]any{"playerId": "p1", "life": 36},
	}, "p1")
	if !errors.Is(stale.Err, ErrOwnershipNotHeld) {
		t.Fatalf("stale command err = %v, want %v", stale.Err, ErrOwnershipNotHeld)
	}

	fresh := freshActor.Submit(context.Background(), protocol.CommandEnvelopeV2{
		GameID:         gameID,
		BaseVersion:    1,
		ClientActionID: "pg-fresh-life",
		Type:           "life.changed",
		Payload:        map[string]any{"playerId": "p1", "life": 35},
	}, "p1")
	if fresh.Err != nil {
		t.Fatalf("fresh owner command failed: %v", fresh.Err)
	}
	events, err := storeA.EventsAfter(context.Background(), gameID, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].ClientActionID != "pg-fresh-life" {
		t.Fatalf("events = %#v, want only fresh owner event", events)
	}
	secondMetrics := second.RuntimeMetrics()
	if secondMetrics.OwnershipStolenCount != 1 || secondMetrics.OwnershipExpiredCount != 1 {
		t.Fatalf("second ownership metrics mismatch: %#v", secondMetrics)
	}
	firstMetrics := first.RuntimeMetrics()
	if firstMetrics.OwnershipLostCount != 1 || firstMetrics.OwnershipRejectCount != 1 {
		t.Fatalf("first ownership metrics mismatch: %#v", firstMetrics)
	}
}

func TestPostgresLeaseManagerRenewAndSchemaCheck(t *testing.T) {
	dsn := postgresOwnershipDSN(t)
	resetPostgresOwnershipSchema(t, dsn)
	_, manager := postgresRuntimeComponents(t, dsn, time.Minute)
	if err := manager.CheckSchema(context.Background()); err != nil {
		t.Fatalf("schema check: %v", err)
	}
	acquired, err := manager.Acquire(context.Background(), "pg-game-renew", "pg-node-a")
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	renewed, err := manager.Renew(context.Background(), acquired.Lease)
	if err != nil {
		t.Fatalf("renew: %v", err)
	}
	if renewed.Token != acquired.Lease.Token || !renewed.ExpiresAt.After(acquired.Lease.ExpiresAt) {
		t.Fatalf("renewed lease = %#v, acquired = %#v", renewed, acquired.Lease)
	}
}

func postgresOwnershipDSN(t *testing.T) string {
	t.Helper()
	dsn := os.Getenv("GAME_RUNTIME_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("GAME_RUNTIME_TEST_DATABASE_URL is not set")
	}
	return dsn
}

func postgresRuntimeComponents(t *testing.T, dsn string, ttl time.Duration) (*persistence.PostgresEventStore, *PostgresOwnershipManager) {
	t.Helper()
	store, err := persistence.NewPostgresEventStore(dsn)
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	manager, err := NewPostgresOwnershipManager(dsn, ttl)
	if err != nil {
		t.Fatalf("manager: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	t.Cleanup(func() { _ = manager.Close() })
	if err := store.Ping(context.Background()); err != nil {
		t.Fatalf("store ping: %v", err)
	}
	if err := manager.Ping(context.Background()); err != nil {
		t.Fatalf("manager ping: %v", err)
	}
	return store, manager
}

func savePostgresRuntimeSnapshot(t *testing.T, store persistence.EventStore, gameState state.GameState) error {
	t.Helper()
	snapshot, err := persistence.NewCompactSnapshot(gameState)
	if err != nil {
		return err
	}
	return store.SaveSnapshot(context.Background(), snapshot)
}

func resetPostgresOwnershipSchema(t *testing.T, dsn string) {
	t.Helper()
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("open postgres: %v", err)
	}
	defer db.Close()
	statements := []string{
		`DROP TABLE IF EXISTS game_runtime_lease`,
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
		`CREATE TABLE game_runtime_lease (
			game_id VARCHAR(36) NOT NULL PRIMARY KEY,
			owner_instance_id VARCHAR(120) NOT NULL,
			fencing_token BIGINT NOT NULL,
			expires_at TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL,
			updated_at TIMESTAMP(6) WITHOUT TIME ZONE NOT NULL
		)`,
		`CREATE INDEX idx_game_runtime_lease_owner ON game_runtime_lease (owner_instance_id)`,
		`CREATE INDEX idx_game_runtime_lease_expires_at ON game_runtime_lease (expires_at)`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			t.Fatalf("schema statement failed: %v\n%s", err, statement)
		}
	}
}
