package state

import (
	"errors"
	"fmt"
)

var (
	ErrInvariantViolation = errors.New("game state invariant violation")
	ErrUnknownZone        = errors.New("unknown zone")
)

func RebuildLocIndexForRecoveryOnly(game *GameState) {
	if game.Loc == nil {
		game.Loc = map[string]Location{}
	}
	for instanceID := range game.Loc {
		delete(game.Loc, instanceID)
	}
	for playerID, zones := range game.Zones {
		rebuildZoneLoc(game, playerID, ZoneLibrary, zones.Library)
		rebuildZoneLoc(game, playerID, ZoneHand, zones.Hand)
		rebuildZoneLoc(game, playerID, ZoneBattlefield, zones.Battlefield)
		rebuildZoneLoc(game, playerID, ZoneGraveyard, zones.Graveyard)
		rebuildZoneLoc(game, playerID, ZoneExile, zones.Exile)
		rebuildZoneLoc(game, playerID, ZoneCommand, zones.Command)
	}
}

func ValidateInvariants(game GameState) error {
	seen := map[string]Location{}
	for playerID, zones := range game.Zones {
		if err := validateZone(game, seen, playerID, ZoneLibrary, zones.Library); err != nil {
			return err
		}
		if err := validateZone(game, seen, playerID, ZoneHand, zones.Hand); err != nil {
			return err
		}
		if err := validateZone(game, seen, playerID, ZoneBattlefield, zones.Battlefield); err != nil {
			return err
		}
		if err := validateZone(game, seen, playerID, ZoneGraveyard, zones.Graveyard); err != nil {
			return err
		}
		if err := validateZone(game, seen, playerID, ZoneExile, zones.Exile); err != nil {
			return err
		}
		if err := validateZone(game, seen, playerID, ZoneCommand, zones.Command); err != nil {
			return err
		}
	}
	for instanceID, instance := range game.Instances {
		if instance.ControllerID != "" {
			if _, ok := game.Players[instance.ControllerID]; !ok {
				return fmt.Errorf("%w: controller %s for %s", ErrInvariantViolation, instance.ControllerID, instanceID)
			}
		}
		if _, ok := seen[instanceID]; !ok {
			return fmt.Errorf("%w: instance %s missing from zones", ErrInvariantViolation, instanceID)
		}
		location, ok := game.Loc[instanceID]
		if !ok {
			return fmt.Errorf("%w: missing loc for %s", ErrInvariantViolation, instanceID)
		}
		if location != seen[instanceID] {
			return fmt.Errorf("%w: loc mismatch for %s", ErrInvariantViolation, instanceID)
		}
	}
	if len(game.Loc) != len(seen) {
		return fmt.Errorf("%w: loc index contains stale entries", ErrInvariantViolation)
	}
	return nil
}

func rebuildZoneLoc(game *GameState, playerID string, zone Zone, instanceIDs []string) {
	for index, instanceID := range instanceIDs {
		instance := game.Instances[instanceID]
		game.Loc[instanceID] = Location{
			PlayerID:     playerID,
			Zone:         zone,
			Index:        index,
			ControllerID: instance.ControllerID,
		}
		instance.Zone = zone
		game.Instances[instanceID] = instance
	}
}

func validateZone(game GameState, seen map[string]Location, playerID string, zone Zone, instanceIDs []string) error {
	for index, instanceID := range instanceIDs {
		if _, duplicate := seen[instanceID]; duplicate {
			return fmt.Errorf("%w: duplicate instance %s", ErrInvariantViolation, instanceID)
		}
		instance, ok := game.Instances[instanceID]
		if !ok {
			return fmt.Errorf("%w: zone references missing instance %s", ErrInvariantViolation, instanceID)
		}
		seen[instanceID] = Location{
			PlayerID:     playerID,
			Zone:         zone,
			Index:        index,
			ControllerID: instance.ControllerID,
		}
	}
	return nil
}
