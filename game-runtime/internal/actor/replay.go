package actor

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

func ReplayEvents(initial state.GameState, events []protocol.EventPayloadV2, appliers []Applier) (state.GameState, error) {
	recovered := initial.Clone()
	recoveryGameID := recovered.GameID
	if recoveryGameID == "" && len(events) > 0 {
		recoveryGameID = events[0].GameID
	}
	state.NormalizeForRecovery(recoveryGameID, &recovered)
	for _, event := range events {
		if event.Version != recovered.Version+1 {
			return state.GameState{}, fmt.Errorf("%w: event version %d after state version %d", ErrVersionConflict, event.Version, recovered.Version)
		}
		if err := ReplayEventWithAppliers(&recovered, event, appliers); err != nil {
			return state.GameState{}, err
		}
		recovered.Version = event.Version
	}
	state.RebuildLocIndexForRecoveryOnly(&recovered)
	if err := state.ValidateInvariants(recovered); err != nil {
		return state.GameState{}, err
	}
	return recovered, nil
}

func ReplayEventWithAppliers(game *state.GameState, event protocol.EventPayloadV2, appliers []Applier) error {
	if replayed, err := replayLegacyOpsEvent(game, event); replayed || err != nil {
		return err
	}

	switch event.Type {
	case "game.started":
		return nil
	case "life.changed":
		return replayLifeChangedEvent(game, event)
	case "commander.damage.changed":
		return replayCommanderDamageChangedEvent(game, event)
	case "card.stats.override.set", "card.stats.override.cleared":
		return replayCardStatsOverrideEvent(game, event)
	case "turn.changed", "dice.rolled", "card.tapped", "card.face_down.changed", "card.revealed", "card.controller.changed", "card.counter.changed", "card.position.changed", "cards.position.changed", "counter.changed", "card.power_toughness.changed":
		return replayViaApplier(game, event, appliers)
	case "card.moved", "cards.moved", "zone.reorderedByIds", "zone.move_all", "battlefield.untap_all":
		return replayViaApplier(game, event, appliers)
	case "library.reveal", "library.play_top_revealed":
		return replayViaApplier(game, event, appliers)
	case "card.token.created", "card.token_copy.created", "zone.random_card.selected", "card.dungeon_marker.changed", "card.face.changed":
		return replayViaApplier(game, event, appliers)
	case "stack.card_added", "stack.item_removed":
		return replayStackEvent(game, event)
	case "arrow.created", "arrow.removed", "attachment.created", "attachment.removed", "helper.created", "helper.updated", "helper.removed":
		return replayViaApplier(game, event, appliers)
	case "game.concede":
		if effectVersion, _ := intField(event.Payload, "effectVersion"); effectVersion >= authoritativeLifecycleEffectVersion {
			playerID := optionalString(event.Payload, "playerId")
			if _, ok := game.Players[playerID]; !ok {
				return fmt.Errorf("%w: playerId", ErrInvalidPayloadField)
			}
			game.Players[playerID]["status"] = optionalString(event.Payload, "status")
			game.Players[playerID]["concededAt"] = event.Payload["concededAt"]
			applyPersistedLifecycleEffects(game, event.Payload, playerID)
			return nil
		}
		return replayViaApplier(game, event, appliers)
	case "game.close":
		if effectVersion, _ := intField(event.Payload, "effectVersion"); effectVersion >= authoritativeLifecycleEffectVersion {
			game.Status = optionalString(event.Payload, "status")
			game.Phase = state.GamePhase(optionalString(event.Payload, "phase"))
			game.WinnerPlayerID = optionalString(event.Payload, "winnerPlayerId")
			game.ResultState = optionalString(event.Payload, "resultState")
			game.FinishedReason = optionalString(event.Payload, "finishedReason")
			applyPersistedDisconnectControlPlane(game, event.Payload)
			return nil
		}
		return replayViaApplier(game, event, appliers)
	case "mulligan.player_took", "mulligan.player_kept", "mulligan.cards_bottomed", "mulligan.scry_confirmed", "mulligan.player_ready", "mulligan.completed", "game.phase_changed":
		return replayMulliganEvent(game, event)
	case "player.presence.changed", "disconnect.vote.opened", "disconnect.vote.cast", "disconnect.vote.resolved", "disconnect.vote.cancelled", "disconnect.vote.expired":
		if effectVersion, _ := intField(event.Payload, "effectVersion"); effectVersion >= disconnectVoteEffectVersion {
			if vote, ok := event.Payload["disconnectVote"].(map[string]any); ok {
				game.DisconnectVote = cloneMap(vote)
			}
			applyPersistedDisconnectControlPlane(game, event.Payload)
			if optionalString(event.Payload, "eliminationReason") == "expelled" {
				target := optionalString(event.Payload, "targetPlayerId")
				if _, ok := game.Players[target]; !ok {
					return fmt.Errorf("%w: targetPlayerId", ErrInvalidPayloadField)
				}
				game.Players[target]["status"] = "conceded"
				game.Players[target]["concededAt"] = event.Payload["concededAt"]
				applyPersistedLifecycleEffects(game, event.Payload, target)
			}
			return nil
		}
		return nil
	case "disconnect.vote.updated":
		if effectVersion, _ := intField(event.Payload, "effectVersion"); effectVersion >= disconnectVoteEffectVersion {
			if vote, ok := event.Payload["disconnectVote"].(map[string]any); ok {
				game.DisconnectVote = cloneMap(vote)
			}
			applyPersistedDisconnectControlPlane(game, event.Payload)
			if optionalString(event.Payload, "eliminationReason") == "expelled" {
				target := optionalString(event.Payload, "targetPlayerId")
				game.Players[target]["status"] = "conceded"
				game.Players[target]["concededAt"] = event.Payload["concededAt"]
				applyPersistedLifecycleEffects(game, event.Payload, target)
			}
			return nil
		}
		if effectVersion, _ := intField(event.Payload, "effectVersion"); effectVersion >= authoritativeLifecycleEffectVersion && optionalString(event.Payload, "status") == "resolved_expel" {
			if vote, ok := event.Payload["disconnectVote"].(map[string]any); ok {
				game.DisconnectVote = cloneMap(vote)
			}
			target := optionalString(event.Payload, "targetPlayerId")
			if _, ok := game.Players[target]; !ok {
				return fmt.Errorf("%w: targetPlayerId", ErrInvalidPayloadField)
			}
			game.Players[target]["status"] = "conceded"
			game.Players[target]["concededAt"] = event.Payload["concededAt"]
			applyPersistedLifecycleEffects(game, event.Payload, target)
			return nil
		}
		if vote, ok := event.Payload["disconnectVote"].(map[string]any); ok {
			game.DisconnectVote = cloneMap(vote)
		}
		return nil
	default:
		return ReplayEvent(game, event)
	}
}

func replayCardStatsOverrideEvent(game *state.GameState, event protocol.EventPayloadV2) error {
	effectVersion, _ := intField(event.Payload, "effectVersion")
	if effectVersion < cardStatsOverrideEffectVersion {
		return nil
	}
	instanceID := optionalString(event.Payload, "instanceId")
	faceKey := optionalString(event.Payload, "faceKey")
	instance, ok := game.Instances[instanceID]
	if !ok || faceKey == "" {
		return fmt.Errorf("%w: instanceId/faceKey", ErrInvalidPayloadField)
	}
	if instance.ManualOverrides == nil {
		instance.ManualOverrides = map[string]map[string]any{}
	}
	if override, ok := event.Payload["override"].(map[string]any); ok && override != nil {
		instance.ManualOverrides[faceKey] = cloneMap(override)
	} else {
		delete(instance.ManualOverrides, faceKey)
	}
	game.Instances[instanceID] = instance
	return nil
}

func replayLifeChangedEvent(game *state.GameState, event protocol.EventPayloadV2) error {
	playerID := optionalString(event.Payload, "playerId")
	player, ok := game.Players[playerID]
	if playerID == "" || !ok {
		return fmt.Errorf("%w: playerId", ErrInvalidPayloadField)
	}
	if effectVersion, _ := intField(event.Payload, "effectVersion"); effectVersion >= atomicLifecycleEffectVersion {
		life, ok := intField(event.Payload, "life")
		if !ok {
			return fmt.Errorf("%w: life", ErrMissingPayloadField)
		}
		player["life"] = life
		if status := optionalString(event.Payload, "status"); status != "" {
			player["status"] = status
		}
		game.Players[playerID] = player
		if effectVersion >= authoritativeLifecycleEffectVersion {
			applyPersistedLifecycleEffects(game, event.Payload, playerID)
		}
		if turn, ok := event.Payload["turn"].(map[string]any); ok {
			game.Turn = cloneMap(turn)
		}
		return nil
	}

	if life, ok := intField(event.Payload, "life"); ok {
		player["life"] = life
	} else if value, ok := intField(event.Payload, "value"); ok {
		player["life"] = value
	} else if delta, ok := intField(event.Payload, "delta"); ok {
		current, _ := intFromAny(player["life"])
		player["life"] = current + delta
	} else {
		return fmt.Errorf("%w: life", ErrMissingPayloadField)
	}
	game.Players[playerID] = player
	return nil
}

func applyPersistedDisconnectControlPlane(game *state.GameState, payload map[string]any) {
	if raw, ok := payload["presence"].(map[string]any); ok {
		game.Presence = map[string]map[string]any{}
		for playerID, value := range raw {
			if entry, ok := value.(map[string]any); ok {
				game.Presence[playerID] = cloneMap(entry)
			}
		}
	}
	if raw, ok := payload["disconnectCooldowns"].(map[string]any); ok {
		game.DisconnectCooldowns = map[string]map[string]any{}
		for playerID, value := range raw {
			if entry, ok := value.(map[string]any); ok {
				game.DisconnectCooldowns[playerID] = cloneMap(entry)
			}
		}
	}
	if rematch, ok := payload["rematch"].(map[string]any); ok {
		game.Rematch = cloneMap(rematch)
	}
}

func replayCommanderDamageChangedEvent(game *state.GameState, event protocol.EventPayloadV2) error {
	targetPlayerID := optionalString(event.Payload, "targetPlayerId")
	commanderInstanceID := optionalString(event.Payload, "commanderInstanceId")
	player, ok := game.Players[targetPlayerID]
	if targetPlayerID == "" || !ok {
		return fmt.Errorf("%w: targetPlayerId", ErrInvalidPayloadField)
	}
	if commanderInstanceID == "" {
		return fmt.Errorf("%w: commanderInstanceId", ErrMissingPayloadField)
	}
	damage, ok := intField(event.Payload, "damage")
	if !ok {
		return fmt.Errorf("%w: damage", ErrMissingPayloadField)
	}
	commanderDamage := intMapFromAny(player["commanderDamage"])
	commanderDamage[commanderInstanceID] = damage
	player["commanderDamage"] = anyMapFromIntMap(commanderDamage)

	if effectVersion, _ := intField(event.Payload, "effectVersion"); effectVersion >= atomicLifecycleEffectVersion {
		life, ok := intField(event.Payload, "life")
		if !ok {
			return fmt.Errorf("%w: life", ErrMissingPayloadField)
		}
		player["life"] = life
		if status := optionalString(event.Payload, "status"); status != "" {
			player["status"] = status
		}
		if turn, ok := event.Payload["turn"].(map[string]any); ok {
			game.Turn = cloneMap(turn)
		}
		if effectVersion >= authoritativeLifecycleEffectVersion {
			game.Players[targetPlayerID] = player
			applyPersistedLifecycleEffects(game, event.Payload, targetPlayerID)
			return nil
		}
	}
	game.Players[targetPlayerID] = player
	return nil
}

func applyPersistedLifecycleEffects(game *state.GameState, payload map[string]any, playerID string) {
	player := game.Players[playerID]
	if reason := optionalString(payload, "eliminationReason"); reason != "" {
		player["eliminationReason"] = reason
	}
	if version, ok := intField(payload, "eliminatedAtVersion"); ok {
		player["eliminatedAtVersion"] = version
	}
	for _, key := range []string{"sourcePlayerId", "commanderInstanceId"} {
		if value := optionalString(payload, key); value != "" {
			player[key] = value
		}
	}
	game.Players[playerID] = player
	if turn, ok := payload["turn"].(map[string]any); ok {
		game.Turn = cloneMap(turn)
	}
	if order, err := stringSliceField(payload, "turnOrder"); err == nil {
		game.TurnOrder = order
	}
	game.WinnerPlayerID = optionalString(payload, "winnerPlayerId")
	game.ResultState = optionalString(payload, "resultState")
	game.FinishedReason = optionalString(payload, "finishedReason")
	if after, ok := payload["designationsAfter"].(map[string]any); ok {
		applyPersistedDesignations(game, after)
	}
	applyPersistedDisconnectControlPlane(game, payload)
}

func applyPersistedDesignations(game *state.GameState, after map[string]any) {
	for id, relation := range game.Relations.Helpers {
		if template, _ := relation.Meta["template"].(string); template == "monarch" || template == "initiative" {
			delete(game.Relations.Helpers, id)
		}
	}
	for _, template := range []string{"monarch", "initiative"} {
		entity, ok := after[template].(map[string]any)
		if !ok {
			continue
		}
		id := optionalString(entity, "id")
		if id == "" {
			continue
		}
		game.Relations.Helpers[id] = state.Relation{ID: id, Meta: helperMeta(entity)}
	}
}

func replayStackEvent(game *state.GameState, event protocol.EventPayloadV2) error {
	stackID := optionalString(event.Payload, "stackId")
	if stackID == "" {
		stackID = optionalString(event.Payload, "id")
	}
	if event.Type == "stack.item_removed" {
		if stackID == "" {
			return fmt.Errorf("%w: stackId", ErrMissingPayloadField)
		}
		next := make([]state.StackItem, 0, len(game.Stack))
		for _, item := range game.Stack {
			if item.StackID != stackID {
				next = append(next, item)
			}
		}
		game.Stack = next
		return nil
	}

	command := protocol.CommandEnvelopeV2{
		GameID:         event.GameID,
		ClientActionID: event.ClientActionID,
		Payload:        cloneMap(event.Payload),
	}
	item, _, err := canonicalStackItem(game, command)
	if err == nil {
		if _, canonical := event.Payload["item"].(map[string]any); !canonical {
			item.CreatedAt = event.CreatedAt.Format(time.RFC3339Nano)
			if item.Meta == nil {
				item.Meta = map[string]any{}
			}
			item.Meta["createdAt"] = item.CreatedAt
		}
	}
	if err != nil {
		instanceID := optionalString(event.Payload, "sourceInstanceId")
		if instanceID == "" {
			instanceID = optionalString(event.Payload, "instanceId")
		}
		if stackID == "" {
			return err
		}
		item = state.StackItem{
			StackID:          stackID,
			Kind:             defaultString(optionalString(event.Payload, "kind"), "card"),
			SourceInstanceID: instanceID,
			OwnerID:          event.CreatedBy,
			Visibility:       "player:" + event.CreatedBy,
			Text:             optionalString(event.Payload, "text"),
			CreatedAt:        event.CreatedAt.Format(time.RFC3339Nano),
		}
	}
	next := make([]state.StackItem, 0, len(game.Stack)+1)
	for _, existing := range game.Stack {
		if existing.StackID != item.StackID {
			next = append(next, existing)
		}
	}
	game.Stack = append(next, item)
	return nil
}

func replayLegacyOpsEvent(game *state.GameState, event protocol.EventPayloadV2) (bool, error) {
	replayPayload, ok := event.Payload["replay"].(map[string]any)
	if !ok {
		return false, nil
	}
	ops, ok := replayPayload["ops"].([]any)
	if !ok {
		return true, nil
	}
	for _, rawOp := range ops {
		op, ok := rawOp.(map[string]any)
		if !ok {
			continue
		}
		switch op["op"] {
		case "mulligan.player_state.set":
			playerID, _ := op["playerId"].(string)
			if playerID == "" {
				continue
			}
			zones := game.Zones[playerID]
			if handIDs, ok := stringSliceFromAny(op["handIds"]); ok {
				zones.Hand = handIDs
			}
			if libraryIDs, ok := stringSliceFromAny(op["libraryIds"]); ok {
				zones.Library = libraryIDs
			}
			game.Zones[playerID] = zones
			if phaseString, ok := op["gamePhase"].(string); ok && phaseString != "" {
				game.Phase = state.GamePhase(phaseString)
				game.Status = phaseStatus(game.Phase)
				if game.Phase == state.PhasePlaying {
					game.Mulligan.Completed = true
				}
			}
		case "zone.cards.move":
			instanceID, _ := op["instanceId"].(string)
			to, _ := op["to"].(map[string]any)
			toPlayerID, _ := to["playerId"].(string)
			toZoneRaw, _ := to["zone"].(string)
			if instanceID == "" || toPlayerID == "" || toZoneRaw == "" {
				continue
			}
			toIndex := -1
			if index, ok := intFromAny(to["index"]); ok {
				toIndex = index
			}
			if card, ok := op["card"].(map[string]any); ok {
				mergeLegacyCardRuntimeFields(game, instanceID, card)
			}
			if _, err := state.MoveInstance(game, instanceID, toPlayerID, state.Zone(toZoneRaw), toIndex); err != nil {
				return true, err
			}
		}
	}
	state.RebuildLocIndexForRecoveryOnly(game)
	return true, nil
}

func mergeLegacyCardRuntimeFields(game *state.GameState, instanceID string, card map[string]any) {
	if game.Instances == nil {
		game.Instances = map[string]state.CardInstanceRuntime{}
	}
	instance := game.Instances[instanceID]
	if ownerID, ok := card["ownerId"].(string); ok && ownerID != "" {
		instance.OwnerID = ownerID
	}
	if controllerID, ok := card["controllerId"].(string); ok && controllerID != "" {
		instance.ControllerID = controllerID
	}
	if cardKey, ok := cardKeyFromLegacyCard(card, instanceID); ok {
		instance.CardKey = cardKey
	}
	if printID, ok := card["printId"].(string); ok && printID != "" {
		instance.PrintID = printID
	}
	if cardVersion, ok := card["cardVersion"].(string); ok && cardVersion != "" {
		instance.CardVersion = cardVersion
	}
	if language, ok := card["language"].(string); ok && language != "" {
		instance.Language = language
	}
	if tapped, ok := card["tapped"].(bool); ok {
		instance.Tapped = tapped
	}
	if faceDown, ok := card["faceDown"].(bool); ok {
		instance.FaceDown = faceDown
	}
	if rotation, ok := intFromAny(card["rotation"]); ok {
		instance.Rotation = rotation
	}
	if position, ok := card["position"].(map[string]any); ok {
		instance.Position = cloneMap(position)
	}
	game.Instances[instanceID] = instance
}

func cardKeyFromLegacyCard(card map[string]any, instanceID string) (string, bool) {
	if tokenMeta, ok := card["tokenMeta"].(map[string]any); ok {
		if key, ok := tokenMeta["templateCardKey"].(string); ok && key != "" {
			return key, true
		}
	}
	if scryfallID, ok := card["scryfallId"].(string); ok && scryfallID != "" {
		return scryfallID + ":card", true
	}
	if instanceID != "" {
		return "instance:" + instanceID, true
	}
	return "", false
}

func stringSliceFromAny(value any) ([]string, bool) {
	items, ok := value.([]any)
	if !ok {
		return nil, false
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		text, ok := item.(string)
		if !ok || text == "" {
			continue
		}
		out = append(out, text)
	}
	return out, true
}

func ReplayEvent(game *state.GameState, event protocol.EventPayloadV2) error {
	switch event.Type {
	case "library.draw", "library.draw_many":
		playerID, err := stringField(event.Payload, "playerId")
		if err != nil {
			return err
		}
		instanceIDs, err := stringSliceField(event.Payload, "instanceIds")
		if err != nil {
			return err
		}
		for _, instanceID := range instanceIDs {
			if _, err := state.MoveInstance(game, instanceID, playerID, state.ZoneHand, -1); err != nil {
				return err
			}
		}
		return nil
	case "library.reveal_top", "library.view":
		return nil
	case "library.reorder_top":
		playerID, err := stringField(event.Payload, "playerId")
		if err != nil {
			return err
		}
		instanceIDs, err := stringSliceField(event.Payload, "instanceIds")
		if err != nil {
			return err
		}
		return state.NewLibraryOps().ReorderTop(game, playerID, instanceIDs)
	case "library.move_top":
		playerID, err := stringField(event.Payload, "playerId")
		if err != nil {
			return err
		}
		instanceIDs, idsErr := stringSliceField(event.Payload, "instanceIds")
		if idsErr != nil || len(instanceIDs) == 0 {
			count, hasCount := intField(event.Payload, "count")
			if !hasCount || count <= 0 {
				return fmt.Errorf("%w: instanceIds", ErrMissingPayloadField)
			}
			instanceIDs, err = state.NewLibraryOps().PeekTop(game, playerID, count)
			if err != nil {
				return err
			}
		}
		currentTop, err := state.NewLibraryOps().PeekTop(game, playerID, len(instanceIDs))
		if err != nil {
			return err
		}
		if !equalStringOrder(currentTop, instanceIDs) {
			return state.ErrInvalidWindow
		}
		targetPlayerID := playerID
		if value, ok := event.Payload["targetPlayerId"].(string); ok && value != "" {
			targetPlayerID = value
		}
		destinationRaw, _ := event.Payload["destination"].(string)
		if destinationRaw == "" {
			destinationRaw, _ = event.Payload["toZone"].(string)
		}
		if destinationRaw == "" {
			return fmt.Errorf("%w: destination", ErrMissingPayloadField)
		}
		destination := state.Zone(destinationRaw)
		if destination == state.ZoneLibrary {
			_, err = state.NewLibraryOps().MoveTopToBottom(game, playerID, len(instanceIDs))
			return err
		}
		_, err = state.NewLibraryOps().MoveTopToPlayerZone(game, playerID, len(instanceIDs), targetPlayerID, destination)
		return err
	case "library.put_top", "library.put_bottom":
		playerID, err := stringField(event.Payload, "playerId")
		if err != nil {
			return err
		}
		instanceID, err := stringField(event.Payload, "instanceId")
		if err != nil {
			return err
		}
		if _, err := state.RemoveFromCurrentZone(game, instanceID); err != nil {
			return err
		}
		if event.Type == "library.put_top" {
			return state.NewLibraryOps().PutOnTop(game, playerID, instanceID)
		}
		return state.NewLibraryOps().PutOnBottom(game, playerID, instanceID)
	case "library.shuffle":
		playerID, err := stringField(event.Payload, "playerId")
		if err != nil {
			return err
		}
		if seed, ok := intField(event.Payload, "shuffleSeed"); ok {
			algorithm, _ := event.Payload["shuffleAlgorithm"].(string)
			if algorithm != "" && algorithm != state.DeterministicShuffleAlgorithm {
				return fmt.Errorf("%w: shuffleAlgorithm", ErrInvalidPayloadField)
			}
			if seed < 0 || int64(seed) > int64(^uint32(0)) {
				return fmt.Errorf("%w: shuffleSeed", ErrInvalidPayloadField)
			}
			return state.NewLibraryOps().ShuffleWithSeed(game, playerID, uint32(seed))
		}
		libraryOrder, err := stringSliceField(event.Payload, "libraryOrder")
		if err != nil {
			return err
		}
		zones := game.Zones[playerID]
		zones.Library = append([]string(nil), libraryOrder...)
		game.Zones[playerID] = zones
		state.ReindexZone(game, playerID, state.ZoneLibrary)
		return nil
	default:
		return fmt.Errorf("%w: %s", ErrUnknownCommand, event.Type)
	}
}

func equalStringOrder(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func replayMulliganEvent(game *state.GameState, event protocol.EventPayloadV2) error {
	if phaseValue, ok := event.Payload["phase"].(state.GamePhase); ok {
		game.Phase = phaseValue
		game.Status = phaseStatus(phaseValue)
	} else if phaseString, ok := event.Payload["phase"].(string); ok && phaseString != "" {
		game.Phase = state.GamePhase(phaseString)
		game.Status = phaseStatus(game.Phase)
	}
	if event.Type == "game.phase_changed" {
		return nil
	}
	playerID, hasPlayer := event.Payload["playerId"].(string)
	if hasPlayer && playerID != "" {
		if replayed, err := replayLegacyMulliganZoneSnapshot(game, event, playerID); replayed || err != nil {
			if err != nil {
				return err
			}
		} else {
			if err := replayCompactMulliganOperation(game, event, playerID); err != nil {
				return err
			}
		}
	}
	if mulligan, ok := mulliganStateFromAny(event.Payload["mulligan"]); ok {
		game.Mulligan = mulligan.Clone()
	}
	state.RebuildLocIndexForRecoveryOnly(game)
	return nil
}

func replayLegacyMulliganZoneSnapshot(game *state.GameState, event protocol.EventPayloadV2, playerID string) (bool, error) {
	zones := game.Zones[playerID]
	replayed := false
	if handIDs, err := stringSliceField(event.Payload, "handIds"); err == nil {
		zones.Hand = handIDs
		replayed = true
	}
	if libraryOrder, err := stringSliceField(event.Payload, "libraryOrder"); err == nil {
		zones.Library = libraryOrder
		replayed = true
	}
	if replayed {
		game.Zones[playerID] = zones
	}
	return replayed, nil
}

func replayCompactMulliganOperation(game *state.GameState, event protocol.EventPayloadV2, playerID string) error {
	switch event.Type {
	case "mulligan.player_took":
		seed, ok := intField(event.Payload, "shuffleSeed")
		if !ok {
			return nil
		}
		algorithm, _ := event.Payload["shuffleAlgorithm"].(string)
		if algorithm != "" && algorithm != state.DeterministicShuffleAlgorithm {
			return fmt.Errorf("%w: shuffleAlgorithm", ErrInvalidPayloadField)
		}
		if seed < 0 || int64(seed) > int64(^uint32(0)) {
			return fmt.Errorf("%w: shuffleSeed", ErrInvalidPayloadField)
		}
		drawCount, ok := intField(event.Payload, "drawCount")
		if !ok || drawCount < 0 {
			return fmt.Errorf("%w: drawCount", ErrInvalidPayloadField)
		}
		handIDs := append([]string(nil), game.Zones[playerID].Hand...)
		if err := moveHandToLibraryAndShuffle(game, playerID, handIDs, uint32(seed)); err != nil {
			return err
		}
		_, err := state.NewLibraryOps().DrawMany(game, playerID, drawCount)
		return err
	case "mulligan.player_kept", "mulligan.cards_bottomed":
		bottomedIDs, err := stringSliceField(event.Payload, "bottomedIds")
		if err != nil || len(bottomedIDs) == 0 {
			return nil
		}
		return replayMulliganBottomed(game, playerID, bottomedIDs)
	case "mulligan.scry_confirmed":
		choice, _ := event.Payload["choice"].(string)
		if choice != "bottom" {
			return nil
		}
		movedIDs, err := stringSliceField(event.Payload, "movedIds")
		if err != nil || len(movedIDs) == 0 {
			if topID, _ := event.Payload["topId"].(string); topID != "" {
				movedIDs = []string{topID}
			}
		}
		if len(movedIDs) == 0 {
			return nil
		}
		moved, err := state.NewLibraryOps().MoveTopToBottom(game, playerID, len(movedIDs))
		if err != nil {
			return err
		}
		for index, instanceID := range movedIDs {
			if index >= len(moved) || moved[index] != instanceID {
				return fmt.Errorf("%w: movedIds", ErrInvalidPayloadField)
			}
		}
		return nil
	default:
		return nil
	}
}

func replayMulliganBottomed(game *state.GameState, playerID string, bottomedIDs []string) error {
	for _, instanceID := range bottomedIDs {
		if _, err := state.RemoveFromCurrentZone(game, instanceID); err != nil {
			return err
		}
	}
	return state.NewLibraryOps().PutManyOnBottom(game, playerID, bottomedIDs)
}

func mulliganStateFromAny(value any) (state.MulliganState, bool) {
	switch typed := value.(type) {
	case state.MulliganState:
		return typed.Clone(), true
	case map[string]any:
		payload, err := json.Marshal(typed)
		if err != nil {
			return state.MulliganState{}, false
		}
		var mulligan state.MulliganState
		if err := json.Unmarshal(payload, &mulligan); err != nil {
			return state.MulliganState{}, false
		}
		return mulligan.Clone(), true
	default:
		return state.MulliganState{}, false
	}
}

func replayViaApplier(game *state.GameState, event protocol.EventPayloadV2, appliers []Applier) error {
	return replayViaApplierWithType(game, event, appliers, event.Type)
}

func replayViaApplierWithType(game *state.GameState, event protocol.EventPayloadV2, appliers []Applier, commandType string) error {
	for _, applier := range appliers {
		if applier.Type() != commandType {
			continue
		}
		command := protocol.CommandEnvelopeV2{
			GameID:         event.GameID,
			BaseVersion:    game.Version,
			ClientActionID: event.ClientActionID,
			Type:           commandType,
			Payload:        cloneMap(event.Payload),
		}
		_, err := applier.Apply(context.Background(), game, command, NewPatchEmitter())
		return err
	}
	return fmt.Errorf("%w: %s", ErrUnknownCommand, commandType)
}
