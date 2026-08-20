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
	displayName := playerDisplayName(game, actorID)
	message := runtimeLogMessage(game, command, payload, displayName)
	if strings.TrimSpace(message) == "" {
		return nil
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
	if instanceID := firstString(payload["instanceId"], command.Payload["instanceId"]); instanceID != "" && runtimeLogIncludesCardReference(command.Type) {
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
	return []map[string]any{entry}
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
	case "turn.changed":
		turn, _ := payload["turn"].(map[string]any)
		previousTurn, _ := payload["previousTurn"].(map[string]any)
		activePlayerID := firstString(turn["activePlayerId"])
		previousActivePlayerID := firstString(previousTurn["activePlayerId"])
		params := baseParams()
		params["playerId"] = activePlayerID
		if activePlayerID != "" && activePlayerID != previousActivePlayerID {
			params["previousPlayerId"] = previousActivePlayerID
			return semantic("gameLog.turn.changed", params, []string{previousActivePlayerID, activePlayerID}, nil)
		}
		params["phase"] = firstString(turn["phase"], command.Payload["phase"])
		return semantic("gameLog.turn.phaseChanged", params, []string{actorPlayerID}, nil)
	case "card.face_down.changed":
		params := baseParams()
		params["playerId"] = firstString(payload["playerId"], command.Payload["playerId"])
		key := "gameLog.card.turnedFaceUp"
		if firstBool(payload["faceDown"], command.Payload["faceDown"]) {
			key = "gameLog.card.turnedFaceDown"
		}
		return semantic(key, params, []string{actorPlayerID}, nil)
	case "card.controller.changed":
		params := baseParams()
		params["targetPlayerId"] = firstString(payload["controllerId"], command.Payload["targetPlayerId"], command.Payload["controllerId"])
		return semantic("gameLog.card.controllerChanged", params, []string{actorPlayerID, firstString(params["targetPlayerId"])}, nil)
	case "commander.damage.changed":
		params := baseParams()
		params["targetPlayerId"] = firstString(payload["targetPlayerId"], command.Payload["targetPlayerId"])
		params["previousValue"] = intFromPayload(payload, "previousDamage", 0)
		params["value"] = intFromPayload(payload, "damage", 0)
		return semantic("gameLog.commanderDamage.changed", params, []string{actorPlayerID, firstString(params["targetPlayerId"])}, nil)
	case "library.move_top":
		params := baseParams()
		params["count"] = intFromPayload(payload, "count", 1)
		params["toZone"] = firstString(payload["destination"], command.Payload["toZone"], command.Payload["destination"])
		return semantic("gameLog.library.moveTop", params, []string{actorPlayerID}, nil)
	case "library.reorder_top":
		params := baseParams()
		params["count"] = len(stringsFromAny(payload["instanceIds"]))
		return semantic("gameLog.library.reorderTop", params, []string{actorPlayerID}, nil)
	case "library.put_top", "library.put_bottom":
		params := baseParams()
		key := "gameLog.library.putBottom"
		if command.Type == "library.put_top" {
			key = "gameLog.library.putTop"
		}
		return semantic(key, params, []string{actorPlayerID}, nil)
	case "zone.random_card.selected":
		params := baseParams()
		params["fromZone"] = firstString(payload["zone"], command.Payload["zone"])
		return semantic("gameLog.zone.randomSelected", params, []string{actorPlayerID}, nil)
	case "zone.move_all":
		params := baseParams()
		params["count"] = intFromPayload(payload, "count", 0)
		params["fromZone"] = firstString(payload["fromZone"], command.Payload["fromZone"])
		params["toZone"] = firstString(payload["toZone"], command.Payload["toZone"])
		return semantic("gameLog.zone.movedAll", params, []string{actorPlayerID}, nil)
	case "stack.card_added":
		return semantic("gameLog.stack.cardAdded", baseParams(), []string{actorPlayerID}, nil)
	case "stack.item_removed":
		return semantic("gameLog.stack.itemRemoved", baseParams(), []string{actorPlayerID}, nil)
	case "arrow.created":
		return semantic("gameLog.arrow.created", baseParams(), []string{actorPlayerID}, nil)
	case "arrow.removed":
		return semantic("gameLog.arrow.removed", baseParams(), []string{actorPlayerID}, nil)
	case "attachment.created":
		return semantic("gameLog.attachment.created", baseParams(), []string{actorPlayerID}, nil)
	case "attachment.removed":
		return semantic("gameLog.attachment.removed", baseParams(), []string{actorPlayerID}, nil)
	case "mulligan.take":
		return semantic("gameLog.mulligan.taken", baseParams(), []string{actorPlayerID}, nil)
	case "mulligan.keep":
		return semantic("gameLog.mulligan.kept", baseParams(), []string{actorPlayerID}, nil)
	case "mulligan.scry.confirm":
		params := baseParams()
		params["choice"] = firstString(payload["choice"], command.Payload["choice"])
		return semantic("gameLog.mulligan.scryConfirmed", params, []string{actorPlayerID}, nil)
	case "disconnect.vote":
		if firstString(payload["status"], command.Payload["status"]) != "resolved_expel" {
			return nil
		}
		params := baseParams()
		params["targetPlayerId"] = firstString(payload["targetPlayerId"], command.Payload["targetPlayerId"])
		return semantic("gameLog.disconnect.expelled", params, []string{actorPlayerID, firstString(params["targetPlayerId"])}, nil)
	case "card.face.changed":
		instanceID := firstString(payload["instanceId"], command.Payload["instanceId"])
		params := baseParams()
		params["cardName"] = firstString(payload["cardName"], command.Payload["cardName"], "A card")
		params["faceName"] = firstString(payload["faceName"], command.Payload["faceName"])
		if instanceID != "" {
			params["cardInstanceId"] = instanceID
		}
		return semantic("gameLog.card.faceChanged", params, []string{actorPlayerID}, []string{instanceID})
	case "card.face_down.inspected":
		return semantic("gameLog.card.faceDownInspected", baseParams(), []string{actorPlayerID}, nil)
	case "card.revealed":
		viewers := stringsFromAny(payload["viewers"])
		count := len(stringsFromAny(payload["instanceIds"]))
		if count == 0 {
			count = len(stringsFromAny(command.Payload["instanceIds"]))
		}
		if count == 0 {
			count = 1
		}
		params := baseParams()
		params["playerId"] = firstString(payload["playerId"], command.Payload["playerId"], actorPlayerID)
		params["count"] = count
		isAll := firstString(command.Payload["to"]) == "all" || len(viewers) == len(game.Players)
		if isAll {
			params["revealAudience"] = "all"
		} else {
			params["revealAudience"] = "players"
			params["recipientPlayerIds"] = viewers
		}
		key := "gameLog.card.revealed"
		if count != 1 {
			key = "gameLog.card.revealedMany"
		}
		return semantic(key, params, append([]string{actorPlayerID}, viewers...), nil)
	case "library.play_top_face_down":
		return semantic("gameLog.library.playTopFaceDown", baseParams(), []string{actorPlayerID}, nil)
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
	case "card.moved":
		instanceID := firstString(payload["instanceId"], command.Payload["instanceId"])
		fromZone := firstString(payload["fromZone"], command.Payload["fromZone"])
		toZone := firstString(payload["toZone"], command.Payload["toZone"], payload["destination"], command.Payload["destination"])
		params := baseParams()
		params["fromZone"] = fromZone
		params["toZone"] = toZone
		params["count"] = 1
		if instanceID != "" {
			params["cardInstanceId"] = instanceID
		}
		if fromZone == "command" && toZone == "battlefield" {
			if casts, ok := commanderCastCountFromPayload(payload); ok {
				params["commanderCastCount"] = casts
				return semantic("gameLog.commander.cast", params, []string{actorPlayerID}, []string{instanceID})
			}
		}
		return semantic("gameLog.card.moved", params, []string{actorPlayerID}, []string{instanceID})
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
	case "card.power_toughness.changed":
		instanceID := firstString(payload["instanceId"], command.Payload["instanceId"])
		params := baseParams()
		params["cardName"] = firstString(payload["cardName"], command.Payload["cardName"], "A card")
		params["previousPower"] = runtimeStatLabel(payload["previousPower"])
		params["previousToughness"] = runtimeStatLabel(payload["previousToughness"])
		params["power"] = runtimeStatLabel(payload["power"])
		params["toughness"] = runtimeStatLabel(payload["toughness"])
		params["previousValue"] = runtimeStatLabel(payload["previousLoyalty"])
		params["value"] = runtimeStatLabel(payload["loyalty"])
		params["previousChapter"] = runtimeRomanStatLabel(payload["previousSaga"])
		params["chapter"] = runtimeRomanStatLabel(payload["saga"])
		params["previousDefense"] = runtimeStatLabel(payload["previousDefense"])
		params["defense"] = runtimeStatLabel(payload["defense"])
		if instanceID != "" {
			params["cardInstanceId"] = instanceID
		}
		key := "gameLog.cardStats.powerToughnessChanged"
		if hasLogStat(payload, "loyalty") && !hasLogStat(payload, "power") && !hasLogStat(payload, "toughness") {
			params["delta"] = runtimeStatDelta(payload["previousLoyalty"], payload["loyalty"])
			key = "gameLog.cardStats.loyaltyChanged"
		} else if hasLogStat(payload, "saga") && !hasLogStat(payload, "power") && !hasLogStat(payload, "toughness") && !hasLogStat(payload, "loyalty") && !hasLogStat(payload, "defense") {
			params["delta"] = runtimeStatDelta(payload["previousSaga"], payload["saga"])
			key = "gameLog.cardStats.sagaChanged"
		} else if hasLogStat(payload, "defense") && !hasLogStat(payload, "power") && !hasLogStat(payload, "toughness") && !hasLogStat(payload, "loyalty") {
			params["delta"] = runtimeStatDelta(payload["previousDefense"], payload["defense"])
			key = "gameLog.cardStats.defenseChanged"
		}
		return semantic(key, params, []string{actorPlayerID}, []string{instanceID})
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
	}

	return nil
}

func runtimeLogIncludesCardReference(commandType string) bool {
	switch commandType {
	case "card.face_down.inspected", "library.play_top_face_down", "card.face_down.changed", "library.put_top", "library.put_bottom", "zone.random_card.selected":
		return false
	default:
		return true
	}
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
	case "turn.changed":
		turn, _ := payload["turn"].(map[string]any)
		previousTurn, _ := payload["previousTurn"].(map[string]any)
		activePlayerID := firstString(turn["activePlayerId"])
		previousActivePlayerID := firstString(previousTurn["activePlayerId"])
		if activePlayerID != "" && activePlayerID != previousActivePlayerID {
			return fmt.Sprintf("%s finished their turn. %s's turn begins.", playerDisplayName(game, previousActivePlayerID), playerDisplayName(game, activePlayerID))
		}
		return fmt.Sprintf("%s advanced to the %s phase.", displayName, readablePhase(firstString(turn["phase"], command.Payload["phase"])))
	case "card.face_down.changed":
		if firstBool(payload["faceDown"], command.Payload["faceDown"]) {
			return fmt.Sprintf("%s turned a card face down.", displayName)
		}
		return fmt.Sprintf("%s turned a card face up.", displayName)
	case "card.controller.changed":
		return fmt.Sprintf("%s changed a card's controller to %s.", displayName, playerDisplayName(game, firstString(payload["controllerId"], command.Payload["targetPlayerId"], command.Payload["controllerId"])))
	case "commander.damage.changed":
		return fmt.Sprintf("%s changed commander damage dealt to %s from %d to %d.", displayName, playerDisplayName(game, firstString(payload["targetPlayerId"], command.Payload["targetPlayerId"])), intFromPayload(payload, "previousDamage", 0), intFromPayload(payload, "damage", 0))
	case "library.move_top":
		return fmt.Sprintf("%s moved the top %d cards of their library to %s.", displayName, intFromPayload(payload, "count", 1), readableZone(firstString(payload["destination"], command.Payload["toZone"], command.Payload["destination"])))
	case "library.reorder_top":
		return fmt.Sprintf("%s reordered the top %d cards of their library.", displayName, len(stringsFromAny(payload["instanceIds"])))
	case "library.put_top":
		return fmt.Sprintf("%s put a card on top of their library.", displayName)
	case "library.put_bottom":
		return fmt.Sprintf("%s put a card on the bottom of their library.", displayName)
	case "zone.random_card.selected":
		return fmt.Sprintf("%s selected a random card from %s.", displayName, readableZone(firstString(payload["zone"], command.Payload["zone"])))
	case "zone.move_all":
		return fmt.Sprintf("%s moved %d cards from %s to %s.", displayName, intFromPayload(payload, "count", 0), readableZone(firstString(payload["fromZone"], command.Payload["fromZone"])), readableZone(firstString(payload["toZone"], command.Payload["toZone"])))
	case "stack.card_added":
		return fmt.Sprintf("%s added a card to the stack.", displayName)
	case "stack.item_removed":
		return fmt.Sprintf("%s removed an item from the stack.", displayName)
	case "arrow.created":
		return fmt.Sprintf("%s created an arrow.", displayName)
	case "arrow.removed":
		return fmt.Sprintf("%s removed an arrow.", displayName)
	case "attachment.created":
		return fmt.Sprintf("%s attached a card.", displayName)
	case "attachment.removed":
		return fmt.Sprintf("%s removed an attachment.", displayName)
	case "mulligan.take":
		return fmt.Sprintf("%s took a mulligan.", displayName)
	case "mulligan.keep":
		return fmt.Sprintf("%s kept their hand.", displayName)
	case "mulligan.scry.confirm":
		return fmt.Sprintf("%s completed their mulligan scry.", displayName)
	case "disconnect.vote":
		if firstString(payload["status"], command.Payload["status"]) != "resolved_expel" {
			return ""
		}
		return fmt.Sprintf("%s was expelled after a disconnect vote.", playerDisplayName(game, firstString(payload["targetPlayerId"], command.Payload["targetPlayerId"])))
	case "card.face_down.inspected":
		return fmt.Sprintf("%s looked at a face-down card.", displayName)
	case "library.play_top_face_down":
		return fmt.Sprintf("%s played the top card of their library face down.", displayName)
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
	case "card.face.changed":
		zone := firstString(payload["zone"], command.Payload["zone"])
		if runtimeZone, ok := payload["zone"].(state.Zone); ok {
			zone = string(runtimeZone)
		}
		if zone != string(state.ZoneBattlefield) {
			return ""
		}
		cardName := firstString(payload["cardName"], command.Payload["cardName"], "a card")
		faceName := firstString(payload["faceName"], command.Payload["faceName"])
		if faceName == "" {
			return fmt.Sprintf("%s flipped %s.", displayName, cardName)
		}
		return fmt.Sprintf("%s flipped %s to %s.", displayName, cardName, faceName)
	case "card.power_toughness.changed":
		cardName := firstString(payload["cardName"], command.Payload["cardName"], "A card")
		if hasLogStat(payload, "loyalty") && !hasLogStat(payload, "power") && !hasLogStat(payload, "toughness") {
			return runtimeStatChangeMessage(cardName, "loyalty", payload["previousLoyalty"], payload["loyalty"], false)
		}
		if hasLogStat(payload, "saga") && !hasLogStat(payload, "power") && !hasLogStat(payload, "toughness") && !hasLogStat(payload, "loyalty") && !hasLogStat(payload, "defense") {
			return runtimeStatChangeMessage(cardName, "saga", payload["previousSaga"], payload["saga"], true)
		}
		if hasLogStat(payload, "defense") && !hasLogStat(payload, "power") && !hasLogStat(payload, "toughness") && !hasLogStat(payload, "loyalty") {
			return runtimeStatChangeMessage(cardName, "defense", payload["previousDefense"], payload["defense"], false)
		}
		return fmt.Sprintf(
			"Changed %s from %s/%s to %s/%s.",
			cardName,
			runtimeStatLabel(payload["previousPower"]),
			runtimeStatLabel(payload["previousToughness"]),
			runtimeStatLabel(payload["power"]),
			runtimeStatLabel(payload["toughness"]),
		)
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
	case "library.reveal":
		return fmt.Sprintf("%s revealed their library.", displayName)
	case "library.reveal_top":
		count := intFromPayload(payload, "count", 1)
		return fmt.Sprintf("%s revealed the top %d cards of their library.", displayName, count)
	case "card.revealed":
		count := len(stringsFromAny(payload["instanceIds"]))
		if count == 0 {
			count = 1
		}
		if count == 1 {
			return fmt.Sprintf("%s revealed 1 card.", displayName)
		}
		return fmt.Sprintf("%s revealed %d cards.", displayName, count)
	case "library.play_top_revealed":
		if firstBool(payload["enabled"], command.Payload["enabled"]) {
			return fmt.Sprintf("%s is playing with the top card of their library revealed.", displayName)
		}
		return fmt.Sprintf("%s stopped playing with the top card of their library revealed.", displayName)
	case "library.shuffle":
		return fmt.Sprintf("%s shuffled their library.", displayName)
	case "game.concede":
		playerID := firstString(payload["playerId"], command.Payload["playerId"], actorIDFromPayload(command.Payload))
		name := playerDisplayName(game, playerID)
		return fmt.Sprintf("%s conceded.", name)
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

func readablePhase(phase string) string {
	switch phase {
	case "untap":
		return "untap"
	case "upkeep":
		return "upkeep"
	case "draw":
		return "draw"
	case "main-1":
		return "first main"
	case "combat":
		return "combat"
	case "main-2":
		return "second main"
	case "end":
		return "end"
	default:
		return phase
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

func hasLogStat(payload map[string]any, key string) bool {
	_, exists := payload[key]
	return exists
}

func runtimeStatChangeMessage(cardName string, stat string, previous any, current any, roman bool) string {
	previousValue := runtimeStatLabel(previous)
	currentValue := runtimeStatLabel(current)
	if roman {
		previousValue = runtimeRomanStatLabel(previous)
		currentValue = runtimeRomanStatLabel(current)
	}
	previousNumber, hasPrevious := intFromAny(previous)
	currentNumber, hasCurrent := intFromAny(current)
	delta := 0
	if hasPrevious && hasCurrent {
		delta = currentNumber - previousNumber
	}
	direction := "increased"
	if delta < 0 {
		direction = "decreased"
	}
	if roman && delta == 0 {
		return fmt.Sprintf("%s saga %s to %s.", cardName, direction, currentValue)
	}
	return fmt.Sprintf("%s %s %s from %s to %s (%+d).", cardName, stat, direction, previousValue, currentValue, delta)
}

func runtimeStatLabel(value any) string {
	if value == nil {
		return "-"
	}
	if number, ok := intFromAny(value); ok {
		return fmt.Sprintf("%d", number)
	}
	return "?"
}

func runtimeRomanStatLabel(value any) string {
	number, ok := intFromAny(value)
	if !ok || number < 1 || number > 9 {
		return runtimeStatLabel(value)
	}
	return []string{"", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"}[number]
}

func runtimeStatDelta(previous any, current any) string {
	previousNumber, hasPrevious := intFromAny(previous)
	currentNumber, hasCurrent := intFromAny(current)
	if !hasPrevious || !hasCurrent {
		return "0"
	}
	return fmt.Sprintf("%+d", currentNumber-previousNumber)
}

func actorIDFromPayload(payload map[string]any) string {
	return firstString(payload["playerId"], payload["targetPlayerId"])
}
