package actor

import (
	"context"
	"fmt"

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
	case "life.changed", "turn.changed", "dice.rolled", "card.tapped", "card.face_down.changed", "card.revealed", "card.controller.changed", "card.counter.changed", "card.position.changed", "cards.position.changed", "counter.changed", "commander.damage.changed", "card.power_toughness.changed":
		return replayViaApplier(game, event, appliers)
	case "card.moved", "cards.moved", "zone.reorderedByIds", "zone.move_all", "battlefield.untap_all":
		return replayViaApplier(game, event, appliers)
	case "library.reveal", "library.play_top_revealed":
		return replayViaApplier(game, event, appliers)
	case "card.token.created", "card.token_copy.created", "zone.random_card.selected", "card.dungeon_marker.changed", "card.face.changed":
		return replayViaApplier(game, event, appliers)
	case "stack.card_added", "stack.item_removed", "arrow.created", "arrow.removed", "attachment.created", "attachment.removed", "helper.created", "helper.updated", "helper.removed":
		return replayViaApplier(game, event, appliers)
	case "mulligan.player_took", "mulligan.player_kept", "mulligan.cards_bottomed", "mulligan.scry_confirmed", "mulligan.player_ready", "mulligan.completed", "game.phase_changed":
		return replayMulliganEvent(game, event)
	case "disconnect.vote.updated":
		return nil
	default:
		return ReplayEvent(game, event)
	}
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
		instanceIDs, err := stringSliceField(event.Payload, "instanceIds")
		if err != nil {
			return err
		}
		targetPlayerID := playerID
		if value, ok := event.Payload["targetPlayerId"].(string); ok && value != "" {
			targetPlayerID = value
		}
		destinationRaw, err := stringField(event.Payload, "destination")
		if err != nil {
			return err
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
	if mulligan, ok := event.Payload["mulligan"].(state.MulliganState); ok {
		game.Mulligan = mulligan.Clone()
	}
	playerID, hasPlayer := event.Payload["playerId"].(string)
	if hasPlayer && playerID != "" {
		zones := game.Zones[playerID]
		if handIDs, err := stringSliceField(event.Payload, "handIds"); err == nil {
			zones.Hand = handIDs
		}
		if libraryOrder, err := stringSliceField(event.Payload, "libraryOrder"); err == nil {
			zones.Library = libraryOrder
		}
		game.Zones[playerID] = zones
	}
	state.RebuildLocIndexForRecoveryOnly(game)
	return nil
}

func replayViaApplier(game *state.GameState, event protocol.EventPayloadV2, appliers []Applier) error {
	for _, applier := range appliers {
		if applier.Type() != event.Type {
			continue
		}
		command := protocol.CommandEnvelopeV2{
			GameID:         event.GameID,
			BaseVersion:    game.Version,
			ClientActionID: event.ClientActionID,
			Type:           event.Type,
			Payload:        cloneMap(event.Payload),
		}
		_, err := applier.Apply(context.Background(), game, command, NewPatchEmitter())
		return err
	}
	return fmt.Errorf("%w: %s", ErrUnknownCommand, event.Type)
}
