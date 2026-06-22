package actor

import (
	"context"
	"fmt"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

func ReplayEvents(initial state.GameState, events []protocol.EventPayloadV2, appliers []Applier) (state.GameState, error) {
	recovered := initial.Clone()
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
	switch event.Type {
	case "life.changed", "turn.changed", "dice.rolled", "card.tapped", "card.counter.changed", "card.position.changed":
		return replayViaApplier(game, event, appliers)
	case "card.moved", "cards.moved", "zone.reorderedByIds", "zone.move_all", "battlefield.untap_all":
		return replayViaApplier(game, event, appliers)
	case "mulligan.player_took", "mulligan.player_kept", "mulligan.cards_bottomed", "mulligan.scry_confirmed", "mulligan.player_ready", "mulligan.completed", "game.phase_changed":
		return replayMulliganEvent(game, event)
	default:
		return ReplayEvent(game, event)
	}
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
