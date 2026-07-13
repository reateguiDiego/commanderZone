package actor

import (
	"sort"
	"strings"
	"time"

	"context"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

const (
	disconnectVoteEffectVersion = 4
	disconnectVoteTimeout       = 60 * time.Second
	disconnectVoteCooldown      = 300 * time.Second
)

type ControlPlaneError struct {
	Code             string
	CommandType      string
	VoteID           string
	TargetPlayerID   string
	RemainingSeconds int
}

func (e *ControlPlaneError) Error() string {
	if e == nil {
		return "control plane error"
	}
	return e.Code
}

func AsControlPlaneError(err error) (*ControlPlaneError, bool) {
	for err != nil {
		if typed, ok := err.(*ControlPlaneError); ok {
			return typed, true
		}
		type unwrapper interface{ Unwrap() error }
		wrapped, ok := err.(unwrapper)
		if !ok {
			break
		}
		err = wrapped.Unwrap()
	}
	return nil, false
}

type DurableDisconnectVoteApplier struct{}

func (DurableDisconnectVoteApplier) Type() string { return "disconnect.vote" }

func (DurableDisconnectVoteApplier) Apply(_ context.Context, game *state.GameState, command protocol.CommandEnvelopeV2, emitter *PatchEmitter) (map[string]any, error) {
	now := durableDisconnectNow(command)
	targetID := strings.TrimSpace(firstString(command.Payload["targetPlayerId"]))
	if targetID == "" {
		return nil, disconnectError("INVALID_TARGET", command, "", "", 0)
	}
	if _, ok := game.Players[targetID]; !ok {
		return nil, disconnectError("INVALID_TARGET", command, "", targetID, 0)
	}
	if durableGameClosed(game) {
		return nil, disconnectError("GAME_CLOSED", command, durableVoteID(game.DisconnectVote), targetID, 0)
	}

	if command.Client["source"] == "runtime_ws_presence" {
		status := strings.TrimSpace(firstString(command.Payload["status"]))
		switch status {
		case "online", "offline", "timeout":
			return applyDurablePresenceCommand(game, command, targetID, status, now, emitter)
		default:
			return nil, disconnectError("INVALID_PRESENCE_STATUS", command, "", targetID, 0)
		}
	}

	actorID := strings.TrimSpace(firstString(command.Client["playerId"], command.Payload["playerId"]))
	if actorID == "" || actorID != strings.TrimSpace(firstString(command.Client["playerId"])) {
		return nil, disconnectError("PERMISSION_DENIED", command, durableVoteID(game.DisconnectVote), targetID, 0)
	}
	if playerStatus(game, actorID) != "active" {
		return nil, disconnectError("PLAYER_NOT_ACTIVE", command, durableVoteID(game.DisconnectVote), targetID, 0)
	}
	if !durablePresenceConnected(game, actorID) && len(game.Presence) > 0 {
		return nil, disconnectError("NOT_ELIGIBLE_VOTER", command, durableVoteID(game.DisconnectVote), targetID, 0)
	}

	action := strings.TrimSpace(firstString(command.Payload["action"]))
	decision := strings.TrimSpace(firstString(command.Payload["decision"], command.Payload["vote"]))
	if action == "open" || decision == "" {
		return openDurableDisconnectVote(game, command, targetID, actorID, durableConnectedIDs(game, command.Payload), now, emitter)
	}
	return castDurableDisconnectVote(game, command, targetID, actorID, decision, now, emitter)
}

func applyDurablePresenceCommand(game *state.GameState, command protocol.CommandEnvelopeV2, targetID, status string, now time.Time, emitter *PatchEmitter) (map[string]any, error) {
	if status == "timeout" {
		return expireDurableDisconnectVote(game, command, targetID, now, emitter)
	}
	if game.Presence == nil {
		game.Presence = map[string]map[string]any{}
	}
	connected := status == "online"
	count := 0
	if connected {
		count = 1
	}
	if value, ok := intFromAny(command.Payload["activeConnectionCount"]); ok && value >= 0 {
		count = value
		connected = value > 0
	}
	previous := cloneMap(game.Presence[targetID])
	epoch, _ := intFromAny(previous["connectionEpoch"])
	if firstBool(previous["connected"]) != connected {
		epoch++
	}
	presence := map[string]any{
		"playerId": targetID, "connected": connected, "activeConnectionCount": count,
		"connectionEpoch": epoch, "lastSeenAt": now.UTC().Format(time.RFC3339Nano),
	}
	if connected {
		presence["disconnectedAt"] = nil
	} else {
		disconnectedAt := previous["disconnectedAt"]
		if disconnectedAt == nil || disconnectedAt == "" {
			disconnectedAt = now.UTC().Format(time.RFC3339Nano)
		}
		presence["disconnectedAt"] = disconnectedAt
	}
	game.Presence[targetID] = presence
	emitDurablePresence(targetID, presence, emitter)

	if connected {
		if durableVoteOpenFor(game.DisconnectVote, targetID) {
			resolveDurableVoteWithoutExpel(game, "cancelled", "reconnected", now, emitter)
			return durableDisconnectPayload("disconnect.vote.cancelled", game, targetID, now, emitter), nil
		}
		return durablePresencePayload(game, targetID, now, emitter), nil
	}
	connectedIDs := durableConnectedIDs(game, command.Payload)
	for _, playerID := range connectedIDs {
		if playerID == targetID {
			continue
		}
		entry := cloneMap(game.Presence[playerID])
		entry["playerId"] = playerID
		entry["connected"] = true
		if count, ok := intFromAny(entry["activeConnectionCount"]); !ok || count < 1 {
			entry["activeConnectionCount"] = 1
		}
		entry["lastSeenAt"] = now.UTC().Format(time.RFC3339Nano)
		game.Presence[playerID] = entry
	}
	if playerStatus(game, targetID) != "active" || durableHasOpenVote(game.DisconnectVote) || durableCooldownRemaining(game, targetID, now) > 0 {
		return durablePresencePayload(game, targetID, now, emitter), nil
	}
	eligible := durableEligibleVoters(game, targetID, connectedIDs)
	if len(eligible) == 0 {
		return durablePresencePayload(game, targetID, now, emitter), nil
	}
	opener := eligible[0]
	return openDurableDisconnectVote(game, command, targetID, opener, connectedIDs, now, emitter)
}

func openDurableDisconnectVote(game *state.GameState, command protocol.CommandEnvelopeV2, targetID, openerID string, connectedIDs []string, now time.Time, emitter *PatchEmitter) (map[string]any, error) {
	if playerStatus(game, targetID) != "active" {
		return nil, disconnectError("TARGET_NOT_ACTIVE", command, durableVoteID(game.DisconnectVote), targetID, 0)
	}
	if targetID == openerID {
		return nil, disconnectError("PERMISSION_DENIED", command, "", targetID, 0)
	}
	if durablePresenceConnected(game, targetID) || stringSliceContains(connectedIDs, targetID) {
		return nil, disconnectError("TARGET_NOT_DISCONNECTED", command, "", targetID, 0)
	}
	if durableHasOpenVote(game.DisconnectVote) {
		return nil, disconnectError("VOTE_ALREADY_OPEN", command, durableVoteID(game.DisconnectVote), targetID, 0)
	}
	if remaining := durableCooldownRemaining(game, targetID, now); remaining > 0 {
		return nil, disconnectError("COOLDOWN_ACTIVE", command, durableVoteID(game.DisconnectVote), targetID, remaining)
	}
	eligible := durableEligibleVoters(game, targetID, connectedIDs)
	if len(eligible) == 0 || !stringSliceContains(eligible, openerID) {
		return nil, disconnectError("INSUFFICIENT_ELIGIBLE_VOTERS", command, "", targetID, 0)
	}
	voteID := stableRuntimeLogID(command.GameID, command.ClientActionID, "disconnect.vote")
	expiresAt := now.Add(disconnectVoteTimeout).UTC().Format(time.RFC3339Nano)
	game.DisconnectVote = map[string]any{
		"voteId": voteID, "targetPlayerId": targetID, "openedByPlayerId": openerID,
		"status": "open", "eligibleVoterIds": append([]string(nil), eligible...),
		"requiredVotes": len(eligible)/2 + 1, "votesByPlayerId": map[string]any{}, "votes": map[string]any{},
		"openedAt": now.UTC().Format(time.RFC3339Nano), "expiresAt": expiresAt, "deadlineAt": expiresAt,
		"resolvedAt": nil, "cooldownUntil": nil, "resolution": nil, "effectVersion": disconnectVoteEffectVersion,
	}
	emitDurableVote(game, emitter)
	payload := durableDisconnectPayload("disconnect.vote.opened", game, targetID, now, emitter)
	payload["openedByPlayerId"] = openerID
	return payload, nil
}

func castDurableDisconnectVote(game *state.GameState, command protocol.CommandEnvelopeV2, targetID, voterID, decision string, now time.Time, emitter *PatchEmitter) (map[string]any, error) {
	if decision != "expel" && decision != "wait" {
		return nil, disconnectError("INVALID_VOTE_DECISION", command, durableVoteID(game.DisconnectVote), targetID, 0)
	}
	current := cloneMap(game.DisconnectVote)
	voteID := strings.TrimSpace(firstString(command.Payload["voteId"]))
	if voteID == "" {
		voteID = durableVoteID(current)
	}
	if durableVoteID(current) == "" || voteID != durableVoteID(current) {
		return nil, disconnectError("VOTE_NOT_FOUND", command, voteID, targetID, 0)
	}
	if current["status"] != "open" || current["targetPlayerId"] != targetID {
		return nil, disconnectError("VOTE_NOT_OPEN", command, voteID, targetID, 0)
	}
	if expiresAt, ok := durableTime(current["expiresAt"]); ok && !now.Before(expiresAt) {
		return nil, disconnectError("VOTE_EXPIRED", command, voteID, targetID, 0)
	}
	eligible := stringsFromAny(current["eligibleVoterIds"])
	if !stringSliceContains(eligible, voterID) || playerStatus(game, voterID) != "active" {
		return nil, disconnectError("NOT_ELIGIBLE_VOTER", command, voteID, targetID, 0)
	}
	votes := disconnectVoteVotes(current["votesByPlayerId"])
	if _, exists := votes[voterID]; exists {
		return nil, disconnectError("DUPLICATE_VOTE", command, voteID, targetID, 0)
	}
	votes[voterID] = map[string]any{
		"playerId": voterID, "displayName": playerDisplayName(game, voterID),
		"decision": decision, "vote": decision, "votedAt": now.UTC().Format(time.RFC3339Nano),
	}
	current["votesByPlayerId"] = votes
	current["votes"] = cloneMap(votes)
	game.DisconnectVote = current

	expelVotes, castVotes := 0, 0
	for _, playerID := range eligible {
		entry, _ := votes[playerID].(map[string]any)
		if entry == nil {
			continue
		}
		castVotes++
		if firstString(entry["decision"], entry["vote"]) == "expel" {
			expelVotes++
		}
	}
	required, _ := intFromAny(current["requiredVotes"])
	if required < 1 {
		required = len(eligible)/2 + 1
	}
	payloadType := "disconnect.vote.cast"
	if expelVotes >= required {
		current["status"] = "executed"
		current["resolution"] = "expel"
		current["passedAt"] = now.UTC().Format(time.RFC3339Nano)
		current["resolvedAt"] = now.UTC().Format(time.RFC3339Nano)
		current["expiresAt"] = nil
		current["deadlineAt"] = nil
		game.DisconnectVote = current
		player := game.Players[targetID]
		player["concededAt"] = now.UTC().Format(time.RFC3339Nano)
		game.Players[targetID] = player
		transition, err := eliminatePlayer(game, targetID, "expelled", eliminationContext{}, emitter)
		if err != nil {
			return nil, err
		}
		projectDurableRematchLeave(game, targetID, now, emitter)
		emitDurableVote(game, emitter)
		payload := durableDisconnectPayload("disconnect.vote.resolved", game, targetID, now, emitter)
		payload["playerId"] = voterID
		payload["decision"] = decision
		payload["concededAt"] = player["concededAt"]
		addLifecycleEffects(payload, game, transition)
		payload["effectVersion"] = disconnectVoteEffectVersion
		payload["disconnectVote"] = cloneMap(game.DisconnectVote)
		payload["rematch"] = cloneMap(game.Rematch)
		return payload, nil
	}
	remaining := len(eligible) - castVotes
	if expelVotes+remaining < required || castVotes == len(eligible) {
		resolveDurableVoteWithoutExpel(game, "rejected", "wait", now, emitter)
		payloadType = "disconnect.vote.resolved"
	} else {
		emitDurableVote(game, emitter)
	}
	payload := durableDisconnectPayload(payloadType, game, targetID, now, emitter)
	payload["playerId"] = voterID
	payload["decision"] = decision
	return payload, nil
}

func expireDurableDisconnectVote(game *state.GameState, command protocol.CommandEnvelopeV2, targetID string, now time.Time, emitter *PatchEmitter) (map[string]any, error) {
	current := game.DisconnectVote
	if !durableVoteOpenFor(current, targetID) {
		return nil, disconnectError("VOTE_NOT_OPEN", command, durableVoteID(current), targetID, 0)
	}
	if expected := firstString(command.Payload["voteId"]); expected != "" && expected != durableVoteID(current) {
		return nil, disconnectError("VOTE_NOT_FOUND", command, expected, targetID, 0)
	}
	expiresAt, ok := durableTime(current["expiresAt"])
	if !ok || now.Before(expiresAt) {
		return nil, disconnectError("VOTE_NOT_OPEN", command, durableVoteID(current), targetID, 0)
	}
	resolveDurableVoteWithoutExpel(game, "expired", "wait", now, emitter)
	return durableDisconnectPayload("disconnect.vote.expired", game, targetID, now, emitter), nil
}

func resolveDurableVoteWithoutExpel(game *state.GameState, status, resolution string, now time.Time, emitter *PatchEmitter) {
	current := cloneMap(game.DisconnectVote)
	targetID := firstString(current["targetPlayerId"])
	cooldownUntil := now.Add(disconnectVoteCooldown).UTC().Format(time.RFC3339Nano)
	current["status"] = status
	current["resolution"] = resolution
	current["resolvedAt"] = now.UTC().Format(time.RFC3339Nano)
	current["expiresAt"] = nil
	current["deadlineAt"] = nil
	current["cooldownUntil"] = cooldownUntil
	game.DisconnectVote = current
	if game.DisconnectCooldowns == nil {
		game.DisconnectCooldowns = map[string]map[string]any{}
	}
	game.DisconnectCooldowns[targetID] = map[string]any{
		"targetPlayerId": targetID, "voteId": durableVoteID(current), "reason": resolution,
		"cooldownUntil": cooldownUntil,
	}
	emitDurableVote(game, emitter)
	emitter.EmitPublic(protocol.PatchOp{Op: "disconnect.cooldown.set", Data: map[string]any{
		"targetPlayerId": targetID, "cooldown": cloneMap(game.DisconnectCooldowns[targetID]),
	}})
}

func invalidateDurableVoteForLifecycle(game *state.GameState, playerID, resolution string, now time.Time, emitter *PatchEmitter) bool {
	if !durableHasOpenVote(game.DisconnectVote) {
		return false
	}
	targetID := firstString(game.DisconnectVote["targetPlayerId"])
	openerID := firstString(game.DisconnectVote["openedByPlayerId"])
	if playerID != "" && playerID != targetID && playerID != openerID {
		return false
	}
	current := cloneMap(game.DisconnectVote)
	current["status"] = "cancelled"
	current["resolution"] = resolution
	current["resolvedAt"] = now.UTC().Format(time.RFC3339Nano)
	current["expiresAt"] = nil
	current["deadlineAt"] = nil
	current["cooldownUntil"] = nil
	game.DisconnectVote = current
	emitDurableVote(game, emitter)
	return true
}

func projectDurableRematchLeave(game *state.GameState, targetID string, now time.Time, emitter *PatchEmitter) {
	if game.Rematch == nil {
		game.Rematch = map[string]any{}
	}
	votes := disconnectVoteVotes(game.Rematch["votes"])
	votes[targetID] = map[string]any{
		"playerId": targetID, "displayName": playerDisplayName(game, targetID), "vote": "leave",
		"votedAt": now.UTC().Format(time.RFC3339Nano),
	}
	game.Rematch["votes"] = votes
	emitter.EmitPublic(protocol.PatchOp{Op: "rematch.set", Data: map[string]any{"rematch": cloneMap(game.Rematch)}})
}

func durableDisconnectPayload(eventType string, game *state.GameState, targetID string, now time.Time, emitter *PatchEmitter) map[string]any {
	return map[string]any{
		"_eventType": eventType, "eventType": eventType, "effectVersion": disconnectVoteEffectVersion,
		"targetPlayerId": targetID, "voteId": durableVoteID(game.DisconnectVote),
		"status": game.DisconnectVote["status"], "resolution": game.DisconnectVote["resolution"],
		"disconnectVote": cloneMap(game.DisconnectVote), "presence": cloneNestedMap(game.Presence),
		"disconnectCooldowns": cloneNestedMap(game.DisconnectCooldowns), "rematch": cloneMap(game.Rematch),
		"occurredAt": now.UTC().Format(time.RFC3339Nano), "snapshot_write_count": 0,
		"metrics": map[string]any{"disconnect.vote_route": 1, "disconnect.snapshot_write_count": 0, "disconnect.patch_bytes": patchBytes(emitter)},
	}
}

func durablePresencePayload(game *state.GameState, targetID string, now time.Time, emitter *PatchEmitter) map[string]any {
	payload := durableDisconnectPayload("player.presence.changed", game, targetID, now, emitter)
	payload["presenceState"] = cloneMap(game.Presence[targetID])
	return payload
}

func emitDurablePresence(playerID string, presence map[string]any, emitter *PatchEmitter) {
	publicPresence := cloneMap(presence)
	delete(publicPresence, "connectionEpoch")
	emitter.EmitPublic(protocol.PatchOp{Op: "player.presence.set", Data: map[string]any{"playerId": playerID, "presence": publicPresence}})
}

func emitDurableVote(game *state.GameState, emitter *PatchEmitter) {
	emitter.EmitPublic(protocol.PatchOp{Op: "disconnect.vote.set", Data: map[string]any{"disconnectVote": cloneMap(game.DisconnectVote)}})
}

func durableEligibleVoters(game *state.GameState, targetID string, connectedIDs []string) []string {
	connected := map[string]bool{}
	for _, playerID := range connectedIDs {
		connected[playerID] = true
	}
	if len(connected) == 0 {
		for playerID, presence := range game.Presence {
			connected[playerID] = firstBool(presence["connected"])
		}
	}
	eligible := []string{}
	for _, playerID := range game.TurnOrder {
		if playerID != targetID && playerStatus(game, playerID) == "active" && connected[playerID] {
			eligible = append(eligible, playerID)
		}
	}
	if len(game.TurnOrder) == 0 {
		for playerID := range game.Players {
			if playerID != targetID && playerStatus(game, playerID) == "active" && connected[playerID] {
				eligible = append(eligible, playerID)
			}
		}
		sort.Strings(eligible)
	}
	return eligible
}

func durableConnectedIDs(game *state.GameState, payload map[string]any) []string {
	ids := connectedUserIDs(payload)
	if len(ids) == 0 {
		for playerID, presence := range game.Presence {
			if firstBool(presence["connected"]) {
				ids = append(ids, playerID)
			}
		}
	}
	sort.Strings(ids)
	return ids
}

func durablePresenceConnected(game *state.GameState, playerID string) bool {
	presence, ok := game.Presence[playerID]
	return ok && firstBool(presence["connected"])
}

func durableHasOpenVote(vote map[string]any) bool { return firstString(vote["status"]) == "open" }

func durableVoteOpenFor(vote map[string]any, targetID string) bool {
	return durableHasOpenVote(vote) && firstString(vote["targetPlayerId"]) == targetID
}

func durableVoteID(vote map[string]any) string { return firstString(vote["voteId"]) }

func durableCooldownRemaining(game *state.GameState, targetID string, now time.Time) int {
	cooldown := game.DisconnectCooldowns[targetID]
	value := cooldown["cooldownUntil"]
	if value == nil && firstString(game.DisconnectVote["targetPlayerId"]) == targetID {
		value = game.DisconnectVote["cooldownUntil"]
	}
	until, ok := durableTime(value)
	if !ok || !now.Before(until) {
		return 0
	}
	return int(until.Sub(now).Seconds() + 0.999)
}

func durableTime(value any) (time.Time, bool) {
	text := strings.TrimSpace(firstString(value))
	if text == "" {
		return time.Time{}, false
	}
	parsed, err := time.Parse(time.RFC3339Nano, text)
	return parsed, err == nil
}

func durableDisconnectNow(command protocol.CommandEnvelopeV2) time.Time {
	if command.Client["source"] == "runtime_ws_presence" {
		if parsed, ok := durableTime(command.Payload["occurredAt"]); ok {
			return parsed.UTC()
		}
	}
	return nowUTC()
}

func durableGameClosed(game *state.GameState) bool {
	return game.Status == "finished" || game.Status == "closed" || game.Phase == state.PhaseFinished || game.ResultState != ""
}

func disconnectError(code string, command protocol.CommandEnvelopeV2, voteID, targetID string, remaining int) error {
	return &ControlPlaneError{Code: code, CommandType: command.Type, VoteID: voteID, TargetPlayerID: targetID, RemainingSeconds: remaining}
}

func cloneNestedMap(source map[string]map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range source {
		out[key] = cloneMap(value)
	}
	return out
}
