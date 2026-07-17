package actor

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

func runtimeEventLogEntries(game *state.GameState, command protocol.CommandEnvelopeV2, payload map[string]any, actorID string, version int64, createdAt time.Time) []map[string]any {
	if game == nil {
		return nil
	}
	if command.Type == "disconnect.vote" {
		return sanitizeRuntimePublicLogEntries(game, command, payload, append(runtimeDisconnectVoteLogEntries(game, command, payload, actorID, version, createdAt), runtimeLifecycleLogEntries(game, command, payload, actorID, version, createdAt, false)...))
	}
	if command.Type == "commander.damage.changed" {
		return sanitizeRuntimePublicLogEntries(game, command, payload, append(runtimeCommanderDamageLogEntries(game, command, payload, actorID, version, createdAt), runtimeLifecycleLogEntries(game, command, payload, actorID, version, createdAt, true)...))
	}
	displayName := playerDisplayName(game, actorID)
	message := runtimeLogMessage(game, command, payload, displayName)
	if strings.TrimSpace(message) == "" {
		return runtimeLifecycleLogEntries(game, command, payload, actorID, version, createdAt, false)
	}
	entry := map[string]any{
		"id":          stableRuntimeLogID(command.GameID, command.ClientActionID, command.Type),
		"type":        command.Type,
		"message":     message,
		"version":     version,
		"actorId":     actorID,
		"displayName": displayName,
		"createdAt":   createdAt.UTC().Format(time.RFC3339),
	}
	if instanceID := firstString(payload["instanceId"], command.Payload["instanceId"]); instanceID != "" {
		entry["cardInstanceId"] = instanceID
		if location, ok := game.Loc[instanceID]; ok {
			entry["cardPlayerId"] = location.PlayerID
			entry["cardZone"] = string(location.Zone)
		}
	}
	if cardNames := runtimeLogCardNames(payload); len(cardNames) > 0 {
		entry["cardNames"] = cardNames
	}
	for key, value := range runtimeLogSemantic(game, command, payload, actorID) {
		entry[key] = value
	}
	return sanitizeRuntimePublicLogEntries(game, command, payload, append([]map[string]any{entry}, runtimeLifecycleLogEntries(game, command, payload, actorID, version, createdAt, false)...))
}

func runtimeDisconnectVoteLogEntries(game *state.GameState, command protocol.CommandEnvelopeV2, payload map[string]any, actorID string, version int64, createdAt time.Time) []map[string]any {
	eventType := optionalString(payload, "eventType")
	decision := optionalString(payload, "decision")
	resolution := optionalString(payload, "resolution")
	key := ""
	switch eventType {
	case "disconnect.vote.opened":
		key = "gameLog.disconnect.vote.opened"
	case "disconnect.vote.cast":
		if decision == "expel" {
			key = "gameLog.disconnect.vote.castExpel"
		} else {
			key = "gameLog.disconnect.vote.castWait"
		}
	case "disconnect.vote.expired":
		key = "gameLog.disconnect.vote.expired"
	case "disconnect.vote.cancelled":
		if resolution == "reconnected" {
			key = "gameLog.disconnect.vote.cancelledByReconnect"
		}
	case "disconnect.vote.resolved":
		if resolution == "expel" {
			key = "gameLog.disconnect.vote.passed"
		} else {
			key = "gameLog.disconnect.vote.rejected"
		}
	}
	if key == "" {
		return nil
	}
	targetID := optionalString(payload, "targetPlayerId")
	params := map[string]any{
		"voteId": optionalString(payload, "voteId"), "targetPlayerId": targetID,
		"actorPlayerId": actorID, "decision": decision, "resolution": resolution,
	}
	entry := map[string]any{
		"id": stableRuntimeLogID(command.GameID, command.ClientActionID, eventType), "type": eventType,
		"message": key, "i18nKey": key, "params": params, "version": version,
		"actorId": actorID, "displayName": playerDisplayName(game, actorID),
		"createdAt": createdAt.UTC().Format(time.RFC3339), "visibility": "public",
	}
	entries := []map[string]any{entry}
	if resolution == "reconnected" {
		entries = append(entries, map[string]any{
			"id": stableRuntimeLogID(command.GameID, command.ClientActionID, "reconnected"), "type": "player.reconnectedDuringVote",
			"message": "gameLog.player.reconnectedDuringVote", "i18nKey": "gameLog.player.reconnectedDuringVote", "params": params,
			"version": version, "actorId": targetID, "displayName": playerDisplayName(game, targetID),
			"createdAt": createdAt.UTC().Format(time.RFC3339), "visibility": "public",
		})
	}
	if eventType == "disconnect.vote.expired" || (eventType == "disconnect.vote.resolved" && resolution != "expel") || resolution == "reconnected" {
		entries = append(entries, map[string]any{
			"id": stableRuntimeLogID(command.GameID, command.ClientActionID, "cooldown"), "type": "disconnect.cooldown.started",
			"message": "gameLog.disconnect.cooldown.started", "i18nKey": "gameLog.disconnect.cooldown.started", "params": params,
			"version": version, "actorId": actorID, "displayName": playerDisplayName(game, actorID),
			"createdAt": createdAt.UTC().Format(time.RFC3339), "visibility": "public",
		})
	}
	return entries
}

func runtimeLifecycleLogEntries(game *state.GameState, command protocol.CommandEnvelopeV2, payload map[string]any, actorID string, version int64, createdAt time.Time, commanderLogged bool) []map[string]any {
	if !firstBool(payload["statusChanged"]) && optionalString(payload, "eliminationReason") == "" {
		return nil
	}
	target := firstString(payload["targetPlayerId"], payload["playerId"], command.Payload["playerId"])
	reason := optionalString(payload, "eliminationReason")
	key := ""
	if reason == "life" {
		key = "gameLifecycleLog.player.defeatedByLife"
	}
	if reason == "concede" {
		key = "gameLifecycleLog.player.conceded"
	}
	if reason == "expelled" {
		key = "gameLifecycleLog.player.expelled"
	}
	if reason == "commander_damage" && commanderLogged {
		key = ""
	}
	entries := []map[string]any{}
	add := func(suffix, i18nKey string, params map[string]any) {
		entries = append(entries, map[string]any{"id": stableRuntimeLogID(command.GameID, command.ClientActionID, suffix), "type": "player.eliminated", "message": i18nKey, "version": version, "actorId": actorID, "displayName": playerDisplayName(game, actorID), "createdAt": createdAt.UTC().Format(time.RFC3339), "i18nKey": i18nKey, "params": params, "visibility": "public"})
	}
	params := map[string]any{"targetPlayerId": target, "sourcePlayerId": optionalString(payload, "sourcePlayerId")}
	if key != "" {
		add("lifecycle."+reason, key, params)
	}
	previousTurn, _ := payload["previousTurn"].(map[string]any)
	turn, _ := payload["turn"].(map[string]any)
	if optionalString(previousTurn, "activePlayerId") != optionalString(turn, "activePlayerId") {
		add("lifecycle.turn", "gameLifecycleLog.turn.passedByElimination", map[string]any{"targetPlayerId": target, "activePlayerId": optionalString(turn, "activePlayerId")})
	}
	if optionalString(payload, "resultState") != "" {
		add("lifecycle.result", "gameLifecycleLog.result.lastActive", map[string]any{"winnerPlayerId": optionalString(payload, "winnerPlayerId"), "resultState": optionalString(payload, "resultState")})
	}
	before, _ := payload["designationsBefore"].(map[string]any)
	after, _ := payload["designationsAfter"].(map[string]any)
	for _, template := range []string{"monarch", "initiative"} {
		if fmt.Sprint(before[template]) == fmt.Sprint(after[template]) {
			continue
		}
		entity, _ := after[template].(map[string]any)
		add("lifecycle."+template, "gameLifecycleLog."+template+".reassigned", map[string]any{"ownerPlayerId": optionalString(entity, "ownerPlayerId")})
	}
	return entries
}

func runtimeCommanderDamageLogEntries(game *state.GameState, command protocol.CommandEnvelopeV2, payload map[string]any, actorID string, version int64, createdAt time.Time) []map[string]any {
	targetPlayerID := firstString(payload["targetPlayerId"], command.Payload["targetPlayerId"])
	sourcePlayerID := firstString(payload["sourcePlayerId"], command.Payload["sourcePlayerId"])
	commanderInstanceID := firstString(payload["commanderInstanceId"], command.Payload["commanderInstanceId"])
	previousDamage := intFromPayload(payload, "previousDamage", 0)
	damage := intFromPayload(payload, "damage", previousDamage)
	delta := intFromPayload(payload, "delta", damage-previousDamage)
	previousLife := intFromPayload(payload, "previousLife", 0)
	life := intFromPayload(payload, "life", previousLife)
	params := map[string]any{
		"actorPlayerId":       actorID,
		"sourcePlayerId":      sourcePlayerID,
		"targetPlayerId":      targetPlayerID,
		"commanderInstanceId": commanderInstanceID,
		"previousDamage":      previousDamage,
		"damage":              damage,
		"delta":               delta,
		"previousLife":        previousLife,
		"life":                life,
	}
	refs := runtimeLogRefs(game, []string{actorID, sourcePlayerID, targetPlayerID}, []string{commanderInstanceID})
	changed := map[string]any{
		"id":             stableRuntimeLogID(command.GameID, command.ClientActionID, "commanderDamage.changed"),
		"type":           command.Type,
		"message":        fmt.Sprintf("Commander damage from %s to %s changed from %d to %d; life changed from %d to %d.", playerDisplayName(game, sourcePlayerID), playerDisplayName(game, targetPlayerID), previousDamage, damage, previousLife, life),
		"version":        version,
		"actorId":        actorID,
		"displayName":    playerDisplayName(game, actorID),
		"createdAt":      createdAt.UTC().Format(time.RFC3339),
		"cardInstanceId": commanderInstanceID,
		"i18nKey":        "gameLog.commanderDamage.changed",
		"params":         params,
		"visibility":     "public",
	}
	if len(refs) > 0 {
		changed["refs"] = refs
	}
	entries := []map[string]any{changed}
	if firstBool(payload["statusChanged"]) && firstString(payload["status"]) == "defeated" {
		defeated := map[string]any{
			"id":             stableRuntimeLogID(command.GameID, command.ClientActionID, "player.defeatedByCommanderDamage"),
			"type":           "player.defeated",
			"message":        fmt.Sprintf("%s was defeated by commander damage from %s.", playerDisplayName(game, targetPlayerID), playerDisplayName(game, sourcePlayerID)),
			"version":        version,
			"actorId":        targetPlayerID,
			"displayName":    playerDisplayName(game, targetPlayerID),
			"createdAt":      createdAt.UTC().Format(time.RFC3339),
			"cardInstanceId": commanderInstanceID,
			"i18nKey":        "gameLog.player.defeatedByCommanderDamage",
			"params":         params,
			"visibility":     "public",
		}
		if len(refs) > 0 {
			defeated["refs"] = refs
		}
		entries = append(entries, defeated)
	}
	return entries
}

func runtimeLogSemantic(game *state.GameState, command protocol.CommandEnvelopeV2, payload map[string]any, actorID string) map[string]any {
	actorPlayerID := actorID
	if actorPlayerID == "" {
		actorPlayerID = firstString(payload["playerId"], command.Payload["playerId"])
	}
	baseParams := func() map[string]any {
		params := map[string]any{}
		if actorPlayerID != "" {
			params["actorPlayerId"] = actorPlayerID
		}
		return params
	}
	semantic := func(i18nKey string, params map[string]any, playerIDs []string, cardIDs []string) map[string]any {
		fields := map[string]any{
			"i18nKey":    i18nKey,
			"params":     params,
			"visibility": "public",
		}
		if refs := runtimeLogRefs(game, playerIDs, cardIDs); len(refs) > 0 {
			fields["refs"] = refs
		}
		return fields
	}

	switch command.Type {
	case "hand.cards.reveal", "hand.cards.revoke":
		params := baseParams()
		params["count"] = intFromPayload(payload, "count", len(stringsFromAny(payload["orderedInstanceIds"])))
		if audience, ok := payload["audience"].(map[string]any); ok {
			params["audienceScope"] = optionalString(audience, "scope")
		}
		key := "gameLog.hand.revealed"
		if command.Type == "hand.cards.revoke" {
			key = "gameLog.hand.revoked"
		}
		return semantic(key, params, []string{actorPlayerID}, nil)
	case "library.selection.move":
		count := intFromPayload(payload, "count", len(stringsFromAny(payload["orderedInstanceIds"])))
		destination := firstString(payload["destination"], payload["toZone"], command.Payload["toZone"])
		position := firstString(payload["position"], command.Payload["position"])
		faceDown := firstBool(payload["faceDown"], command.Payload["faceDown"])
		params := baseParams()
		params["count"] = count
		params["destination"] = destination
		params["faceDown"] = faceDown
		key := "gameLog.library.selectedMoved"
		switch {
		case destination == "battlefield" && faceDown:
			key = "gameLog.library.playedSelectedFaceDown"
		case destination == "hand":
			key = "gameLog.library.selectedToHand"
		case destination == "graveyard":
			key = "gameLog.library.selectedToGraveyard"
		case destination == "exile":
			key = "gameLog.library.selectedToExile"
		case destination == "battlefield":
			key = "gameLog.library.selectedToBattlefield"
		case destination == "library" && position == "top":
			key = "gameLog.library.putSelectedTop"
		case destination == "library" && position == "bottom":
			key = "gameLog.library.putSelectedBottom"
		}
		return semantic(key, params, []string{actorPlayerID}, nil)
	case "library.top.play_face_down":
		params := baseParams()
		params["count"] = intFromPayload(payload, "count", intFromPayload(command.Payload, "count", 1))
		params["destination"] = "battlefield"
		params["faceDown"] = true
		return semantic("gameLog.library.playedTopFaceDown", params, []string{actorPlayerID}, nil)
	case "library.draw", "library.draw_many":
		count := intFromPayload(payload, "count", 1)
		playerID := firstString(payload["playerId"], command.Payload["playerId"], actorPlayerID)
		params := baseParams()
		params["playerId"] = playerID
		params["count"] = count
		key := "gameLog.library.draw"
		if count != 1 {
			key = "gameLog.library.drawMany"
		}
		return semantic(key, params, []string{actorPlayerID, playerID}, nil)
	case "library.shuffle":
		playerID := firstString(payload["playerId"], command.Payload["playerId"], actorPlayerID)
		params := baseParams()
		params["playerId"] = playerID
		return semantic("gameLog.library.shuffle", params, []string{actorPlayerID, playerID}, nil)
	case "card.moved", "cards.moved":
		instanceIDs := stringsFromAny(payload["instanceIds"])
		if len(instanceIDs) == 0 {
			instanceIDs = stringsFromAny(command.Payload["instanceIds"])
		}
		instanceID := firstString(payload["instanceId"], command.Payload["instanceId"])
		if instanceID == "" && len(instanceIDs) > 0 {
			instanceID = instanceIDs[0]
		}
		if len(instanceIDs) == 0 && instanceID != "" {
			instanceIDs = []string{instanceID}
		}
		fromZone := firstString(payload["fromZone"], command.Payload["fromZone"])
		toZone := firstString(payload["toZone"], command.Payload["toZone"], payload["destination"], command.Payload["destination"])
		params := baseParams()
		params["fromZone"] = fromZone
		params["toZone"] = toZone
		params["count"] = len(instanceIDs)
		if params["count"] == 0 {
			params["count"] = 1
		}
		params["faceDown"] = firstBool(payload["faceDown"], command.Payload["faceDown"])
		if instanceID != "" {
			params["cardInstanceId"] = instanceID
		}
		if fromZone == "command" && toZone == "battlefield" {
			if casts, ok := commanderCastCountFromPayload(payload); ok {
				params["commanderCastCount"] = casts
				return semantic("gameLog.commander.cast", params, []string{actorPlayerID}, []string{instanceID})
			}
		}
		return semantic("gameLog.card.moved", params, []string{actorPlayerID}, instanceIDs)
	case "card.tapped":
		instanceID := firstString(payload["instanceId"], command.Payload["instanceId"])
		params := baseParams()
		params["tapped"] = firstBool(payload["tapped"], command.Payload["tapped"])
		if instanceID != "" {
			params["cardInstanceId"] = instanceID
		}
		key := "gameLog.card.untapped"
		if firstBool(payload["tapped"], command.Payload["tapped"]) {
			key = "gameLog.card.tapped"
		}
		return semantic(key, params, []string{actorPlayerID}, []string{instanceID})
	case "card.counter.changed":
		instanceID := firstString(payload["instanceId"], command.Payload["instanceId"])
		counter := firstString(payload["counter"], command.Payload["counter"], payload["key"], command.Payload["key"])
		params := baseParams()
		params["counter"] = counterLabel(counter)
		params["value"] = intFromPayload(payload, "value", 0)
		if instanceID != "" {
			params["cardInstanceId"] = instanceID
		}
		return semantic("gameLog.cardCounter.changed", params, []string{actorPlayerID}, []string{instanceID})
	case "card.stats.override.set", "card.stats.override.clear":
		instanceID := firstString(payload["instanceId"], command.Payload["instanceId"])
		params := baseParams()
		params["face"] = payload["faceKey"]
		previous, _ := payload["previousOverride"].(map[string]any)
		next, _ := payload["override"].(map[string]any)
		params["previousPower"] = previous["power"]
		params["power"] = next["power"]
		params["previousToughness"] = previous["toughness"]
		params["toughness"] = next["toughness"]
		instances := []string(nil)
		if location, ok := game.Loc[instanceID]; ok && location.Zone != state.ZoneHand && location.Zone != state.ZoneLibrary {
			params["cardInstanceId"] = instanceID
			instances = []string{instanceID}
		}
		key := "gameLog.card.statsOverrideSet"
		if command.Type == "card.stats.override.clear" {
			key = "gameLog.card.statsOverrideCleared"
		}
		return semantic(key, params, []string{actorPlayerID}, instances)
	case "life.changed":
		playerID := firstString(payload["playerId"], command.Payload["playerId"])
		params := baseParams()
		params["playerId"] = playerID
		params["previousLife"] = intFromPayload(payload, "previousLife", 0)
		params["life"] = intFromPayload(payload, "life", intFromPayload(payload, "previousLife", 0))
		return semantic("gameLog.life.changed", params, []string{actorPlayerID, playerID}, nil)
	case "dice.rolled":
		playerID := firstString(payload["playerId"], command.Payload["playerId"], actorPlayerID)
		result := payload["result"]
		if result == nil {
			result = payload["value"]
		}
		params := baseParams()
		params["playerId"] = playerID
		params["kind"] = firstString(payload["kind"], command.Payload["kind"])
		params["result"] = result
		return semantic("gameLog.dice.rolled", params, []string{actorPlayerID, playerID}, nil)
	case "card.token.created":
		count := intFromPayload(payload, "count", 1)
		playerID := firstString(payload["playerId"], command.Payload["playerId"], actorPlayerID)
		params := baseParams()
		params["playerId"] = playerID
		params["count"] = count
		params["tokenName"] = firstString(payload["name"], command.Payload["name"], "Token")
		key := "gameLog.token.created"
		if count != 1 {
			key = "gameLog.token.createdMany"
		}
		return semantic(key, params, []string{actorPlayerID, playerID}, stringsFromAny(payload["instanceIds"]))
	case "card.token_copy.created":
		playerID := firstString(payload["targetPlayerId"], command.Payload["targetPlayerId"], payload["playerId"], command.Payload["playerId"], actorPlayerID)
		instanceID := firstString(payload["instanceId"], command.Payload["instanceId"])
		sourceID := firstString(payload["sourceInstanceId"], command.Payload["sourceInstanceId"])
		params := baseParams()
		params["playerId"] = playerID
		if instanceID != "" {
			params["cardInstanceId"] = instanceID
		}
		if sourceID != "" {
			params["sourceCardInstanceId"] = sourceID
		}
		return semantic("gameLog.tokenCopy.created", params, []string{actorPlayerID, playerID}, []string{instanceID, sourceID})
	case "game.concede":
		playerID := firstString(payload["playerId"], command.Payload["playerId"], actorIDFromPayload(command.Payload), actorPlayerID)
		params := baseParams()
		params["playerId"] = playerID
		return semantic("gameLog.game.concede", params, []string{actorPlayerID, playerID}, nil)
	case "game.close":
		return semantic("gameLifecycleLog.game.closed", baseParams(), []string{actorPlayerID}, nil)
	}

	return nil
}

func runtimeLogRefs(game *state.GameState, playerIDs []string, cardIDs []string) map[string]any {
	refs := map[string]any{}
	if players := runtimeLogPlayerRefs(game, playerIDs); len(players) > 0 {
		refs["players"] = players
	}
	if cards := runtimeLogCardRefs(game, cardIDs); len(cards) > 0 {
		refs["cards"] = cards
	}
	return refs
}

func runtimeLogPlayerRefs(game *state.GameState, playerIDs []string) map[string]any {
	players := map[string]any{}
	for _, playerID := range playerIDs {
		if strings.TrimSpace(playerID) == "" {
			continue
		}
		if _, exists := players[playerID]; exists {
			continue
		}
		players[playerID] = map[string]any{
			"id":          playerID,
			"displayName": playerDisplayName(game, playerID),
		}
	}
	return players
}

func runtimeLogCardRefs(game *state.GameState, instanceIDs []string) map[string]any {
	cards := map[string]any{}
	for _, instanceID := range instanceIDs {
		if strings.TrimSpace(instanceID) == "" {
			continue
		}
		if _, exists := cards[instanceID]; exists {
			continue
		}
		ref := map[string]any{
			"instanceId": instanceID,
			"visibility": "hidden",
		}
		instance, hasInstance := game.Instances[instanceID]
		location, hasLocation := game.Loc[instanceID]
		if hasInstance && hasLocation && runtimeLogCardIsPublic(instance, location) {
			ref["visibility"] = "public"
			if strings.TrimSpace(instance.CardKey) != "" {
				ref["cardKey"] = instance.CardKey
				ref["cardRef"] = instance.CardKey
			}
		}
		cards[instanceID] = ref
	}
	return cards
}

func runtimeLogCardIsPublic(instance state.CardInstanceRuntime, location state.Location) bool {
	if instance.FaceDown {
		return false
	}
	switch location.Zone {
	case state.ZoneBattlefield, state.ZoneGraveyard, state.ZoneExile, state.ZoneCommand:
		return true
	default:
		return false
	}
}

func runtimeLogMessage(game *state.GameState, command protocol.CommandEnvelopeV2, payload map[string]any, displayName string) string {
	switch command.Type {
	case "hand.cards.reveal":
		return fmt.Sprintf("%s revealed %d cards from their hand.", displayName, intFromPayload(payload, "count", 1))
	case "hand.cards.revoke":
		return fmt.Sprintf("%s revoked access to %d revealed hand cards.", displayName, intFromPayload(payload, "count", 1))
	case "library.selection.move":
		count := intFromPayload(payload, "count", len(stringsFromAny(payload["orderedInstanceIds"])))
		destination := firstString(payload["destination"], payload["toZone"], command.Payload["toZone"])
		if destination == "library" {
			position := firstString(payload["position"], command.Payload["position"])
			return fmt.Sprintf("%s put %d selected cards on the %s of their library.", displayName, count, position)
		}
		if destination == "battlefield" && firstBool(payload["faceDown"], command.Payload["faceDown"]) {
			return fmt.Sprintf("%s played %d selected cards face-down.", displayName, count)
		}
		return fmt.Sprintf("%s moved %d selected library cards to %s.", displayName, count, readableZone(destination))
	case "library.top.play_face_down":
		count := intFromPayload(payload, "count", intFromPayload(command.Payload, "count", 1))
		return fmt.Sprintf("%s played the top %d cards of their library face-down.", displayName, count)
	case "library.draw", "library.draw_many":
		count := intFromPayload(payload, "count", 1)
		if count == 1 {
			return fmt.Sprintf("%s drew a card.", displayName)
		}
		return fmt.Sprintf("%s drew %d cards.", displayName, count)
	case "dice.rolled":
		kind := firstString(payload["kind"], command.Payload["kind"])
		result := payload["result"]
		if result == nil {
			result = payload["value"]
		}
		return fmt.Sprintf("%s rolled %s and got %v.", displayName, readableDiceKind(kind), result)
	case "life.changed":
		playerID := firstString(payload["playerId"], command.Payload["playerId"])
		name := playerDisplayName(game, playerID)
		previous := intFromPayload(payload, "previousLife", 0)
		life := intFromPayload(payload, "life", previous)
		return fmt.Sprintf("%s changed %s's life from %d to %d.", displayName, name, previous, life)
	case "card.moved", "cards.moved":
		count := len(stringsFromAny(payload["instanceIds"]))
		if count == 0 {
			count = len(stringsFromAny(command.Payload["instanceIds"]))
		}
		if count == 0 {
			count = 1
		}
		fromZone := firstString(payload["fromZone"], command.Payload["fromZone"])
		toZone := firstString(payload["toZone"], command.Payload["toZone"], payload["destination"], command.Payload["destination"])
		if fromZone == "command" && toZone == "battlefield" {
			if casts, ok := commanderCastCountFromPayload(payload); ok {
				return fmt.Sprintf("%s cast their commander from the command zone. Commander cast count is %d.", displayName, casts)
			}
		}
		if count == 1 {
			return fmt.Sprintf("%s moved a card from %s to %s.", displayName, readableZone(fromZone), readableZone(toZone))
		}
		return fmt.Sprintf("%s moved %d cards from %s to %s.", displayName, count, readableZone(fromZone), readableZone(toZone))
	case "card.tapped":
		if firstBool(payload["tapped"], command.Payload["tapped"]) {
			return fmt.Sprintf("%s tapped a permanent.", displayName)
		}
		return fmt.Sprintf("%s untapped a permanent.", displayName)
	case "battlefield.untap_all":
		count := len(stringsFromAny(payload["instanceIds"]))
		return fmt.Sprintf("%s untapped %d permanents.", displayName, count)
	case "card.counter.changed":
		counter := firstString(payload["counter"], command.Payload["counter"])
		value := intFromPayload(payload, "value", 0)
		return fmt.Sprintf("%s set %s counters to %d.", displayName, counterLabel(counter), value)
	case "card.stats.override.set":
		return fmt.Sprintf("%s set a card's power/toughness override.", displayName)
	case "card.stats.override.clear":
		return fmt.Sprintf("%s cleared a card's power/toughness override.", displayName)
	case "counter.changed":
		scope := firstString(payload["scope"], command.Payload["scope"])
		key := firstString(payload["key"], command.Payload["key"])
		value := intFromPayload(payload, "value", 0)
		if strings.HasPrefix(scope, "commander:") && key == "casts" {
			return fmt.Sprintf("%s set commander cast count to %d.", displayName, value)
		}
		return fmt.Sprintf("%s set %s to %d.", displayName, counterLabel(key), value)
	case "card.token.created":
		count := intFromPayload(payload, "count", 1)
		name := firstString(payload["name"], command.Payload["name"])
		if name == "" {
			name = "Token"
		}
		if count == 1 {
			return fmt.Sprintf("%s created a %s token.", displayName, name)
		}
		return fmt.Sprintf("%s created %d %s tokens.", displayName, count, name)
	case "card.token_copy.created":
		return fmt.Sprintf("%s created a token copy.", displayName)
	case "library.view":
		count := intFromPayload(payload, "count", 1)
		return fmt.Sprintf("%s looked at the top %d cards of their library.", displayName, count)
	case "library.reveal", "library.reveal_top":
		count := intFromPayload(payload, "count", 1)
		return fmt.Sprintf("%s revealed the top %d cards of their library.", displayName, count)
	case "library.shuffle":
		return fmt.Sprintf("%s shuffled their library.", displayName)
	case "game.concede":
		playerID := firstString(payload["playerId"], command.Payload["playerId"], actorIDFromPayload(command.Payload))
		name := playerDisplayName(game, playerID)
		return fmt.Sprintf("%s conceded.", name)
	case "game.close":
		return fmt.Sprintf("%s closed the game.", displayName)
	}
	return ""
}

func runtimeLogCardNames(payload map[string]any) []string {
	values, ok := payload["cardNames"]
	if !ok {
		return nil
	}
	return stringsFromAny(values)
}

func stableRuntimeLogID(gameID string, clientActionID string, commandType string) string {
	sum := sha1.Sum([]byte(strings.Join([]string{"runtime-log", gameID, clientActionID, commandType}, "\x00")))
	bytes := sum[:16]
	bytes[6] = (bytes[6] & 0x0f) | 0x50
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(bytes)
	return fmt.Sprintf("%s-%s-%s-%s-%s", encoded[0:8], encoded[8:12], encoded[12:16], encoded[16:20], encoded[20:32])
}

func firstString(values ...any) string {
	for _, value := range values {
		if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
			return strings.TrimSpace(text)
		}
	}
	return ""
}

func firstBool(values ...any) bool {
	for _, value := range values {
		if typed, ok := value.(bool); ok {
			return typed
		}
	}
	return false
}

func intFromPayload(payload map[string]any, key string, fallback int) int {
	if value, ok := intFromAny(payload[key]); ok {
		return value
	}
	return fallback
}

func commanderCastCountFromPayload(payload map[string]any) (int, bool) {
	counters := payload["commanderCastCounters"]
	switch typed := counters.(type) {
	case []map[string]any:
		for _, entry := range typed {
			if casts, ok := commanderCastCountFromEntry(entry); ok {
				return casts, true
			}
		}
	case []any:
		for _, raw := range typed {
			entry, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			if casts, ok := commanderCastCountFromEntry(entry); ok {
				return casts, true
			}
		}
	}
	return 0, false
}

func commanderCastCountFromEntry(entry map[string]any) (int, bool) {
	scope := firstString(entry["scope"])
	if !strings.HasPrefix(scope, "commander:") {
		return 0, false
	}
	counters, ok := entry["counters"].(map[string]any)
	if !ok {
		return 0, false
	}
	casts, ok := intFromAny(counters["casts"])
	return casts, ok
}

func stringsFromAny(value any) []string {
	switch typed := value.(type) {
	case []string:
		return append([]string(nil), typed...)
	case []any:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
				result = append(result, strings.TrimSpace(text))
			}
		}
		return result
	default:
		return nil
	}
}

func readableZone(zone string) string {
	switch strings.TrimSpace(zone) {
	case "battlefield":
		return "battlefield"
	case "graveyard":
		return "graveyard"
	case "exile":
		return "exile"
	case "hand":
		return "hand"
	case "library":
		return "library"
	case "command":
		return "command zone"
	default:
		return "zone"
	}
}

func readableDiceKind(kind string) string {
	switch strings.TrimSpace(kind) {
	case "coin":
		return "a coin"
	case "d4", "d6", "d10", "d20":
		return kind
	default:
		return "dice"
	}
}

func counterLabel(counter string) string {
	if strings.TrimSpace(counter) == "" {
		return "counter"
	}
	return counter
}

func actorIDFromPayload(payload map[string]any) string {
	return firstString(payload["playerId"], payload["targetPlayerId"])
}
