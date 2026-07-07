package gateway

import (
	"context"
	"crypto/sha1"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"commanderzone/game-runtime/internal/protocol"

	_ "github.com/jackc/pgx/v5/stdlib"
)

var (
	errActivityUnavailable = errors.New("activity stream store is unavailable")
	errChatMessageRequired = errors.New("message is required")
	errChatTargetNotFound  = errors.New("chat target player not found")
	errChatTargetSelf      = errors.New("private chat target must be another player")
	errChatReactionInvalid = errors.New("chat.reaction.toggled requires a valid messageId and reaction")
	errChatMessageNotFound = errors.New("chat message not found")
	errChatReactionDenied  = errors.New("you cannot react to this chat message")
)

type ActivityStore interface {
	AppendChatMessage(ctx context.Context, gameID string, claims TicketClaims, command protocol.CommandEnvelopeV2, version int64) ([]protocol.PatchEnvelopeV2, error)
	ToggleChatReaction(ctx context.Context, gameID string, claims TicketClaims, command protocol.CommandEnvelopeV2, version int64) ([]protocol.PatchEnvelopeV2, error)
	AppendLogEntries(ctx context.Context, gameID string, entries []map[string]any) error
	Close() error
}

type PostgresActivityStore struct {
	db *sql.DB
}

type chatRecord struct {
	ID                string
	UserID            string
	DisplayName       string
	Message           string
	TargetPlayerID    string
	TargetDisplayName string
	CreatedAt         time.Time
	Reactions         map[string][]chatReactionEntry
}

type chatReactionEntry struct {
	UserID      string `json:"userId"`
	DisplayName string `json:"displayName"`
	CreatedAt   string `json:"createdAt"`
}

var validChatReactions = map[string]bool{
	"like": true, "dislike": true, "love": true, "laugh": true, "angry": true, "vomit": true, "cry": true,
}

func NewPostgresActivityStore(databaseURL string) (*PostgresActivityStore, error) {
	if strings.TrimSpace(databaseURL) == "" {
		return nil, errActivityUnavailable
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return nil, err
	}
	return &PostgresActivityStore{db: db}, nil
}

func (s *PostgresActivityStore) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *PostgresActivityStore) AppendChatMessage(ctx context.Context, gameID string, claims TicketClaims, command protocol.CommandEnvelopeV2, version int64) ([]protocol.PatchEnvelopeV2, error) {
	if s == nil || s.db == nil {
		return nil, errActivityUnavailable
	}
	body := strings.TrimSpace(fmt.Sprint(command.Payload["message"]))
	if body == "" {
		return nil, errChatMessageRequired
	}
	if len(body) > 800 {
		body = body[:800]
	}

	actorID := playerIDFromClaims(claims)
	targetID := strings.TrimSpace(fmt.Sprint(command.Payload["targetPlayerId"]))
	if targetID == "" || targetID == "all" || targetID == "<nil>" {
		targetID = ""
	}
	targetDisplayName := ""
	if targetID != "" {
		if targetID == actorID {
			return nil, errChatTargetSelf
		}
		name, ok, err := s.playerDisplayName(ctx, gameID, targetID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, errChatTargetNotFound
		}
		targetDisplayName = name
	}

	messageID := stableUUID("chat-message", gameID, command.ClientActionID)
	now := time.Now().UTC().Truncate(time.Second)
	reactions, _ := json.Marshal(map[string][]chatReactionEntry{})
	_, err := s.db.ExecContext(ctx, `
INSERT INTO game_chat_message (message_id, game_id, actor_id, body, reactions, target_player_id, target_display_name, created_at, updated_at)
VALUES ($1, $2, $3, $4, $5::json, NULLIF($6, ''), NULLIF($7, ''), $8, $8)
ON CONFLICT (message_id) DO NOTHING
`, messageID, gameID, actorID, body, string(reactions), targetID, targetDisplayName, now)
	if err != nil {
		return nil, err
	}

	record, err := s.chatRecord(ctx, gameID, messageID)
	if err != nil {
		return nil, err
	}
	return chatPatches(gameID, version, command.ClientActionID, record), nil
}

func (s *PostgresActivityStore) ToggleChatReaction(ctx context.Context, gameID string, claims TicketClaims, command protocol.CommandEnvelopeV2, version int64) ([]protocol.PatchEnvelopeV2, error) {
	if s == nil || s.db == nil {
		return nil, errActivityUnavailable
	}
	messageID := strings.TrimSpace(fmt.Sprint(command.Payload["messageId"]))
	reaction := strings.TrimSpace(fmt.Sprint(command.Payload["reaction"]))
	if messageID == "" || !validChatReactions[reaction] {
		return nil, errChatReactionInvalid
	}

	actorID := playerIDFromClaims(claims)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	record, err := s.chatRecordForUpdate(ctx, tx, gameID, messageID)
	if err != nil {
		return nil, err
	}
	if record.ID == "" {
		return nil, errChatMessageNotFound
	}
	if record.UserID == actorID || (record.TargetPlayerID != "" && record.TargetPlayerID != actorID) {
		return nil, errChatReactionDenied
	}
	actorName, ok, err := s.playerDisplayName(ctx, gameID, actorID)
	if err != nil {
		return nil, err
	}
	if !ok {
		actorName = actorID
	}

	reactions := toggleReaction(record.Reactions, reaction, chatReactionEntry{
		UserID:      actorID,
		DisplayName: actorName,
		CreatedAt:   time.Now().UTC().Format(time.RFC3339),
	})
	payload, err := json.Marshal(reactions)
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `
UPDATE game_chat_message
SET reactions = $1::json, updated_at = $2
WHERE game_id = $3 AND message_id = $4
`, string(payload), time.Now().UTC().Truncate(time.Second), gameID, messageID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	record, err = s.chatRecord(ctx, gameID, messageID)
	if err != nil {
		return nil, err
	}
	return reactionPatches(gameID, version, command.ClientActionID, record), nil
}

func (s *PostgresActivityStore) AppendLogEntries(ctx context.Context, gameID string, entries []map[string]any) error {
	if s == nil || s.db == nil || len(entries) == 0 {
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	for _, entry := range entries {
		id := strings.TrimSpace(fmt.Sprint(entry["id"]))
		entryType := strings.TrimSpace(fmt.Sprint(entry["type"]))
		message := strings.TrimSpace(fmt.Sprint(entry["message"]))
		if id == "" || entryType == "" || message == "" {
			continue
		}
		version := int64FromAny(entry["version"])
		createdAt := time.Now().UTC().Truncate(time.Second)
		if raw := strings.TrimSpace(fmt.Sprint(entry["createdAt"])); raw != "" && raw != "<nil>" {
			if parsed, err := time.Parse(time.RFC3339, raw); err == nil {
				createdAt = parsed.UTC().Truncate(time.Second)
			}
		}
		metadata := map[string]any{}
		for key, value := range entry {
			switch key {
			case "id", "type", "message", "createdAt", "version":
				continue
			default:
				metadata[key] = value
			}
		}
		metadataJSON, err := json.Marshal(metadata)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `
INSERT INTO game_log_entry (id, game_id, version, type, text, metadata, created_at)
VALUES ($1, $2, $3, $4, $5, $6::json, $7)
ON CONFLICT (id) DO NOTHING
`, id, gameID, version, entryType, message, string(metadataJSON), createdAt)
		if err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (s *PostgresActivityStore) playerDisplayName(ctx context.Context, gameID string, playerID string) (string, bool, error) {
	var displayName string
	err := s.db.QueryRowContext(ctx, `
SELECT u.display_name
FROM game g
JOIN room_player rp ON rp.room_id = g.room_id
JOIN app_user u ON u.id = rp.user_id
WHERE g.id = $1 AND rp.user_id = $2
`, gameID, playerID).Scan(&displayName)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return displayName, true, nil
}

func (s *PostgresActivityStore) chatRecord(ctx context.Context, gameID string, messageID string) (chatRecord, error) {
	return scanChatRecord(s.db.QueryRowContext(ctx, `
SELECT m.message_id, m.actor_id, u.display_name, m.body, COALESCE(m.reactions::text, '{}'), COALESCE(m.target_player_id, ''), COALESCE(m.target_display_name, ''), m.created_at
FROM game_chat_message m
JOIN app_user u ON u.id = m.actor_id
WHERE m.game_id = $1 AND m.message_id = $2
`, gameID, messageID))
}

func (s *PostgresActivityStore) chatRecordForUpdate(ctx context.Context, tx *sql.Tx, gameID string, messageID string) (chatRecord, error) {
	return scanChatRecord(tx.QueryRowContext(ctx, `
SELECT m.message_id, m.actor_id, u.display_name, m.body, COALESCE(m.reactions::text, '{}'), COALESCE(m.target_player_id, ''), COALESCE(m.target_display_name, ''), m.created_at
FROM game_chat_message m
JOIN app_user u ON u.id = m.actor_id
WHERE m.game_id = $1 AND m.message_id = $2
FOR UPDATE
`, gameID, messageID))
}

func scanChatRecord(row *sql.Row) (chatRecord, error) {
	var record chatRecord
	var reactionsRaw string
	err := row.Scan(&record.ID, &record.UserID, &record.DisplayName, &record.Message, &reactionsRaw, &record.TargetPlayerID, &record.TargetDisplayName, &record.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return chatRecord{}, nil
	}
	if err != nil {
		return chatRecord{}, err
	}
	if err := json.Unmarshal([]byte(reactionsRaw), &record.Reactions); err != nil {
		record.Reactions = map[string][]chatReactionEntry{}
	}
	if record.Reactions == nil {
		record.Reactions = map[string][]chatReactionEntry{}
	}
	return record, nil
}

func chatPatches(gameID string, version int64, clientActionID string, record chatRecord) []protocol.PatchEnvelopeV2 {
	op := protocol.PatchOp{Op: "chat.message.add", Data: map[string]any{"message": record.toMap()}}
	return activityPatches(gameID, version, clientActionID, record, op)
}

func reactionPatches(gameID string, version int64, clientActionID string, record chatRecord) []protocol.PatchEnvelopeV2 {
	op := protocol.PatchOp{Op: "chat.reaction.set", Data: map[string]any{
		"messageId": record.ID,
		"reactions": record.Reactions,
		"message":   record.toMap(),
	}}
	return activityPatches(gameID, version, clientActionID, record, op)
}

func activityPatches(gameID string, version int64, clientActionID string, record chatRecord, op protocol.PatchOp) []protocol.PatchEnvelopeV2 {
	if record.TargetPlayerID == "" {
		return []protocol.PatchEnvelopeV2{{
			GameID:            gameID,
			Version:           version,
			Visibility:        protocol.VisibilityPublic,
			Ops:               []protocol.PatchOp{op},
			AckClientActionID: clientActionID,
		}}
	}
	return []protocol.PatchEnvelopeV2{
		{
			GameID:            gameID,
			Version:           version,
			Visibility:        protocol.PlayerVisibility(record.UserID),
			Ops:               []protocol.PatchOp{op},
			AckClientActionID: clientActionID,
		},
		{
			GameID:            gameID,
			Version:           version,
			Visibility:        protocol.PlayerVisibility(record.TargetPlayerID),
			Ops:               []protocol.PatchOp{op},
			AckClientActionID: clientActionID,
		},
	}
}

func (r chatRecord) toMap() map[string]any {
	message := map[string]any{
		"id":          r.ID,
		"userId":      r.UserID,
		"displayName": r.DisplayName,
		"message":     r.Message,
		"createdAt":   r.CreatedAt.UTC().Format(time.RFC3339),
		"reactions":   r.Reactions,
	}
	if r.TargetPlayerID != "" {
		message["targetPlayerId"] = r.TargetPlayerID
		message["targetDisplayName"] = r.TargetDisplayName
	}
	return message
}

func toggleReaction(reactions map[string][]chatReactionEntry, selected string, actor chatReactionEntry) map[string][]chatReactionEntry {
	next := map[string][]chatReactionEntry{}
	wasSelected := false
	for reaction, entries := range reactions {
		filtered := make([]chatReactionEntry, 0, len(entries))
		for _, entry := range entries {
			if entry.UserID == actor.UserID {
				if reaction == selected {
					wasSelected = true
				}
				continue
			}
			filtered = append(filtered, entry)
		}
		if len(filtered) > 0 {
			next[reaction] = filtered
		}
	}
	if !wasSelected {
		next[selected] = append(next[selected], actor)
	}
	return next
}

func stableUUID(parts ...string) string {
	sum := sha1.Sum([]byte(strings.Join(parts, "\x00")))
	bytes := sum[:16]
	bytes[6] = (bytes[6] & 0x0f) | 0x50
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(bytes)
	return fmt.Sprintf("%s-%s-%s-%s-%s", encoded[0:8], encoded[8:12], encoded[12:16], encoded[16:20], encoded[20:32])
}

func playerIDFromClaims(claims TicketClaims) string {
	if strings.TrimSpace(claims.PlayerID) != "" {
		return strings.TrimSpace(claims.PlayerID)
	}
	return strings.TrimSpace(claims.UserID)
}

func int64FromAny(value any) int64 {
	switch typed := value.(type) {
	case int:
		return int64(typed)
	case int64:
		return typed
	case float64:
		return int64(typed)
	case json.Number:
		result, _ := typed.Int64()
		return result
	default:
		return 0
	}
}
