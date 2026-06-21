package persistence

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"commanderzone/game-runtime/internal/protocol"

	_ "github.com/jackc/pgx/v5/stdlib"
)

type PostgresEventStore struct {
	db *sql.DB

	metricsMu sync.Mutex
	appendMS  []float64
}

func NewPostgresEventStore(databaseURL string) (*PostgresEventStore, error) {
	if strings.TrimSpace(databaseURL) == "" {
		return nil, errors.New("database url is required")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(30 * time.Minute)
	return &PostgresEventStore{db: db}, nil
}

func NewPostgresEventStoreWithDB(db *sql.DB) *PostgresEventStore {
	return &PostgresEventStore{db: db}
}

func (s *PostgresEventStore) Close() error {
	return s.db.Close()
}

func (s *PostgresEventStore) Ping(ctx context.Context) error {
	return s.db.PingContext(ctx)
}

func (s *PostgresEventStore) AppendP95MS() float64 {
	s.metricsMu.Lock()
	defer s.metricsMu.Unlock()
	if len(s.appendMS) == 0 {
		return 0
	}
	values := append([]float64(nil), s.appendMS...)
	for i := 0; i < len(values); i++ {
		for j := i + 1; j < len(values); j++ {
			if values[j] < values[i] {
				values[i], values[j] = values[j], values[i]
			}
		}
	}
	index := int(float64(len(values)-1) * 0.95)
	return values[index]
}

func (s *PostgresEventStore) AppendEvent(ctx context.Context, event protocol.EventPayloadV2) error {
	if err := event.Validate(); err != nil {
		return err
	}
	start := time.Now()
	payload, err := json.Marshal(event.Payload)
	if err != nil {
		return err
	}
	createdBy := sql.NullString{}
	if event.CreatedBy != "" {
		createdBy = sql.NullString{String: event.CreatedBy, Valid: true}
	}
	clientActionID := sql.NullString{}
	if event.ClientActionID != "" {
		clientActionID = sql.NullString{String: event.ClientActionID, Valid: true}
	}
	_, err = s.db.ExecContext(ctx, `
INSERT INTO game_event (id, game_id, created_by_id, type, payload, version, client_action_id, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5::json, $6, $7, $8, $8)
`, newUUID(), event.GameID, createdBy, event.Type, string(payload), event.Version, clientActionID, event.CreatedAt)
	if err != nil {
		return mapPostgresConstraintError(err, event.GameID, event.Version, event.ClientActionID)
	}
	s.recordAppendDuration(time.Since(start))
	return nil
}

func (s *PostgresEventStore) EventByClientActionID(ctx context.Context, gameID string, clientActionID string) (protocol.EventPayloadV2, bool, error) {
	if clientActionID == "" {
		return protocol.EventPayloadV2{}, false, nil
	}
	return s.scanEvent(s.db.QueryRowContext(ctx, `
SELECT game_id, version, type, payload, COALESCE(created_by_id, ''), COALESCE(client_action_id, ''), created_at
FROM game_event
WHERE game_id = $1 AND client_action_id = $2
`, gameID, clientActionID))
}

func (s *PostgresEventStore) LatestSnapshot(ctx context.Context, gameID string) (CompactSnapshot, bool, error) {
	var snapshot CompactSnapshot
	var payload []byte
	err := s.db.QueryRowContext(ctx, `
SELECT game_id, version, snapshot, checksum
FROM game_snapshot_compact
WHERE game_id = $1
ORDER BY version DESC
LIMIT 1
`, gameID).Scan(&snapshot.GameID, &snapshot.Version, &payload, &snapshot.Checksum)
	if errors.Is(err, sql.ErrNoRows) {
		return CompactSnapshot{}, false, nil
	}
	if err != nil {
		return CompactSnapshot{}, false, err
	}
	if err := json.Unmarshal(payload, &snapshot.State); err != nil {
		return CompactSnapshot{}, false, err
	}
	if err := VerifySnapshot(snapshot); err != nil {
		return CompactSnapshot{}, false, err
	}
	return snapshot, true, nil
}

func (s *PostgresEventStore) EventsAfter(ctx context.Context, gameID string, version int64) ([]protocol.EventPayloadV2, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT game_id, version, type, payload, COALESCE(created_by_id, ''), COALESCE(client_action_id, ''), created_at
FROM game_event
WHERE game_id = $1 AND version > $2
ORDER BY version ASC
`, gameID, version)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var events []protocol.EventPayloadV2
	for rows.Next() {
		event, err := scanEventRows(rows)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

func (s *PostgresEventStore) SaveSnapshot(ctx context.Context, snapshot CompactSnapshot) error {
	if err := VerifySnapshot(snapshot); err != nil {
		return err
	}
	payload, err := json.Marshal(snapshot.State)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `
INSERT INTO game_snapshot_compact (id, game_id, version, snapshot, checksum, created_at)
VALUES ($1, $2, $3, $4::json, $5, $6)
ON CONFLICT (game_id, version) DO UPDATE
SET snapshot = EXCLUDED.snapshot, checksum = EXCLUDED.checksum
`, newUUID(), snapshot.GameID, snapshot.Version, string(payload), snapshot.Checksum, time.Now().UTC())
	return err
}

func (s *PostgresEventStore) scanEvent(row *sql.Row) (protocol.EventPayloadV2, bool, error) {
	var event protocol.EventPayloadV2
	var payload []byte
	err := row.Scan(&event.GameID, &event.Version, &event.Type, &payload, &event.CreatedBy, &event.ClientActionID, &event.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return protocol.EventPayloadV2{}, false, nil
	}
	if err != nil {
		return protocol.EventPayloadV2{}, false, err
	}
	if err := json.Unmarshal(payload, &event.Payload); err != nil {
		return protocol.EventPayloadV2{}, false, err
	}
	return event, true, nil
}

type eventScanner interface {
	Scan(dest ...any) error
}

func scanEventRows(row eventScanner) (protocol.EventPayloadV2, error) {
	var event protocol.EventPayloadV2
	var payload []byte
	if err := row.Scan(&event.GameID, &event.Version, &event.Type, &payload, &event.CreatedBy, &event.ClientActionID, &event.CreatedAt); err != nil {
		return protocol.EventPayloadV2{}, err
	}
	if err := json.Unmarshal(payload, &event.Payload); err != nil {
		return protocol.EventPayloadV2{}, err
	}
	return event, nil
}

func (s *PostgresEventStore) recordAppendDuration(duration time.Duration) {
	s.metricsMu.Lock()
	defer s.metricsMu.Unlock()
	s.appendMS = append(s.appendMS, float64(duration.Microseconds())/1000.0)
	if len(s.appendMS) > 512 {
		s.appendMS = s.appendMS[len(s.appendMS)-512:]
	}
}

func mapPostgresConstraintError(err error, gameID string, version int64, clientActionID string) error {
	message := err.Error()
	if strings.Contains(message, "uniq_game_event_version") {
		return fmt.Errorf("%w: %s/%d", ErrDuplicateVersion, gameID, version)
	}
	if strings.Contains(message, "uniq_game_event_client_action") {
		return fmt.Errorf("%w: %s/%s", ErrDuplicateClientActionID, gameID, clientActionID)
	}
	return err
}

func newUUID() string {
	bytes := make([]byte, 16)
	_, _ = rand.Read(bytes)
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(bytes)
	return fmt.Sprintf("%s-%s-%s-%s-%s", encoded[0:8], encoded[8:12], encoded[12:16], encoded[16:20], encoded[20:32])
}
