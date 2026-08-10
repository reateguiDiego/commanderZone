package lifecycle

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"commanderzone/game-runtime/internal/protocol"
)

const (
	PlayerConceded          = "player.conceded"
	PlayerExpelled          = "player.expelled"
	GameFinished            = "game.finished"
	AllPlayersDisconnected  = "game.all_players_disconnected"
	AllDisconnectedCanceled = "game.all_disconnected_cancelled"
)

type Handoff struct {
	EventID        string    `json:"eventId"`
	GameID         string    `json:"gameId"`
	Type           string    `json:"type"`
	PlayerID       string    `json:"playerId,omitempty"`
	PlayerReason   string    `json:"playerReason,omitempty"`
	WinnerPlayerID string    `json:"winnerPlayerId,omitempty"`
	FinishReason   string    `json:"finishReason,omitempty"`
	ClientActionID string    `json:"clientActionId,omitempty"`
	Version        int64     `json:"version"`
	Generation     int64     `json:"generation"`
	Fencing        uint64    `json:"fencing"`
	OccurredAt     time.Time `json:"occurredAt"`
}

func (h Handoff) Validate() error {
	if strings.TrimSpace(h.EventID) == "" || strings.TrimSpace(h.GameID) == "" {
		return errors.New("eventId and gameId are required")
	}
	if h.Version < 1 || h.Generation < 1 {
		return errors.New("version and generation must be >= 1")
	}
	if h.OccurredAt.IsZero() {
		return errors.New("occurredAt is required")
	}
	switch h.Type {
	case PlayerConceded, PlayerExpelled:
		if strings.TrimSpace(h.PlayerID) == "" {
			return errors.New("playerId is required for player lifecycle facts")
		}
	case GameFinished:
		if strings.TrimSpace(h.FinishReason) == "" {
			return errors.New("finishReason is required for game.finished")
		}
	case AllPlayersDisconnected, AllDisconnectedCanceled:
	default:
		return fmt.Errorf("unsupported lifecycle handoff type %q", h.Type)
	}
	return nil
}

type Sink interface {
	Deliver(context.Context, Handoff) error
}

func FromPersistedEvent(event protocol.EventPayloadV2, fencing uint64, generation int64) (Handoff, bool) {
	if generation < 1 {
		generation = 1
	}
	handoff := Handoff{
		EventID:        fmt.Sprintf("%s:%d", event.GameID, event.Version),
		GameID:         event.GameID,
		ClientActionID: event.ClientActionID,
		Version:        event.Version,
		Generation:     generation,
		Fencing:        fencing,
		OccurredAt:     event.CreatedAt,
	}
	playerID, _ := event.Payload["playerId"].(string)
	finished := event.Payload["gameStatus"] == "finished"
	if finished {
		handoff.Type = GameFinished
		handoff.PlayerID = playerID
		if event.Type == "game.concede" {
			handoff.PlayerReason = "conceded"
		} else if event.Type == "disconnect.vote.updated" && event.Payload["status"] == "resolved_expel" {
			handoff.PlayerReason = "expelled"
			handoff.PlayerID, _ = event.Payload["targetPlayerId"].(string)
		}
		handoff.WinnerPlayerID, _ = event.Payload["winnerPlayerId"].(string)
		handoff.FinishReason, _ = event.Payload["finishReason"].(string)
		if finishedAt, ok := event.Payload["finishedAt"].(string); ok {
			if parsed, err := time.Parse(time.RFC3339, finishedAt); err == nil {
				handoff.OccurredAt = parsed
			}
		}
		return handoff, handoff.Validate() == nil
	}
	if event.Type == "game.concede" {
		handoff.Type = PlayerConceded
		handoff.PlayerID = playerID
		return handoff, handoff.Validate() == nil
	}
	if event.Type == "disconnect.vote.updated" && event.Payload["status"] == "resolved_expel" {
		handoff.Type = PlayerExpelled
		handoff.PlayerID, _ = event.Payload["targetPlayerId"].(string)
		return handoff, handoff.Validate() == nil
	}
	return Handoff{}, false
}
