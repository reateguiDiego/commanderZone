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
	case "card.position.changed", "cards.position.changed":
		return replayPositionEvent(game, event)
	case "turn.changed", "dice.rolled", "card.tapped", "cards.tapped.set", "card.face_down.changed", "cards.face_down.set", "card.revealed", "card.controller.changed", "card.counter.changed", "counter.changed", "card.power_toughness.changed":
		return replayViaApplier(game, event, appliers)
	case "hand.cards.reveal", "hand.cards.revoke":
		return replayHandRevealBatchEvent(game, event)
	case "card.moved", "cards.moved":
		return replayMovementEvent(game, event, appliers)
	case "library.selection.move", "library.top.play_face_down":
		return replayLibraryBatchEvent(game, event)
	case "zone.reorderedByIds", "zone.move_all", "battlefield.untap_all":
		return replayViaApplier(game, event, appliers)
	case "library.reveal", "library.play_top_revealed":
		return replayViaApplier(game, event, appliers)
	case "card.token.created":
		before := game.Clone()
		if err := replayTokenCreatedEvent(game, event, appliers); err != nil {
			*game = before
			return err
		}
		return state.ValidateTokenGroupState(*game)
	case "card.token_copy.created", "zone.random_card.selected", "card.dungeon_marker.changed", "card.face.changed":
		return replayViaApplier(game, event, appliers)
	case "stack.card_added", "stack.item_removed":
		return replayStackEvent(game, event)
	case "arrow.created", "arrow.removed", "attachment.created", "attachment.removed", "attachment.reordered", "helper.created", "helper.updated", "helper.removed":
		return replayViaApplier(game, event, appliers)
	case "battlefield.stack.created", "battlefield.stack.member_added", "battlefield.stack.member_removed", "battlefield.stack.reordered", "battlefield.stack.dissolved":
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
			for ownerID, window := range game.Visibility.LibraryWindows {
				if window.Status == "active" {
					game.InvalidateLibraryWindow(ownerID, "closed")
				}
			}
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

func replayPositionEvent(game *state.GameState, event protocol.EventPayloadV2) error {
	positions := []map[string]any{}
	if event.Type == "card.position.changed" {
		positions = append(positions, event.Payload)
	} else {
		rawPositions, ok := event.Payload["positions"].([]any)
		if !ok {
			if typed, typedOK := event.Payload["positions"].([]map[string]any); typedOK {
				positions = append(positions, typed...)
			} else {
				return fmt.Errorf("%w: positions", ErrInvalidPayloadField)
			}
		} else {
			for _, raw := range rawPositions {
				entry, entryOK := raw.(map[string]any)
				if !entryOK {
					return fmt.Errorf("%w: positions", ErrInvalidPayloadField)
				}
				positions = append(positions, entry)
			}
		}
	}
	type replayedPosition struct {
		instanceID string
		position   map[string]any
	}
	validated := make([]replayedPosition, 0, len(positions))
	for _, entry := range positions {
		instanceID := optionalString(entry, "instanceId")
		position, ok := entry["position"].(map[string]any)
		_, exists := game.Instances[instanceID]
		if instanceID == "" || !ok || !exists {
			return fmt.Errorf("%w: instanceId/position", ErrInvalidPayloadField)
		}
		validated = append(validated, replayedPosition{instanceID: instanceID, position: position})
	}
	for _, entry := range validated {
		instance := game.Instances[entry.instanceID]
		instance.Position = cloneMap(entry.position)
		game.Instances[entry.instanceID] = instance
	}
	return nil
}

// Historical movement events may contain pixel positions without a stable
// battlefield reference size. Replay keeps those values literal and lets the
// viewer-only legacy fallback render them until the next canonical movement.
func replayMovementEvent(game *state.GameState, event protocol.EventPayloadV2, appliers []Applier) error {
	position, isPosition := event.Payload["position"].(map[string]any)
	if !isPosition || position == nil || position["unit"] == "ratio" {
		return replayViaApplier(game, event, appliers)
	}

	legacyByInstance := legacyMovementPositions(event.Payload, position)
	replayEvent := event
	replayEvent.Payload = cloneMap(event.Payload)
	delete(replayEvent.Payload, "position")
	if err := replayViaApplier(game, replayEvent, appliers); err != nil {
		return err
	}
	for instanceID, legacyPosition := range legacyByInstance {
		location, located := game.GetLocation(instanceID)
		instance, exists := game.Instances[instanceID]
		if !located || !exists || location.Zone != state.ZoneBattlefield {
			continue
		}
		instance.Position = cloneMap(legacyPosition)
		game.Instances[instanceID] = instance
	}
	return nil
}

func legacyMovementPositions(payload map[string]any, fallback map[string]any) map[string]map[string]any {
	positions := map[string]map[string]any{}
	if rawMoves, ok := payload["moves"].([]any); ok {
		for _, rawMove := range rawMoves {
			move, moveOK := rawMove.(map[string]any)
			if !moveOK {
				continue
			}
			instanceID := optionalString(move, "instanceId")
			position, positionOK := move["position"].(map[string]any)
			if instanceID != "" && positionOK && position != nil {
				positions[instanceID] = cloneMap(position)
			}
		}
	}
	if rawMoves, ok := payload["moves"].([]map[string]any); ok {
		for _, move := range rawMoves {
			instanceID := optionalString(move, "instanceId")
			position, positionOK := move["position"].(map[string]any)
			if instanceID != "" && positionOK && position != nil {
				positions[instanceID] = cloneMap(position)
			}
		}
	}
	instanceIDs, _ := stringSliceField(payload, "instanceIds")
	if len(instanceIDs) == 0 {
		if instanceID := optionalString(payload, "instanceId"); instanceID != "" {
			instanceIDs = []string{instanceID}
		}
	}
	for _, instanceID := range instanceIDs {
		if _, exists := positions[instanceID]; !exists {
			positions[instanceID] = cloneMap(fallback)
		}
	}
	return positions
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
	if status := playerStatus(game, playerID); status == "defeated" || status == "conceded" {
		game.InvalidateLibraryWindow(playerID, "closed")
	}
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
		game.InvalidateLibraryVisibility(playerID)
		for _, instanceID := range instanceIDs {
			if _, err := state.MoveInstance(game, instanceID, playerID, state.ZoneHand, -1); err != nil {
				return err
			}
		}
		return nil
	case "library.reveal_top":
		return replayLibraryRevealTop(game, event.Payload)
	case "library.view":
		return replayLibraryViewWindow(game, event.Payload)
	case "library.reorder_top":
		playerID, err := stringField(event.Payload, "playerId")
		if err != nil {
			return err
		}
		instanceIDs, err := stringSliceField(event.Payload, "instanceIds")
		if err != nil {
			return err
		}
		game.InvalidateLibraryVisibility(playerID)
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
		game.InvalidateLibraryVisibility(playerID)
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
		game.InvalidateLibraryVisibility(playerID)
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

func replayLibraryViewWindow(game *state.GameState, payload map[string]any) error {
	windowID := optionalString(payload, "windowId")
	if windowID == "" {
		// Historical library.view events were deliberately transient.
		return nil
	}
	playerID, err := stringField(payload, "playerId")
	if err != nil {
		return err
	}
	instanceIDs, err := stringSliceField(payload, "instanceIds")
	if err != nil || len(instanceIDs) == 0 {
		return fmt.Errorf("%w: instanceIds", ErrInvalidPayloadField)
	}
	expectedEpoch, ok := intField(payload, "expectedEpoch")
	if !ok || expectedEpoch < 0 {
		return fmt.Errorf("%w: expectedEpoch", ErrInvalidPayloadField)
	}
	openedAtVersion, _ := intField(payload, "openedAtVersion")
	game.Visibility.LibraryEpochByOwner[playerID] = int64(expectedEpoch)
	game.OpenLibraryWindow(playerID, state.LibraryWindow{
		WindowID: windowID, OwnerID: playerID, InstanceIDs: instanceIDs,
		ExpectedEpoch: int64(expectedEpoch), OpenedAtVersion: int64(openedAtVersion),
		CreatedByPlayerID: optionalString(payload, "createdByPlayerId"),
		CreatedBySession:  optionalString(payload, "createdBySession"), Status: "active",
	})
	return nil
}

func replayLibraryBatchEvent(game *state.GameState, event protocol.EventPayloadV2) error {
	playerID, err := stringField(event.Payload, "playerId")
	if err != nil {
		return err
	}
	rawMoves := mapsFromAny(event.Payload["moves"])
	if len(rawMoves) == 0 {
		return fmt.Errorf("%w: moves", ErrInvalidPayloadField)
	}
	instanceIDs := make([]string, 0, len(rawMoves))
	toPlayerID := playerID
	toZone := state.Zone("")
	for _, move := range rawMoves {
		instanceID := optionalString(move, "instanceId")
		to, _ := move["to"].(map[string]any)
		candidatePlayerID := optionalString(to, "playerId")
		candidateZone := state.Zone(optionalString(to, "zone"))
		if instanceID == "" || candidatePlayerID == "" || candidateZone == "" {
			return fmt.Errorf("%w: moves", ErrInvalidPayloadField)
		}
		if toZone != "" && (candidatePlayerID != toPlayerID || candidateZone != toZone) {
			return fmt.Errorf("%w: mixed destination", ErrInvalidPayloadField)
		}
		toPlayerID = candidatePlayerID
		toZone = candidateZone
		instanceIDs = append(instanceIDs, instanceID)
	}
	position := state.ZoneInsertAppend
	if optionalString(event.Payload, "position") == "top" {
		position = state.ZoneInsertTop
	} else if optionalString(event.Payload, "position") == "bottom" {
		position = state.ZoneInsertBottom
	}
	moves, err := state.NewZoneOps().MoveMany(game, instanceIDs, toPlayerID, toZone, position)
	if err != nil {
		return err
	}
	for index, move := range moves {
		persisted := rawMoves[index]
		instance := game.Instances[move.InstanceID]
		if toZone == state.ZoneBattlefield {
			position, ok := persisted["position"].(map[string]any)
			if !ok {
				return fmt.Errorf("%w: moves.position", ErrInvalidPayloadField)
			}
			instance.Position = cloneMap(position)
		} else {
			instance.Position = nil
		}
		if toZone == state.ZoneBattlefield {
			faceDown, ok := persisted["faceDown"].(bool)
			if !ok {
				return fmt.Errorf("%w: moves.faceDown", ErrInvalidPayloadField)
			}
			instance.FaceDown = faceDown
		} else {
			instance.FaceDown = false
		}
		game.Instances[move.InstanceID] = instance
	}
	if finalEpoch, ok := intField(event.Payload, "finalEpoch"); ok && finalEpoch >= 0 {
		game.Visibility.LibraryEpochByOwner[playerID] = int64(finalEpoch)
	}
	status := "stale"
	if event.Type == "library.selection.move" {
		status = "consumed"
	}
	game.InvalidateLibraryWindow(playerID, status)
	return nil
}

func mapsFromAny(raw any) []map[string]any {
	if typed, ok := raw.([]map[string]any); ok {
		return typed
	}
	values, ok := raw.([]any)
	if !ok {
		return nil
	}
	out := make([]map[string]any, 0, len(values))
	for _, value := range values {
		entry, ok := value.(map[string]any)
		if !ok {
			return nil
		}
		out = append(out, entry)
	}
	return out
}

func replayLibraryRevealTop(game *state.GameState, payload map[string]any) error {
	playerID, err := stringField(payload, "playerId")
	if err != nil {
		return err
	}
	game.EnsureVisibility()
	instanceIDs := stringsFromAny(payload["instanceIds"])
	if len(instanceIDs) == 0 {
		count, ok := intField(payload, "count")
		if !ok || count <= 0 {
			return fmt.Errorf("%w: instanceIds", ErrMissingPayloadField)
		}
		instanceIDs, err = state.NewLibraryOps().PeekTop(game, playerID, count)
		if err != nil {
			return err
		}
	}
	currentTop, err := state.NewLibraryOps().PeekTop(game, playerID, len(instanceIDs))
	if err != nil || !equalStringOrder(currentTop, instanceIDs) {
		return state.ErrInvalidWindow
	}

	viewers := stringsFromAny(payload["viewers"])
	if audience, ok := payload["audience"].(map[string]any); ok {
		scope, _ := audience["scope"].(string)
		if scope == audienceScopePublic {
			viewers = []string{"all"}
		} else if scope == audienceScopePlayers {
			viewers = stringsFromAny(audience["playerIds"])
		}
	}
	if len(viewers) == 0 {
		viewers = stringsFromAny(payload["to"])
		if target, ok := payload["to"].(string); ok && target != "" {
			viewers = []string{target}
		}
	}
	if len(viewers) == 0 {
		return fmt.Errorf("%w: viewers", ErrMissingPayloadField)
	}

	mask := uint64(0)
	if rawMask, ok := intField(payload, "visibleToMask"); ok && rawMask > 0 {
		mask = uint64(rawMask)
	}
	if mask == 0 {
		for _, viewerID := range viewers {
			if viewerID == "all" {
				mask = allPlayersVisibilityMask(game)
				break
			}
			mask |= game.Visibility.ViewerBits[viewerID]
		}
	}
	if mask == 0 {
		return fmt.Errorf("%w: visibleToMask", ErrInvalidPayloadField)
	}

	game.ClearTopRevealWindow(playerID)
	if epoch, ok := intField(payload, "visibilityEpoch"); ok && epoch >= 0 {
		game.Visibility.LibraryEpochByOwner[playerID] = int64(epoch)
	}
	game.RevealTopWindow(playerID, instanceIDs, viewers, mask)
	for _, instanceID := range instanceIDs {
		instance, ok := game.Instances[instanceID]
		if !ok {
			return state.ErrMissingInstance
		}
		instance.VisibleToMask |= mask
		game.Instances[instanceID] = instance
		game.Visibility.InstanceMasks[instanceID] |= mask
	}
	return nil
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

func replayTokenCreatedEvent(game *state.GameState, event protocol.EventPayloadV2, appliers []Applier) error {
	rawTokens, hasTokens := event.Payload["tokens"]
	if !hasTokens {
		return replayLegacyTokenCreatedEvent(game, event, appliers)
	}
	tokens, validTokens := tokenEventMaps(rawTokens)
	if !validTokens {
		return fmt.Errorf("%w: card.token.created tokens", ErrInvalidPayloadField)
	}
	rawEffectVersion, hasEffectVersion := event.Payload["effectVersion"]
	effectVersion, validEffectVersion := strictInteger(rawEffectVersion)
	if !hasEffectVersion || !validEffectVersion || (effectVersion != legacyTokenCreatedEffectVersion && effectVersion != tokenCreatedEffectVersion) {
		return fmt.Errorf("%w: card.token.created effectVersion", ErrInvalidPayloadField)
	}
	quantity, ok := strictInteger(event.Payload["count"])
	if !ok || quantity < MinTokenCreateQuantity || quantity > MaxTokenCreateQuantity || quantity != len(tokens) {
		return fmt.Errorf("%w: card.token.created count/tokens", ErrInvalidPayloadField)
	}
	playerID := optionalString(event.Payload, "playerId")
	if playerID == "" {
		playerID = optionalString(event.Payload, "actorPlayerId")
	}
	if _, ok := game.Players[playerID]; !ok {
		return fmt.Errorf("%w: card.token.created playerId", ErrInvalidPayloadField)
	}
	expectedIDs, err := stringSliceField(event.Payload, "instanceIds")
	if err != nil || len(expectedIDs) != quantity {
		return fmt.Errorf("%w: card.token.created instanceIds", ErrInvalidPayloadField)
	}
	ids := make([]string, 0, quantity)
	seen := make(map[string]struct{}, quantity)
	for index, token := range tokens {
		instance, instanceErr := tokenInstanceFromEvent(token, playerID, event.Type)
		if instanceErr != nil {
			return instanceErr
		}
		if expectedIDs[index] != instance.InstanceID {
			return fmt.Errorf("%w: card.token.created token order", ErrInvalidPayloadField)
		}
		if _, duplicate := seen[instance.InstanceID]; duplicate {
			return fmt.Errorf("%w: card.token.created duplicate instanceId", ErrInvalidPayloadField)
		}
		if _, exists := game.Instances[instance.InstanceID]; exists {
			return fmt.Errorf("%w: card.token.created existing instanceId", ErrInvalidPayloadField)
		}
		seen[instance.InstanceID] = struct{}{}
		ids = append(ids, instance.InstanceID)
		game.Instances[instance.InstanceID] = instance
	}
	if _, err := state.NewZoneOps().AddMany(game, playerID, state.ZoneBattlefield, ids, state.ZoneInsertAppend); err != nil {
		return err
	}
	rawGroup, hasGroup := event.Payload["tokenGroup"]
	if quantity == 1 && hasGroup && rawGroup != nil {
		return &state.TokenGroupStateError{Code: state.TokenGroupMemberMismatch, Count: quantity, InvalidIndex: 0}
	}
	if quantity > 1 && effectVersion == tokenCreatedEffectVersion && (!hasGroup || rawGroup == nil) {
		return &state.TokenGroupStateError{Code: state.TokenGroupMemberMismatch, Count: quantity, InvalidIndex: -1}
	}
	if hasGroup && rawGroup != nil {
		groupPayload, ok := rawGroup.(map[string]any)
		if !ok {
			return &state.TokenGroupStateError{Code: state.TokenGroupInvariantFailed, Count: quantity, InvalidIndex: -1}
		}
		group, err := tokenGroupFromEvent(groupPayload, event, ids, playerID)
		if err != nil {
			return err
		}
		if err := state.AddTokenGroup(game, group); err != nil {
			return err
		}
	}
	return nil
}

func tokenGroupFromEvent(payload map[string]any, event protocol.EventPayloadV2, expectedIDs []string, playerID string) (state.TokenGroupRuntime, error) {
	allowed := map[string]struct{}{
		"groupId": {}, "rootInstanceId": {}, "orderedMemberIds": {}, "revision": {},
		"createdByPlayerId": {}, "createdAtVersion": {}, "effectVersion": {},
	}
	for field := range payload {
		if _, ok := allowed[field]; !ok {
			return state.TokenGroupRuntime{}, &state.TokenGroupStateError{Code: state.TokenGroupInvariantFailed, Count: len(expectedIDs), InvalidIndex: -1}
		}
	}
	effectVersion, ok := strictInteger(payload["effectVersion"])
	if !ok || effectVersion != state.TokenGroupEffectVersion {
		return state.TokenGroupRuntime{}, &state.TokenGroupStateError{Code: state.TokenGroupEffectVersionUnsupported, Count: len(expectedIDs), InvalidIndex: -1}
	}
	revision, ok := strictInteger(payload["revision"])
	if !ok || revision < 1 {
		return state.TokenGroupRuntime{}, &state.TokenGroupStateError{Code: state.TokenGroupInvariantFailed, Count: len(expectedIDs), InvalidIndex: -1}
	}
	createdAtVersion, ok := strictInteger(payload["createdAtVersion"])
	if !ok || int64(createdAtVersion) != event.Version {
		return state.TokenGroupRuntime{}, &state.TokenGroupStateError{Code: state.TokenGroupInvariantFailed, Count: len(expectedIDs), InvalidIndex: -1}
	}
	members, err := stringSliceField(payload, "orderedMemberIds")
	if err != nil || !equalStringOrder(members, expectedIDs) {
		return state.TokenGroupRuntime{}, &state.TokenGroupStateError{Code: state.TokenGroupMemberMismatch, Count: len(members), InvalidIndex: -1}
	}
	group := state.TokenGroupRuntime{
		GroupID:           optionalString(payload, "groupId"),
		RootInstanceID:    optionalString(payload, "rootInstanceId"),
		OrderedMemberIDs:  members,
		Revision:          revision,
		CreatedByPlayerID: optionalString(payload, "createdByPlayerId"),
		CreatedAtVersion:  int64(createdAtVersion),
		EffectVersion:     effectVersion,
	}
	if group.GroupID == "" || group.RootInstanceID != expectedIDs[0] || group.CreatedByPlayerID != playerID {
		return state.TokenGroupRuntime{}, &state.TokenGroupStateError{Code: state.TokenGroupRootInvalid, Count: len(members), InvalidIndex: -1}
	}
	return group, nil
}

func replayLegacyTokenCreatedEvent(game *state.GameState, event protocol.EventPayloadV2, appliers []Applier) error {
	count, ok := strictInteger(event.Payload["count"])
	if !ok || count < MinTokenCreateQuantity || count > MaxTokenCreateQuantity {
		return fmt.Errorf("%w: legacy card.token.created count", ErrInvalidPayloadField)
	}
	payload := cloneMap(event.Payload)
	payload["quantity"] = count
	if _, hasCard := payload["card"].(map[string]any); !hasCard {
		card := map[string]any{}
		cardKey := optionalString(payload, "cardKey")
		if staticCards, ok := payload["staticCards"].(map[string]map[string]any); ok {
			card = cloneMap(staticCards[cardKey])
		} else if staticCards, ok := payload["staticCards"].(map[string]any); ok {
			card = cloneMap(mapField(staticCards, cardKey))
		}
		if len(card) == 0 {
			card["cardKey"] = cardKey
			card["name"] = optionalString(payload, "name")
			if tokenMeta := mapField(payload, "tokenMeta"); len(tokenMeta) > 0 {
				card["cardVersion"] = compactOptionalString(tokenMeta["templateCardVersion"])
				card["scryfallId"] = compactOptionalString(tokenMeta["templateScryfallId"])
			}
		}
		payload["card"] = card
	}
	legacy := event
	legacy.Payload = payload
	existingGroups := make(map[string]struct{}, len(game.Relations.TokenGroups))
	for groupID := range game.Relations.TokenGroups {
		existingGroups[groupID] = struct{}{}
	}
	if err := replayViaApplier(game, legacy, appliers); err != nil {
		return err
	}
	for groupID := range game.Relations.TokenGroups {
		if _, existed := existingGroups[groupID]; !existed {
			state.RemoveTokenGroup(game, groupID)
		}
	}
	instanceIDs := stringsFromAny(event.Payload["instanceIds"])
	for index, instanceID := range instanceIDs {
		instance, exists := game.Instances[instanceID]
		if !exists {
			continue
		}
		instance.Position = tokenPosition(index, count, payload)
		game.Instances[instanceID] = instance
	}
	return nil
}

func tokenEventMaps(value any) ([]map[string]any, bool) {
	switch typed := value.(type) {
	case []map[string]any:
		if len(typed) == 0 {
			return nil, false
		}
		return typed, true
	case []any:
		if len(typed) == 0 {
			return nil, false
		}
		out := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			token, ok := item.(map[string]any)
			if !ok {
				return nil, false
			}
			out = append(out, token)
		}
		return out, true
	default:
		return nil, false
	}
}

func tokenInstanceFromEvent(token map[string]any, fallbackPlayerID string, commandType string) (state.CardInstanceRuntime, error) {
	instanceID := optionalString(token, "instanceId")
	cardKey := optionalString(token, "cardKey")
	if instanceID == "" || cardKey == "" {
		return state.CardInstanceRuntime{}, fmt.Errorf("%w: card.token.created identity", ErrInvalidPayloadField)
	}
	ownerID := optionalString(token, "ownerPlayerId")
	if ownerID == "" {
		ownerID = optionalString(token, "ownerId")
	}
	controllerID := optionalString(token, "controllerPlayerId")
	if controllerID == "" {
		controllerID = optionalString(token, "controllerId")
	}
	if ownerID == "" {
		ownerID = fallbackPlayerID
	}
	if controllerID == "" {
		controllerID = fallbackPlayerID
	}
	if ownerID != fallbackPlayerID || controllerID != fallbackPlayerID {
		return state.CardInstanceRuntime{}, fmt.Errorf("%w: card.token.created owner/controller", ErrInvalidPayloadField)
	}
	zone := state.Zone(optionalString(token, "zone"))
	if zone != state.ZoneBattlefield {
		return state.CardInstanceRuntime{}, fmt.Errorf("%w: card.token.created zone", ErrInvalidPayloadField)
	}
	position, err := canonicalRatioPosition(token["position"], commandType, instanceID, 0)
	if err != nil {
		return state.CardInstanceRuntime{}, err
	}
	rotation, ok := optionalStrictInteger(token, "rotation", 0)
	if !ok {
		return state.CardInstanceRuntime{}, fmt.Errorf("%w: card.token.created rotation", ErrInvalidPayloadField)
	}
	activeFace, ok := optionalStrictInteger(token, "activeFace", 0)
	if !ok {
		return state.CardInstanceRuntime{}, fmt.Errorf("%w: card.token.created activeFace", ErrInvalidPayloadField)
	}
	if _, exists := token["activeFace"]; !exists {
		activeFace, ok = optionalStrictInteger(token, "activeFaceIndex", 0)
		if !ok {
			return state.CardInstanceRuntime{}, fmt.Errorf("%w: card.token.created activeFaceIndex", ErrInvalidPayloadField)
		}
	}
	counters, err := tokenCountersFromEvent(token["counters"])
	if err != nil {
		return state.CardInstanceRuntime{}, err
	}
	mutableStats := cloneMap(mapField(token, "mutableStats"))
	if len(mutableStats) == 0 {
		mutableStats = map[string]any{}
		for _, key := range []string{"power", "toughness", "loyalty", "defense", "saga"} {
			if value, exists := token[key]; exists && value != nil {
				mutableStats[key] = compactStat(value, nil)
			}
		}
	}
	return state.CardInstanceRuntime{
		InstanceID:      instanceID,
		CardKey:         cardKey,
		PrintID:         optionalString(token, "printId"),
		CardVersion:     optionalString(token, "cardVersion"),
		Language:        optionalString(token, "language"),
		OwnerID:         ownerID,
		ControllerID:    controllerID,
		Zone:            zone,
		IsToken:         true,
		TokenMeta:       cloneMap(mapField(token, "tokenMeta")),
		Tapped:          optionalBool(token, "tapped"),
		Rotation:        rotation,
		Counters:        counters,
		MutableStats:    mutableStats,
		PrintedStats:    tokenNestedStatsFromEvent(token["printedStats"]),
		ManualOverrides: tokenNestedStatsFromEvent(token["manualOverrides"]),
		Position:        position,
		FaceDown:        optionalBool(token, "faceDown"),
		ActiveFace:      activeFace,
		VisibleToMask:   1,
	}, nil
}

func optionalStrictInteger(values map[string]any, key string, fallback int) (int, bool) {
	value, exists := values[key]
	if !exists || value == nil {
		return fallback, true
	}
	return strictInteger(value)
}

func optionalBool(values map[string]any, key string) bool {
	value, _ := values[key].(bool)
	return value
}

func tokenCountersFromEvent(value any) (map[string]int, error) {
	if value == nil {
		return map[string]int{}, nil
	}
	if counters, ok := value.(map[string]int); ok {
		return cloneIntMap(counters), nil
	}
	raw, ok := value.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%w: card.token.created counters", ErrInvalidPayloadField)
	}
	counters := make(map[string]int, len(raw))
	for key, value := range raw {
		count, valid := strictInteger(value)
		if !valid {
			return nil, fmt.Errorf("%w: card.token.created counters", ErrInvalidPayloadField)
		}
		counters[key] = count
	}
	return counters, nil
}

func tokenNestedStatsFromEvent(value any) map[string]map[string]any {
	if value == nil {
		return nil
	}
	if stats, ok := value.(map[string]map[string]any); ok {
		return copyNestedStatsMap(stats)
	}
	raw, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	stats := make(map[string]map[string]any, len(raw))
	for faceKey, value := range raw {
		face, ok := value.(map[string]any)
		if !ok {
			continue
		}
		stats[faceKey] = cloneMap(face)
		if faceIndex, exists := stats[faceKey]["faceIndex"]; exists {
			if normalized, valid := strictInteger(faceIndex); valid {
				stats[faceKey]["faceIndex"] = normalized
			}
		}
	}
	return stats
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
