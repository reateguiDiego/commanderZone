package actor

import (
	"fmt"

	"commanderzone/game-runtime/internal/protocol"
	"commanderzone/game-runtime/internal/state"
)

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
