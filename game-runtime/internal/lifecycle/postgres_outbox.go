package lifecycle

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// PresenceOutbox persists the two low-frequency connection lifecycle facts.
// It deliberately uses the database already required by the runtime: a
// temporary API outage must not turn an all-offline game into a permanent one.
type PresenceOutbox struct {
	db   *sql.DB
	wake chan struct{}
}

func NewPresenceOutbox(databaseURL string) (*PresenceOutbox, error) {
	if databaseURL == "" {
		return nil, errors.New("database url is required")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(30 * time.Minute)
	return NewPresenceOutboxWithDB(db), nil
}

func NewPresenceOutboxWithDB(db *sql.DB) *PresenceOutbox {
	return &PresenceOutbox{db: db, wake: make(chan struct{}, 1)}
}

func (o *PresenceOutbox) Close() error {
	return o.db.Close()
}

func (o *PresenceOutbox) CheckSchema(ctx context.Context) error {
	var exists bool
	if err := o.db.QueryRowContext(ctx, `SELECT to_regclass('public.game_runtime_lifecycle_outbox') IS NOT NULL`).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return errors.New("game_runtime_lifecycle_outbox table is missing")
	}
	return nil
}

func (o *PresenceOutbox) Enqueue(ctx context.Context, handoff Handoff) error {
	if err := handoff.Validate(); err != nil {
		return err
	}
	if handoff.Type != AllPlayersDisconnected && handoff.Type != AllDisconnectedCanceled {
		return fmt.Errorf("presence outbox does not support lifecycle type %q", handoff.Type)
	}
	_, err := o.db.ExecContext(ctx, `
INSERT INTO game_runtime_lifecycle_outbox (
    event_id, game_id, type, generation, fencing, version, occurred_at, queued_at, available_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (event_id) DO NOTHING
`,
		handoff.EventID,
		handoff.GameID,
		handoff.Type,
		handoff.Generation,
		handoff.Fencing,
		handoff.Version,
		handoff.OccurredAt.UTC(),
	)
	if err == nil {
		o.Wake()
	}
	return err
}

func (o *PresenceOutbox) Wake() {
	select {
	case o.wake <- struct{}{}:
	default:
	}
}

// Run delivers entries until the process stops. Each delivery is idempotent by
// event ID, so multiple runtime instances may safely drain the same table.
func (o *PresenceOutbox) Run(ctx context.Context, sink Sink, report func(error)) {
	for {
		processed, err := o.Drain(ctx, sink, 100)
		if err != nil && report != nil {
			report(err)
		}
		if processed == 100 {
			continue
		}

		timer := time.NewTimer(time.Second)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return
		case <-o.wake:
			if !timer.Stop() {
				<-timer.C
			}
		case <-timer.C:
		}
	}
}

func (o *PresenceOutbox) Drain(ctx context.Context, sink Sink, limit int) (int, error) {
	if sink == nil {
		return 0, errors.New("lifecycle sink is required")
	}
	if limit < 1 {
		limit = 1
	}

	processed := 0
	for processed < limit {
		tx, err := o.db.BeginTx(ctx, nil)
		if err != nil {
			return processed, err
		}
		handoff, found, err := nextDuePresenceHandoff(ctx, tx)
		if err != nil {
			_ = tx.Rollback()
			return processed, err
		}
		if !found {
			if err := tx.Commit(); err != nil {
				return processed, err
			}
			return processed, nil
		}
		// Do not hold the database row lock while calling Symfony: terminal
		// cleanup locks the game before removing this outbox row, and holding
		// both sides during HTTP would create a lock cycle. Concurrent delivery
		// is safe because event IDs are idempotent at the receiver.
		if err := tx.Commit(); err != nil {
			return processed, err
		}
		if err := sink.Deliver(ctx, handoff); err != nil {
			if deferErr := o.reschedule(ctx, handoff.EventID); deferErr != nil {
				return processed, deferErr
			}
			return processed, nil
		}
		if _, err := o.db.ExecContext(ctx, `DELETE FROM game_runtime_lifecycle_outbox WHERE event_id = $1`, handoff.EventID); err != nil {
			return processed, err
		}
		processed++
	}
	return processed, nil
}

func nextDuePresenceHandoff(ctx context.Context, tx *sql.Tx) (Handoff, bool, error) {
	row := tx.QueryRowContext(ctx, `
SELECT event_id, game_id, type, generation, fencing, version, occurred_at
FROM game_runtime_lifecycle_outbox
WHERE available_at <= CURRENT_TIMESTAMP
ORDER BY available_at ASC, queued_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED
`)
	var handoff Handoff
	if err := row.Scan(
		&handoff.EventID,
		&handoff.GameID,
		&handoff.Type,
		&handoff.Generation,
		&handoff.Fencing,
		&handoff.Version,
		&handoff.OccurredAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Handoff{}, false, nil
		}
		return Handoff{}, false, err
	}
	return handoff, true, nil
}

func (o *PresenceOutbox) reschedule(ctx context.Context, eventID string) error {
	_, err := o.db.ExecContext(ctx, `
UPDATE game_runtime_lifecycle_outbox
SET attempts = attempts + 1,
    available_at = CURRENT_TIMESTAMP + (LEAST(60, POWER(2, attempts + 1)) * INTERVAL '1 second')
WHERE event_id = $1
`, eventID)
	return err
}
