package actor

import (
	"context"
	"fmt"
	"sort"
	"strings"
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
		return map[string]any{
			"playerId":   playerID,
			"status":     "conceded",
			"concededAt": player["concededAt"],
			"metrics":    lifecycleMetrics(start, emitter),
		}, nil
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
	finishWhenOneActivePlayerRemains(game, command.Payload, payload, emitter)

	return payload, nil
}

type DisconnectVoteApplier struct{}

func (DisconnectVoteApplier) Type() string { return "disconnect.vote" }

func (DisconnectVoteApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	start := nowUTC()
	targetPlayerID, ok := command.Payload["targetPlayerId"].(string)
	if !ok || strings.TrimSpace(targetPlayerID) == "" {
		return nil, fmt.Errorf("%w: targetPlayerId", ErrMissingPayloadField)
	}
	targetPlayerID = strings.TrimSpace(targetPlayerID)
	if _, ok := game.Players[targetPlayerID]; !ok {
		return nil, fmt.Errorf("%w: targetPlayerId", ErrInvalidPayloadField)
	}
	if rawVotes, ok := command.Payload["disconnectVotes"].(map[string]any); ok {
		game.DisconnectVotes = disconnectVotesByTarget(rawVotes)
		emitDisconnectVotePatch(game, emitter)
		if command.Payload["status"] == "resolved_expel" {
			if player, ok := game.Players[targetPlayerID]; ok {
				player["status"] = "conceded"
				if concededAt, ok := command.Payload["concededAt"].(string); ok && concededAt != "" {
					player["concededAt"] = concededAt
				}
				game.Players[targetPlayerID] = player
				emitter.EmitPublic(protocol.PatchOp{
					Op: "player.status.set",
					Data: map[string]any{
						"playerId":   targetPlayerID,
						"status":     "conceded",
						"concededAt": player["concededAt"],
					},
				})
			}
		}
		if turn, ok := command.Payload["turn"].(map[string]any); ok {
			game.Turn = cloneMap(turn)
			emitter.EmitPublic(protocol.PatchOp{Op: "turn.set", Data: map[string]any{"turn": cloneMap(turn)}})
		}
		payload := disconnectVotePayload("replayed", game, targetPlayerID, start, emitter)
		if playerStatus(game, targetPlayerID) == "conceded" {
			payload["concededAt"] = game.Players[targetPlayerID]["concededAt"]
			finishWhenOneActivePlayerRemains(game, command.Payload, payload, emitter)
		}
		return payload, nil
	}

	status, _ := command.Payload["status"].(string)
	switch status {
	case "offline":
		return openDisconnectVote(game, targetPlayerID, connectedUserIDs(command.Payload), start, emitter), nil
	case "online":
		return cancelDisconnectVoteOnReconnect(game, targetPlayerID, start, emitter), nil
	case "timeout":
		return resolveDisconnectVoteTimeout(game, targetPlayerID, start, emitter), nil
	}

	vote, _ := command.Payload["vote"].(string)
	if vote != "wait" && vote != "expel" {
		return nil, fmt.Errorf("%w: vote", ErrInvalidPayloadField)
	}
	return recordDisconnectVote(game, command, targetPlayerID, vote, connectedUserIDs(command.Payload), start, emitter)
}

func openDisconnectVote(game *state.GameState, targetPlayerID string, connectedUserIDs []string, start time.Time, emitter *PatchEmitter) map[string]any {
	now := start
	if game.DisconnectVotes == nil {
		game.DisconnectVotes = map[string]map[string]any{}
	}
	current := cloneMap(game.DisconnectVotes[targetPlayerID])
	if current["status"] == "open" {
		payload := disconnectVotePayload("open.ignored", game, targetPlayerID, start, emitter)
		payload["idempotent"] = true
		return payload
	}
	if playerStatus(game, targetPlayerID) == "conceded" {
		payload := disconnectVotePayload("open.ignored_conceded", game, targetPlayerID, start, emitter)
		payload["idempotent"] = true
		return payload
	}
	// When nobody is connected there is nobody who can actually vote. The
	// gateway starts the persisted all-disconnected lifecycle instead.
	if len(connectedUserIDs) == 0 {
		payload := disconnectVotePayload("open.skipped_all_disconnected", game, targetPlayerID, start, emitter)
		payload["idempotent"] = true
		return payload
	}
	eligible := eligibleDisconnectVoters(game, targetPlayerID, connectedUserIDs)
	if len(eligible) == 0 {
		game.DisconnectVotes[targetPlayerID] = map[string]any{
			"targetPlayerId": targetPlayerID,
			"status":         "resolved_wait",
			"openedAt":       nil,
			"deadlineAt":     nil,
			"cooldownUntil":  now.Add(5 * time.Minute).Format(time.RFC3339),
			"votes":          map[string]any{},
			"eligible":       eligible,
			"version":        game.Version + 1,
		}
		emitDisconnectVotePatch(game, emitter)
		return disconnectVotePayload("open.skipped_wait", game, targetPlayerID, start, emitter)
	}

	game.DisconnectVotes[targetPlayerID] = map[string]any{
		"targetPlayerId": targetPlayerID,
		"status":         "open",
		"openedAt":       now.Format(time.RFC3339),
		"deadlineAt":     now.Add(time.Minute).Format(time.RFC3339),
		"cooldownUntil":  nil,
		"votes":          map[string]any{},
		"eligible":       eligible,
		"version":        game.Version + 1,
	}
	emitDisconnectVotePatch(game, emitter)
	return disconnectVotePayload("opened", game, targetPlayerID, start, emitter)
}

func cancelDisconnectVoteOnReconnect(game *state.GameState, targetPlayerID string, start time.Time, emitter *PatchEmitter) map[string]any {
	current := cloneMap(game.DisconnectVotes[targetPlayerID])
	if current["status"] != "open" || current["targetPlayerId"] != targetPlayerID {
		payload := disconnectVotePayload("cancel.ignored", game, targetPlayerID, start, emitter)
		payload["idempotent"] = true
		return payload
	}
	game.DisconnectVotes[targetPlayerID] = map[string]any{
		"targetPlayerId": targetPlayerID,
		"status":         "cancelled",
		"openedAt":       nil,
		"deadlineAt":     nil,
		"cooldownUntil":  nil,
		"votes":          map[string]any{},
	}
	emitDisconnectVotePatch(game, emitter)
	return disconnectVotePayload("cancelled.reconnect", game, targetPlayerID, start, emitter)
}

func recordDisconnectVote(game *state.GameState, command protocol.CommandEnvelopeV2, targetPlayerID string, vote string, connectedUserIDs []string, start time.Time, emitter *PatchEmitter) (map[string]any, error) {
	current := cloneMap(game.DisconnectVotes[targetPlayerID])
	if current["status"] != "open" || current["targetPlayerId"] != targetPlayerID {
		return nil, fmt.Errorf("%w: disconnectVote", ErrInvalidPayloadField)
	}
	voterID, _ := command.Payload["playerId"].(string)
	if strings.TrimSpace(voterID) == "" {
		voterID, _ = command.Client["playerId"].(string)
	}
	if strings.TrimSpace(voterID) == "" {
		if payloadVoterID, ok := command.Payload["voterId"].(string); ok {
			voterID = payloadVoterID
		}
	}
	voterID = strings.TrimSpace(voterID)
	if voterID == "" {
		return nil, fmt.Errorf("%w: playerId", ErrMissingPayloadField)
	}
	if voterID == targetPlayerID {
		return nil, fmt.Errorf("%w: playerId", ErrInvalidPayloadField)
	}
	if _, ok := game.Players[voterID]; !ok {
		return nil, fmt.Errorf("%w: playerId", ErrInvalidPayloadField)
	}
	eligible := disconnectVoteEligible(current, game, targetPlayerID, connectedUserIDs)
	if !stringSliceContains(eligible, voterID) {
		return nil, fmt.Errorf("%w: playerId", ErrActorPermission)
	}

	votes := disconnectVoteVotes(current["votes"])
	votes[voterID] = map[string]any{
		"playerId":    voterID,
		"displayName": playerDisplayName(game, voterID),
		"vote":        vote,
		"votedAt":     start.Format(time.RFC3339),
	}
	current["votes"] = votes
	waitVotes := 0
	expelVotes := 0
	for _, playerID := range eligible {
		entry, _ := votes[playerID].(map[string]any)
		switch entry["vote"] {
		case "wait":
			waitVotes++
		case "expel":
			expelVotes++
		}
	}
	majority := len(eligible)/2 + 1
	reason := "vote.recorded"
	var nextTurn map[string]any
	if expelVotes >= majority {
		reason = "vote.resolved"
		current["status"] = "resolved_expel"
		current["openedAt"] = nil
		current["deadlineAt"] = nil
		current["cooldownUntil"] = nil
		concededAt := start.Format(time.RFC3339)
		player := game.Players[targetPlayerID]
		player["status"] = "conceded"
		player["concededAt"] = concededAt
		game.Players[targetPlayerID] = player
		emitter.EmitPublic(protocol.PatchOp{
			Op: "player.status.set",
			Data: map[string]any{
				"playerId":   targetPlayerID,
				"status":     "conceded",
				"concededAt": concededAt,
			},
		})
		if game.Turn != nil && game.Turn["activePlayerId"] == targetPlayerID {
			if nextPlayerID := nextActivePlayerID(game, targetPlayerID); nextPlayerID != "" {
				game.Turn["activePlayerId"] = nextPlayerID
				nextTurn = cloneMap(game.Turn)
				emitter.EmitPublic(protocol.PatchOp{Op: "turn.set", Data: map[string]any{"turn": nextTurn}})
			}
		}
	} else if waitVotes >= majority {
		reason = "vote.resolved"
		current["status"] = "resolved_wait"
		current["openedAt"] = nil
		current["deadlineAt"] = nil
		current["cooldownUntil"] = start.Add(5 * time.Minute).Format(time.RFC3339)
	}
	game.DisconnectVotes[targetPlayerID] = current
	emitDisconnectVotePatch(game, emitter)
	payload := disconnectVotePayload(reason, game, targetPlayerID, start, emitter)
	payload["vote"] = vote
	payload["playerId"] = voterID
	if nextTurn != nil {
		payload["turn"] = nextTurn
	}
	if playerStatus(game, targetPlayerID) == "conceded" {
		payload["concededAt"] = game.Players[targetPlayerID]["concededAt"]
		finishWhenOneActivePlayerRemains(game, command.Payload, payload, emitter)
	}
	return payload, nil
}

// Deadline resolution deliberately materializes every missing decision as wait
// in the same vote shape used by manual commands, then commits one compact
// actor event/patch. No per-vote goroutine or external roundtrip is involved.
func resolveDisconnectVoteTimeout(game *state.GameState, targetPlayerID string, start time.Time, emitter *PatchEmitter) map[string]any {
	current := cloneMap(game.DisconnectVotes[targetPlayerID])
	if current["status"] != "open" {
		payload := disconnectVotePayload("timeout.ignored", game, targetPlayerID, start, emitter)
		payload["idempotent"] = true
		return payload
	}
	votes := disconnectVoteVotes(current["votes"])
	for _, playerID := range disconnectVoteEligible(current, game, targetPlayerID, nil) {
		if _, exists := votes[playerID]; exists {
			continue
		}
		votes[playerID] = map[string]any{
			"playerId": playerID, "displayName": playerDisplayName(game, playerID), "vote": "wait", "votedAt": start.Format(time.RFC3339),
		}
	}
	current["votes"] = votes
	current["status"] = "resolved_wait"
	current["openedAt"] = nil
	current["deadlineAt"] = nil
	current["cooldownUntil"] = start.Add(5 * time.Minute).Format(time.RFC3339)
	game.DisconnectVotes[targetPlayerID] = current
	emitDisconnectVotePatch(game, emitter)
	return disconnectVotePayload("timeout.resolved_wait", game, targetPlayerID, start, emitter)
}

func emitDisconnectVotePatch(game *state.GameState, emitter *PatchEmitter) {
	emitter.EmitPublic(protocol.PatchOp{
		Op:   "disconnect.vote.set",
		Data: map[string]any{"disconnectVotes": cloneDisconnectVotes(game.DisconnectVotes)},
	})
}

func disconnectVotePayload(reason string, game *state.GameState, targetPlayerID string, start time.Time, emitter *PatchEmitter) map[string]any {
	return map[string]any{
		"_eventType":           "disconnect.vote.updated",
		"reason":               reason,
		"targetPlayerId":       targetPlayerID,
		"status":               disconnectVoteStatus(game.DisconnectVotes[targetPlayerID]),
		"disconnectVotes":      cloneDisconnectVotes(game.DisconnectVotes),
		"snapshot_write_count": 0,
		"metrics": map[string]any{
			"disconnect.vote_route":           1,
			"disconnect.snapshot_write_count": 0,
			"disconnect.apply_ms":             float64(time.Since(start).Microseconds()) / 1000,
			"disconnect.patch_bytes":          patchBytes(emitter),
		},
	}
}

func disconnectVoteStatus(vote map[string]any) any {
	if vote == nil {
		return nil
	}
	return vote["status"]
}

func cloneDisconnectVotes(votes map[string]map[string]any) map[string]any {
	cloned := make(map[string]any, len(votes))
	for targetPlayerID, vote := range votes {
		cloned[targetPlayerID] = cloneMap(vote)
	}
	return cloned
}

func disconnectVotesByTarget(raw map[string]any) map[string]map[string]any {
	result := map[string]map[string]any{}
	for targetPlayerID, value := range raw {
		if vote, ok := value.(map[string]any); ok {
			result[targetPlayerID] = cloneMap(vote)
		}
	}
	return result
}

func connectedUserIDs(payload map[string]any) []string {
	values, err := stringSliceField(payload, "connectedUserIds")
	if err == nil {
		return values
	}
	raw, _ := payload["connectedUserIds"].([]any)
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		if value, ok := item.(string); ok && strings.TrimSpace(value) != "" {
			out = append(out, strings.TrimSpace(value))
		}
	}
	return out
}

func eligibleDisconnectVoters(game *state.GameState, targetPlayerID string, connectedUserIDs []string) []string {
	connected := map[string]struct{}{}
	for _, playerID := range connectedUserIDs {
		if strings.TrimSpace(playerID) != "" {
			connected[strings.TrimSpace(playerID)] = struct{}{}
		}
	}
	eligible := make([]string, 0, len(game.Players))
	for playerID := range game.Players {
		if playerID == targetPlayerID || playerStatus(game, playerID) != "active" {
			continue
		}
		if len(connected) > 0 {
			if _, ok := connected[playerID]; !ok {
				continue
			}
		}
		eligible = append(eligible, playerID)
	}
	sort.Strings(eligible)
	return eligible
}

func disconnectVoteEligible(current map[string]any, game *state.GameState, targetPlayerID string, connectedUserIDs []string) []string {
	if raw, ok := current["eligible"].([]string); ok && len(raw) > 0 {
		return append([]string(nil), raw...)
	}
	if raw, ok := current["eligible"].([]any); ok && len(raw) > 0 {
		result := make([]string, 0, len(raw))
		for _, value := range raw {
			if playerID, ok := value.(string); ok {
				result = append(result, playerID)
			}
		}
		return result
	}
	return eligibleDisconnectVoters(game, targetPlayerID, connectedUserIDs)
}

func disconnectVoteVotes(value any) map[string]any {
	out := map[string]any{}
	switch typed := value.(type) {
	case map[string]any:
		for key, entry := range typed {
			out[key] = entry
		}
	case map[string]map[string]any:
		for key, entry := range typed {
			out[key] = cloneMap(entry)
		}
	}
	return out
}

func playerStatus(game *state.GameState, playerID string) string {
	player, ok := game.Players[playerID]
	if !ok {
		return ""
	}
	status, _ := player["status"].(string)
	// Old compact snapshots omitted status. Normalize that legacy shape at the
	// boundary as active; all current state is written explicitly as active or
	// conceded and no life/commander threshold participates in this decision.
	if status == "" {
		return "active"
	}
	return status
}

func playerDisplayName(game *state.GameState, playerID string) string {
	player, ok := game.Players[playerID]
	if !ok {
		return playerID
	}
	user, _ := player["user"].(map[string]any)
	if displayName, _ := user["displayName"].(string); strings.TrimSpace(displayName) != "" {
		return strings.TrimSpace(displayName)
	}
	return playerID
}

func stringSliceContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
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
		if playerStatus(game, playerID) != "active" {
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

func finishWhenOneActivePlayerRemains(game *state.GameState, commandPayload map[string]any, eventPayload map[string]any, emitter *PatchEmitter) {
	if game.Status == "finished" {
		return
	}
	activePlayerIDs := make([]string, 0, len(game.Players))
	for playerID := range game.Players {
		if playerStatus(game, playerID) == "active" {
			activePlayerIDs = append(activePlayerIDs, playerID)
		}
	}
	if len(activePlayerIDs) != 1 {
		return
	}
	sort.Strings(activePlayerIDs)
	finishedAt := nowUTC().Format(time.RFC3339)
	if value, ok := commandPayload["finishedAt"].(string); ok && strings.TrimSpace(value) != "" {
		finishedAt = strings.TrimSpace(value)
	}

	game.Status = "finished"
	game.Phase = state.PhaseFinished
	game.WinnerPlayerID = activePlayerIDs[0]
	game.FinishedAt = finishedAt
	game.FinishReason = "last_player_standing"
	if len(game.DisconnectVotes) > 0 {
		game.DisconnectVotes = map[string]map[string]any{}
		emitDisconnectVotePatch(game, emitter)
	}
	emitter.EmitPublic(protocol.PatchOp{
		Op: "game.status.set",
		Data: map[string]any{
			"status":         "finished",
			"phase":          state.PhaseFinished,
			"winnerPlayerId": game.WinnerPlayerID,
			"finishedAt":     game.FinishedAt,
			"finishReason":   game.FinishReason,
		},
	})
	emitter.EmitPublic(protocol.PatchOp{Op: "game.phase.set", Data: map[string]any{"phase": state.PhaseFinished}})
	eventPayload["gameStatus"] = game.Status
	eventPayload["phase"] = game.Phase
	eventPayload["winnerPlayerId"] = game.WinnerPlayerID
	eventPayload["finishedAt"] = game.FinishedAt
	eventPayload["finishReason"] = game.FinishReason
}

func lifecycleMetrics(start time.Time, emitter *PatchEmitter) map[string]any {
	return map[string]any{
		"lifecycle.runtime_route":        1,
		"lifecycle.snapshot_write_count": 0,
		"lifecycle.apply_ms":             float64(time.Since(start).Microseconds()) / 1000,
		"lifecycle.patch_bytes":          patchBytes(emitter),
	}
}
