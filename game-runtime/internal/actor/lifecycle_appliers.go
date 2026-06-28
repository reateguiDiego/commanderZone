package actor

import (
	"context"
	"fmt"
	"sort"
	"time"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

type GameConcedeApplier struct{}

func (GameConcedeApplier) Type() string { return "game.concede" }

func (GameConcedeApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
	playerID, ok := command.Payload["playerId"].(string)
	if !ok || playerID == "" {
		return nil, fmt.Errorf("%w: playerId", ErrMissingPayloadField)
	}
	player, ok := game.Players[playerID]
	if !ok {
		return nil, fmt.Errorf("%w: playerId", ErrInvalidPayloadField)
	}
	if player["status"] == "conceded" {
		return nil, fmt.Errorf("%w: player already conceded", ErrInvalidPayloadField)
	}
	concededAt := nowUTC().Format("2006-01-02T15:04:05Z07:00")
	if value, ok := command.Payload["concededAt"].(string); ok && value != "" {
		concededAt = value
	}
	player["status"] = "conceded"
	player["concededAt"] = concededAt
	game.Players[playerID] = player

	emitter.EmitPublic(protocol.PatchOp{
		Op: "player.status.set",
		Data: map[string]any{
			"playerId":   playerID,
			"status":     "conceded",
			"concededAt": concededAt,
		},
	})
	var nextTurn map[string]any
	if game.Turn != nil && game.Turn["activePlayerId"] == playerID {
		if nextPlayerID := nextActivePlayerID(game, playerID); nextPlayerID != "" {
			game.Turn["activePlayerId"] = nextPlayerID
			nextTurn = cloneMap(game.Turn)
			emitter.EmitPublic(protocol.PatchOp{Op: "turn.set", Data: map[string]any{"turn": nextTurn}})
		}
	}

	payload := map[string]any{
		"playerId":   playerID,
		"status":     "conceded",
		"concededAt": concededAt,
		"metrics":    lifecycleMetrics(start, emitter),
	}
	if nextTurn != nil {
		payload["turn"] = nextTurn
	}

	return payload, nil
}

type GameCloseApplier struct{}

func (GameCloseApplier) Type() string { return "game.close" }

func (GameCloseApplier) Apply(_ context.Context, game *state.GameState, _ protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
	game.Status = "finished"
	game.Phase = state.PhaseFinished
	emitter.EmitPublic(protocol.PatchOp{
		Op: "game.status.set",
		Data: map[string]any{
			"status": "finished",
			"phase":  state.PhaseFinished,
		},
	})
	emitter.EmitPublic(protocol.PatchOp{
		Op:   "game.phase.set",
		Data: map[string]any{"phase": state.PhaseFinished},
	})

	return map[string]any{
		"status":  "finished",
		"phase":   state.PhaseFinished,
		"metrics": lifecycleMetrics(start, emitter),
	}, nil
}

func nextActivePlayerID(game *state.GameState, currentPlayerID string) string {
	if game == nil || len(game.Players) == 0 {
		return ""
	}
	playerIDs := make([]string, 0, len(game.Players))
	for playerID := range game.Players {
		playerIDs = append(playerIDs, playerID)
	}
	sort.Strings(playerIDs)
	afterCurrent := false
	firstActive := ""
	for _, playerID := range playerIDs {
		player := game.Players[playerID]
		if player["status"] == "conceded" {
			continue
		}
		if firstActive == "" {
			firstActive = playerID
		}
		if afterCurrent {
			return playerID
		}
		if playerID == currentPlayerID {
			afterCurrent = true
		}
	}
	return firstActive
}

func lifecycleMetrics(start time.Time, emitter *PatchEmitter) map[string]any {
	return map[string]any{
		"lifecycle.runtime_route":        1,
		"lifecycle.snapshot_write_count": 0,
		"lifecycle.apply_ms":             float64(time.Since(start).Microseconds()) / 1000,
		"lifecycle.patch_bytes":          patchBytes(emitter),
	}
}
