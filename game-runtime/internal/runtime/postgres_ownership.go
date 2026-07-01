package runtime

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

const (
	defaultPostgresOwnershipTTL         = 15 * time.Second
	defaultPostgresOwnershipRenewBefore = 5 * time.Second
)

type PostgresOwnershipManager struct {
	db  *sql.DB
	ttl time.Duration
	now func() time.Time
}

func NewPostgresOwnershipManager(databaseURL string, ttl time.Duration) (*PostgresOwnershipManager, error) {
	if strings.TrimSpace(databaseURL) == "" {
		return nil, errors.New("database url is required")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(30 * time.Minute)
	return NewPostgresOwnershipManagerWithDB(db, ttl), nil
}

func NewPostgresOwnershipManagerWithDB(db *sql.DB, ttl time.Duration) *PostgresOwnershipManager {
	if ttl <= 0 {
		ttl = defaultPostgresOwnershipTTL
	}
	return &PostgresOwnershipManager{
		db:  db,
		ttl: ttl,
		now: func() time.Time { return time.Now().UTC() },
	}
}

func (m *PostgresOwnershipManager) Close() error {
	return m.db.Close()
}

func (m *PostgresOwnershipManager) Ping(ctx context.Context) error {
	return m.db.PingContext(ctx)
}

func (m *PostgresOwnershipManager) CheckSchema(ctx context.Context) error {
	var exists bool
	if err := m.db.QueryRowContext(ctx, `SELECT to_regclass('public.game_runtime_lease') IS NOT NULL`).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return errors.New("game_runtime_lease table is missing")
	}
	return nil
}

func (m *PostgresOwnershipManager) Mode() string {
	return "postgres-lease"
}

func (m *PostgresOwnershipManager) Acquire(ctx context.Context, gameID string, ownerID string) (OwnershipAcquireResult, error) {
	gameID = strings.TrimSpace(gameID)
	ownerID = strings.TrimSpace(ownerID)
	if gameID == "" {
		return OwnershipAcquireResult{}, fmt.Errorf("%w: gameId is required", ErrOwnershipNotHeld)
	}
	if ownerID == "" {
		return OwnershipAcquireResult{}, fmt.Errorf("%w: ownerId is required", ErrOwnershipNotHeld)
	}

	now := m.now()
	expiresAt := now.Add(m.ttl)
	inserted, err := m.insertLease(ctx, gameID, ownerID, expiresAt, now)
	if err != nil {
		return OwnershipAcquireResult{}, err
	}
	if inserted.Token != 0 {
		return OwnershipAcquireResult{Lease: inserted}, nil
	}

	existing, ok, err := m.currentLease(ctx, gameID)
	if err != nil {
		return OwnershipAcquireResult{}, err
	}
	if !ok {
		return OwnershipAcquireResult{}, fmt.Errorf("%w: game %s lease disappeared", ErrOwnershipNotHeld, gameID)
	}
	if existing.OwnerID == ownerID && now.Before(existing.ExpiresAt) {
		renewed, err := m.renewLease(ctx, existing, expiresAt, now)
		if err != nil {
			return OwnershipAcquireResult{}, err
		}
		return OwnershipAcquireResult{Lease: renewed, Reacquired: true, Renewed: true}, nil
	}
	if now.Before(existing.ExpiresAt) {
		return OwnershipAcquireResult{}, fmt.Errorf("%w: game %s is owned by %s", ErrOwnershipNotHeld, gameID, existing.OwnerID)
	}

	stolen, ok, err := m.stealExpiredLease(ctx, existing, ownerID, expiresAt, now)
	if err != nil {
		return OwnershipAcquireResult{}, err
	}
	if !ok {
		return OwnershipAcquireResult{}, fmt.Errorf("%w: game %s expired lease was acquired by another owner", ErrOwnershipNotHeld, gameID)
	}
	return OwnershipAcquireResult{
		Lease:   stolen,
		Stolen:  existing.OwnerID != ownerID,
		Expired: true,
	}, nil
}

func (m *PostgresOwnershipManager) EnsureHeld(ctx context.Context, lease OwnershipLease) error {
	var expiresAt time.Time
	err := m.db.QueryRowContext(ctx, `
SELECT expires_at
FROM game_runtime_lease
WHERE game_id = $1
  AND owner_instance_id = $2
  AND fencing_token = $3
  AND expires_at > $4
`, lease.GameID, lease.OwnerID, int64(lease.Token), m.now()).Scan(&expiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%w: game %s owner token is not held", ErrOwnershipNotHeld, lease.GameID)
	}
	if err != nil {
		return err
	}
	return nil
}

func (m *PostgresOwnershipManager) Renew(ctx context.Context, lease OwnershipLease) (OwnershipLease, error) {
	now := m.now()
	return m.renewLease(ctx, lease, now.Add(m.ttl), now)
}

func (m *PostgresOwnershipManager) Release(ctx context.Context, lease OwnershipLease) error {
	_, err := m.db.ExecContext(ctx, `
DELETE FROM game_runtime_lease
WHERE game_id = $1
  AND owner_instance_id = $2
  AND fencing_token = $3
`, lease.GameID, lease.OwnerID, int64(lease.Token))
	return err
}

func (m *PostgresOwnershipManager) insertLease(ctx context.Context, gameID string, ownerID string, expiresAt time.Time, now time.Time) (OwnershipLease, error) {
	var lease OwnershipLease
	err := m.db.QueryRowContext(ctx, `
INSERT INTO game_runtime_lease (game_id, owner_instance_id, fencing_token, expires_at, updated_at)
VALUES ($1, $2, 1, $3, $4)
ON CONFLICT (game_id) DO NOTHING
RETURNING game_id, owner_instance_id, fencing_token, expires_at
`, gameID, ownerID, expiresAt, now).Scan(&lease.GameID, &lease.OwnerID, &lease.Token, &lease.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return OwnershipLease{}, nil
	}
	if err != nil {
		return OwnershipLease{}, err
	}
	return lease, nil
}

func (m *PostgresOwnershipManager) currentLease(ctx context.Context, gameID string) (OwnershipLease, bool, error) {
	var lease OwnershipLease
	err := m.db.QueryRowContext(ctx, `
SELECT game_id, owner_instance_id, fencing_token, expires_at
FROM game_runtime_lease
WHERE game_id = $1
`, gameID).Scan(&lease.GameID, &lease.OwnerID, &lease.Token, &lease.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return OwnershipLease{}, false, nil
	}
	if err != nil {
		return OwnershipLease{}, false, err
	}
	return lease, true, nil
}

func (m *PostgresOwnershipManager) renewLease(ctx context.Context, lease OwnershipLease, expiresAt time.Time, now time.Time) (OwnershipLease, error) {
	var renewed OwnershipLease
	err := m.db.QueryRowContext(ctx, `
UPDATE game_runtime_lease
SET expires_at = $4,
    updated_at = $5
WHERE game_id = $1
  AND owner_instance_id = $2
  AND fencing_token = $3
  AND expires_at > $5
RETURNING game_id, owner_instance_id, fencing_token, expires_at
`, lease.GameID, lease.OwnerID, int64(lease.Token), expiresAt, now).Scan(&renewed.GameID, &renewed.OwnerID, &renewed.Token, &renewed.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return OwnershipLease{}, fmt.Errorf("%w: game %s owner token cannot be renewed", ErrOwnershipNotHeld, lease.GameID)
	}
	if err != nil {
		return OwnershipLease{}, err
	}
	return renewed, nil
}

func (m *PostgresOwnershipManager) stealExpiredLease(ctx context.Context, existing OwnershipLease, ownerID string, expiresAt time.Time, now time.Time) (OwnershipLease, bool, error) {
	var stolen OwnershipLease
	err := m.db.QueryRowContext(ctx, `
UPDATE game_runtime_lease
SET owner_instance_id = $2,
    fencing_token = fencing_token + 1,
    expires_at = $4,
    updated_at = $5
WHERE game_id = $1
  AND owner_instance_id = $3
  AND fencing_token = $6
  AND expires_at <= $5
RETURNING game_id, owner_instance_id, fencing_token, expires_at
`, existing.GameID, ownerID, existing.OwnerID, expiresAt, now, int64(existing.Token)).Scan(&stolen.GameID, &stolen.OwnerID, &stolen.Token, &stolen.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return OwnershipLease{}, false, nil
	}
	if err != nil {
		return OwnershipLease{}, false, err
	}
	return stolen, true, nil
}
