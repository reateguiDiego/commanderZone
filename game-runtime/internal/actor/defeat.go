package actor

import (
	"fmt"
	"sort"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

const (
	atomicLifecycleEffectVersion        = 2
	authoritativeLifecycleEffectVersion = 3
)

type eliminationContext struct {
	SourcePlayerID      string
	CommanderInstanceID string
}

type defeatTransition struct {
	PreviousStatus     string
	Status             string
	StatusChanged      bool
	EliminationReason  string
	EliminatedAt       int64
	PreviousTurn       map[string]any
	Turn               map[string]any
	PreviousWinner     string
	Winner             string
	PreviousResult     string
	Result             string
	PreviousFinished   string
	Finished           string
	DesignationsBefore map[string]any
	DesignationsAfter  map[string]any
}

func eliminatePlayer(game *state.GameState, playerID, reason string, context eliminationContext, emitter *PatchEmitter) (defeatTransition, error) {
	ensureRuntimeTurnOrder(game)
	previousStatus := playerStatus(game, playerID)
	transition := defeatTransition{
		PreviousStatus: previousStatus, Status: previousStatus,
		PreviousTurn: cloneMap(game.Turn), PreviousWinner: game.WinnerPlayerID,
		PreviousResult: game.ResultState, PreviousFinished: game.FinishedReason,
		DesignationsBefore: lifecycleDesignations(game),
	}
	if previousStatus == "" {
		return transition, &AuthorizationError{Code: AuthorizationCodeInvalidTarget}
	}
	if previousStatus != "active" {
		return transition, fmt.Errorf("%w: player already eliminated", ErrInvalidPayloadField)
	}
	status := "defeated"
	if reason == "concede" || reason == "expelled" {
		status = "conceded"
	}
	player := game.Players[playerID]
	player["status"] = status
	player["eliminationReason"] = reason
	player["eliminatedAtVersion"] = game.Version + 1
	if context.SourcePlayerID != "" {
		player["sourcePlayerId"] = context.SourcePlayerID
	}
	if context.CommanderInstanceID != "" {
		player["commanderInstanceId"] = context.CommanderInstanceID
	}
	game.Players[playerID] = player
	invalidateDurableVoteForLifecycle(game, playerID, "player_eliminated", nowUTC(), emitter)
	if window, exists := game.LibraryWindow(playerID); exists && window.Status == "active" {
		game.InvalidateLibraryWindow(playerID, "closed")
		emitLibraryWindowInvalidated(emitter, playerID, window.WindowID, "closed", "player_eliminated", game.Visibility.LibraryEpochByOwner[playerID])
	}
	transition.Status = status
	transition.StatusChanged = true
	transition.EliminationReason = reason
	transition.EliminatedAt = game.Version + 1

	emitter.EmitPublic(protocol.PatchOp{Op: "player.status.set", Data: map[string]any{"playerId": playerID, "status": status}})
	emitter.EmitPublic(protocol.PatchOp{Op: "player.elimination.set", Data: map[string]any{
		"playerId": playerID, "eliminationReason": reason, "eliminatedAtVersion": game.Version + 1,
		"sourcePlayerId": context.SourcePlayerID, "commanderInstanceId": context.CommanderInstanceID,
	}})

	if game.Turn == nil {
		game.Turn = map[string]any{}
	}
	if game.Turn["activePlayerId"] == playerID || playerStatus(game, optionalString(game.Turn, "activePlayerId")) != "active" {
		game.Turn["activePlayerId"] = nextActivePlayerID(game, playerID)
	}
	applyLifecycleDesignations(game, playerID, emitter)
	active := activePlayersInTurnOrder(game)
	switch len(active) {
	case 0:
		game.WinnerPlayerID = ""
		game.ResultState = "no_active_players"
		game.FinishedReason = "no_active_players"
		game.Turn["activePlayerId"] = ""
	case 1:
		game.WinnerPlayerID = active[0]
		game.ResultState = "survivor"
		game.FinishedReason = "last_active"
		game.Turn["activePlayerId"] = active[0]
	default:
		game.WinnerPlayerID = ""
		game.ResultState = ""
		game.FinishedReason = ""
	}
	transition.Turn = cloneMap(game.Turn)
	transition.Winner = game.WinnerPlayerID
	transition.Result = game.ResultState
	transition.Finished = game.FinishedReason
	transition.DesignationsAfter = lifecycleDesignations(game)
	emitter.EmitPublic(protocol.PatchOp{Op: "turn.set", Data: map[string]any{"turn": cloneMap(game.Turn)}})
	emitter.EmitPublic(protocol.PatchOp{Op: "turn.order.set", Data: map[string]any{"turnOrder": append([]string(nil), game.TurnOrder...)}})
	emitter.EmitPublic(protocol.PatchOp{Op: "game.result.set", Data: map[string]any{
		"winnerPlayerId": game.WinnerPlayerID, "resultState": game.ResultState, "finishedReason": game.FinishedReason,
	}})
	return transition, nil
}

func ensureRuntimeTurnOrder(game *state.GameState) {
	if len(game.TurnOrder) > 0 {
		return
	}
	order := make([]string, 0, len(game.Players))
	for playerID := range game.Players {
		order = append(order, playerID)
	}
	sort.Strings(order)
	game.TurnOrder = order
}

func applyMinimalDefeat(game *state.GameState, playerID string, emitter *PatchEmitter) defeatTransition {
	transition, _ := eliminatePlayer(game, playerID, "life", eliminationContext{}, emitter)
	return transition
}

func lifecycleDesignations(game *state.GameState) map[string]any {
	out := map[string]any{}
	for _, template := range []string{"monarch", "initiative"} {
		for _, relation := range game.Relations.Helpers {
			if relation.Meta["template"] == template {
				out[template] = helperPatch(relation)
				break
			}
		}
	}
	return out
}

func applyLifecycleDesignations(game *state.GameState, eliminatedID string, emitter *PatchEmitter) {
	for id, relation := range game.Relations.Helpers {
		template, _ := relation.Meta["template"].(string)
		if template != "monarch" && template != "initiative" {
			continue
		}
		owner, _ := relation.Meta["ownerPlayerId"].(string)
		if owner != eliminatedID && playerStatus(game, owner) == "active" {
			continue
		}
		next := optionalString(game.Turn, "activePlayerId")
		if playerStatus(game, next) != "active" {
			next = nextActivePlayerID(game, eliminatedID)
		}
		if next == "" {
			delete(game.Relations.Helpers, id)
			emitter.EmitPublic(protocol.PatchOp{Op: "helper.remove", Data: map[string]any{"id": id}})
			continue
		}
		relation.Meta = cloneMap(relation.Meta)
		relation.Meta["ownerPlayerId"] = next
		game.Relations.Helpers[id] = relation
		emitter.EmitPublic(protocol.PatchOp{Op: "helper.update", Data: map[string]any{"entity": helperPatch(relation)}})
	}
}

func activePlayersInTurnOrder(game *state.GameState) []string {
	out := []string{}
	for _, playerID := range game.TurnOrder {
		if playerStatus(game, playerID) == "active" {
			out = append(out, playerID)
		}
	}
	return out
}

func addLifecycleEffects(payload map[string]any, game *state.GameState, transition defeatTransition) {
	payload["effectVersion"] = authoritativeLifecycleEffectVersion
	payload["eliminationReason"] = transition.EliminationReason
	payload["eliminatedAtVersion"] = transition.EliminatedAt
	payload["previousTurn"] = cloneMap(transition.PreviousTurn)
	payload["turn"] = cloneMap(transition.Turn)
	payload["turnOrder"] = append([]string(nil), game.TurnOrder...)
	payload["designationsBefore"] = transition.DesignationsBefore
	payload["designationsAfter"] = transition.DesignationsAfter
	payload["previousWinnerPlayerId"] = transition.PreviousWinner
	payload["winnerPlayerId"] = transition.Winner
	payload["previousResultState"] = transition.PreviousResult
	payload["resultState"] = transition.Result
	payload["previousFinishedReason"] = transition.PreviousFinished
	payload["finishedReason"] = transition.Finished
	payload["disconnectVote"] = cloneMap(game.DisconnectVote)
	payload["presence"] = cloneNestedMap(game.Presence)
	payload["disconnectCooldowns"] = cloneNestedMap(game.DisconnectCooldowns)
	payload["rematch"] = cloneMap(game.Rematch)
}

func playerMutationStatusError(game *state.GameState, playerID string, invalidCode string, commandType string) error {
	if _, ok := game.Players[playerID]; !ok {
		return &AuthorizationError{Code: invalidCode, CommandType: commandType}
	}
	switch playerStatus(game, playerID) {
	case "defeated":
		return &AuthorizationError{Code: AuthorizationCodePlayerDefeated, CommandType: commandType}
	case "conceded":
		return &AuthorizationError{Code: AuthorizationCodePlayerConceded, CommandType: commandType}
	default:
		return nil
	}
}
